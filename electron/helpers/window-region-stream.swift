import AppKit
import CoreGraphics
import CoreImage
import CoreMedia
import CoreVideo
import Foundation
import ImageIO
import ScreenCaptureKit
import UniformTypeIdentifiers

func fail(_ message: String) -> Never {
  FileHandle.standardError.write(Data("\(message)\n".utf8))
  exit(1)
}

func encodeFrame(_ image: CGImage) -> Data {
  let data = NSMutableData()
  guard let destination = CGImageDestinationCreateWithData(data, UTType.jpeg.identifier as CFString, 1, nil) else {
    fail("could not create JPEG destination")
  }
  let options = [kCGImageDestinationLossyCompressionQuality: 0.82] as CFDictionary
  CGImageDestinationAddImage(destination, image, options)
  guard CGImageDestinationFinalize(destination) else { fail("could not encode JPEG") }
  return data as Data
}

func candidateScore(_ candidate: CGRect, _ expected: CGRect) -> CGFloat {
  abs(candidate.minX - expected.minX)
    + abs(candidate.minY - expected.minY)
    + abs(candidate.width - expected.width)
    + abs(candidate.height - expected.height)
}

@available(macOS 14.0, *)
final class RegionStreamOutput: NSObject, SCStreamOutput {
  private let context = CIContext(options: [.cacheIntermediates: false])
  private let encodeQueue = DispatchQueue(label: "attune.window-region-stream.encode", qos: .userInteractive)
  private let writeQueue = DispatchQueue(label: "attune.window-region-stream.write", qos: .userInteractive)
  private let lock = NSLock()
  private let frameLimit: Int
  private var encoding = false
  private var pendingPixelBuffer: CVPixelBuffer?
  private var writing = false
  private var pendingWrite: Data?
  private var emitted = 0
  private var finished = false

  init(frameLimit: Int) {
    self.frameLimit = frameLimit
  }

  var isFinished: Bool {
    lock.lock()
    defer { lock.unlock() }
    return finished
  }

  func stream(
    _ stream: SCStream,
    didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
    of outputType: SCStreamOutputType
  ) {
    guard outputType == .screen,
          sampleBuffer.isValid,
          let attachments = CMSampleBufferGetSampleAttachmentsArray(
            sampleBuffer,
            createIfNecessary: false
          ) as? [[SCStreamFrameInfo: Any]],
          let frameInfo = attachments.first,
          let statusRawValue = frameInfo[SCStreamFrameInfo.status] as? Int,
          let frameStatus = SCFrameStatus(rawValue: statusRawValue) else { return }
    guard frameStatus == .complete,
          let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }

    lock.lock()
    if encoding || finished {
      if encoding && !finished {
        pendingPixelBuffer = pixelBuffer
      }
      lock.unlock()
      return
    }
    encoding = true
    lock.unlock()

    // Keep ScreenCaptureKit's delivery queue unblocked. Encoding and transport
    // have independent latest-frame queues: a slow stdout consumer must never
    // hold the encoder gate closed or feed back into capture delivery.
    encodeQueue.async { [self, pixelBuffer] in
      drainEncodes(startingWith: pixelBuffer)
    }
  }

  private func drainEncodes(startingWith firstPixelBuffer: CVPixelBuffer) {
    var current: CVPixelBuffer? = firstPixelBuffer
    while let pixelBuffer = current {
      var encodedData: Data?
      autoreleasepool {
        let image = CIImage(cvPixelBuffer: pixelBuffer)
        if let rendered = context.createCGImage(image, from: image.extent) {
          encodedData = encodeFrame(rendered)
        }
      }
      if let encodedData {
        enqueueWrite(encodedData)
      }

      lock.lock()
      if finished {
        pendingPixelBuffer = nil
        encoding = false
        current = nil
      } else if let nextPixelBuffer = pendingPixelBuffer {
        pendingPixelBuffer = nil
        current = nextPixelBuffer
      } else {
        encoding = false
        current = nil
      }
      lock.unlock()
    }
  }

  private func enqueueWrite(_ data: Data) {
    lock.lock()
    if finished {
      lock.unlock()
      return
    }
    if writing {
      pendingWrite = data
      lock.unlock()
      return
    }
    writing = true
    lock.unlock()

    writeQueue.async { [self] in
      drainWrites(startingWith: data)
    }
  }

  private func drainWrites(startingWith firstData: Data) {
    var current: Data? = firstData
    while let data = current {
      var length = UInt32(data.count).bigEndian
      var packet = Data(bytes: &length, count: MemoryLayout<UInt32>.size)
      packet.append(data)
      FileHandle.standardOutput.write(packet)

      lock.lock()
      emitted += 1
      if frameLimit > 0 && emitted >= frameLimit {
        finished = true
        pendingPixelBuffer = nil
        pendingWrite = nil
        writing = false
        current = nil
      } else if let nextData = pendingWrite {
        pendingWrite = nil
        current = nextData
      } else {
        writing = false
        current = nil
      }
      lock.unlock()
    }
  }
}

@main
struct WindowRegionStream {
  static func main() async {
    _ = NSApplication.shared
    let arguments = CommandLine.arguments
    guard arguments.count == 8 || arguments.count == 12 || arguments.count == 13 else {
      fail("usage: window-region-stream <pid> <x> <y> <width> <height> <fps> <frame-limit> [<window-x> <window-y> <window-width> <window-height> [<window-id>]]")
    }
    guard let ownerPID = Int32(arguments[1]),
          let x = Double(arguments[2]),
          let y = Double(arguments[3]),
          let width = Double(arguments[4]),
          let height = Double(arguments[5]),
          let requestedFPS = Double(arguments[6]),
          let frameLimit = Int(arguments[7]),
          width > 0,
          height > 0,
          requestedFPS > 0 else { fail("invalid capture arguments") }
    let expectedWindowFrame: CGRect? = arguments.count >= 12
      ? CGRect(
        x: Double(arguments[8]) ?? 0,
        y: Double(arguments[9]) ?? 0,
        width: Double(arguments[10]) ?? 0,
        height: Double(arguments[11]) ?? 0
      )
      : nil
    let expectedWindowID = arguments.count == 13 ? CGWindowID(arguments[12]) : nil
    guard CGPreflightScreenCaptureAccess() || CGRequestScreenCaptureAccess() else {
      fail("screen capture permission is unavailable")
    }
    guard #available(macOS 14.0, *) else { fail("window surface capture requires macOS 14 or newer") }

    do {
      let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
      let candidates = content.windows.filter {
        $0.owningApplication?.processID == ownerPID && $0.frame.width > 100 && $0.frame.height > 100
      }
      let window: SCWindow?
      if let expectedWindowID, expectedWindowID > 0,
         let exactWindow = candidates.first(where: { $0.windowID == expectedWindowID }) {
        window = exactWindow
      } else if let expected = expectedWindowFrame, expected.width > 0, expected.height > 0 {
        window = candidates.min(by: { candidateScore($0.frame, expected) < candidateScore($1.frame, expected) })
      } else {
        window = candidates.max(by: { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height })
      }
      guard let window else { fail("no capturable window for pid \(ownerPID)") }

      let requestedBounds = CGRect(x: x, y: y, width: width, height: height)
      let intersection = requestedBounds.intersection(window.frame)
      guard !intersection.isNull && intersection.width > 0 && intersection.height > 0 else {
        fail("requested region is outside the source window")
      }

      // A display-scoped filter stops receiving fresh pixels when a fullscreen
      // source moves onto an inactive macOS Space. Capture the selected native
      // window independently of the active desktop so the stream stays live.
      let filter = SCContentFilter(desktopIndependentWindow: window)
      let scale = CGFloat(filter.pointPixelScale)
      let framesPerSecond = min(60, max(1, requestedFPS))
      let configuration = SCStreamConfiguration()
      configuration.sourceRect = CGRect(
        x: intersection.minX - window.frame.minX,
        y: intersection.minY - window.frame.minY,
        width: intersection.width,
        height: intersection.height
      )
      configuration.width = max(1, Int(intersection.width * scale))
      configuration.height = max(1, Int(intersection.height * scale))
      configuration.showsCursor = false
      configuration.ignoreShadowsSingleWindow = true
      configuration.captureResolution = .best
      configuration.pixelFormat = kCVPixelFormatType_32BGRA
      configuration.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(framesPerSecond.rounded()))
      configuration.queueDepth = 2

      let output = RegionStreamOutput(frameLimit: frameLimit)
      let sampleQueue = DispatchQueue(label: "attune.window-region-stream.samples", qos: .userInteractive)
      let stream = SCStream(filter: filter, configuration: configuration, delegate: nil)
      try stream.addStreamOutput(output, type: .screen, sampleHandlerQueue: sampleQueue)
      try await stream.startCapture()
      FileHandle.standardError.write(Data(
        "ready window=\(window.windowID) pixels=\(configuration.width)x\(configuration.height) fps=\(Int(framesPerSecond))\n".utf8
      ))

      while frameLimit <= 0 || !output.isFinished {
        try await Task.sleep(nanoseconds: 20_000_000)
      }
      try await stream.stopCapture()
    } catch {
      fail("ScreenCaptureKit failed: \(error.localizedDescription)")
    }
  }
}
