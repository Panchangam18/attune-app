import AppKit
import CoreGraphics
import Foundation
import ImageIO
import ScreenCaptureKit
import UniformTypeIdentifiers

func fail(_ message: String) -> Never {
  FileHandle.standardError.write(Data("\(message)\n".utf8))
  exit(1)
}

func encodePNG(_ image: CGImage) -> Data {
  let data = NSMutableData()
  guard let destination = CGImageDestinationCreateWithData(data, UTType.png.identifier as CFString, 1, nil) else {
    fail("could not create PNG destination")
  }
  CGImageDestinationAddImage(destination, image, nil)
  guard CGImageDestinationFinalize(destination) else { fail("could not encode PNG") }
  return data as Data
}

func candidateScore(_ candidate: CGRect, _ expected: CGRect) -> CGFloat {
  abs(candidate.minX - expected.minX)
    + abs(candidate.minY - expected.minY)
    + abs(candidate.width - expected.width)
    + abs(candidate.height - expected.height)
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
      let candidates = content.windows.filter { $0.owningApplication?.processID == ownerPID && $0.frame.width > 100 && $0.frame.height > 100 }
      let window: SCWindow?
      if let expectedWindowID, expectedWindowID > 0,
         let exactWindow = candidates.first(where: { $0.windowID == expectedWindowID }) {
        window = exactWindow
      } else if let expected = expectedWindowFrame, expected.width > 0, expected.height > 0 {
        // A browser process can own many full-size windows. Bind the stream to
        // the one whose native frame matches the selected page target instead
        // of silently capturing whichever window happens to be largest.
        window = candidates.min(by: { candidateScore($0.frame, expected) < candidateScore($1.frame, expected) })
      } else {
        window = candidates.max(by: { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height })
      }
      guard let window else {
        fail("no capturable window for pid \(ownerPID)")
      }
      let requestedBounds = CGRect(x: x, y: y, width: width, height: height)
      guard let display = content.displays.first(where: { $0.frame.intersects(requestedBounds) }) else {
        fail("no display contains the requested region")
      }
      let intersection = requestedBounds.intersection(display.frame).intersection(window.frame)
      guard !intersection.isNull && intersection.width > 0 && intersection.height > 0 else {
        fail("requested region is outside the source window")
      }
      let filter = SCContentFilter(display: display, including: [window])
      let scale = CGFloat(filter.pointPixelScale)
      let configuration = SCStreamConfiguration()
      configuration.sourceRect = CGRect(
        x: intersection.minX - display.frame.minX,
        y: intersection.minY - display.frame.minY,
        width: intersection.width,
        height: intersection.height
      )
      configuration.width = max(1, Int(intersection.width * scale))
      configuration.height = max(1, Int(intersection.height * scale))
      configuration.showsCursor = false
      configuration.ignoreShadowsDisplay = true
      configuration.captureResolution = .best
      let frameNanoseconds = UInt64(1_000_000_000 / min(30, max(1, requestedFPS)))
      var emitted = 0
      FileHandle.standardError.write(Data("ready window=\(window.windowID) pixels=\(configuration.width)x\(configuration.height)\n".utf8))

      while frameLimit <= 0 || emitted < frameLimit {
        let startedAt = DispatchTime.now().uptimeNanoseconds
        let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration)
        FileHandle.standardOutput.write(encodePNG(image).base64EncodedData())
        FileHandle.standardOutput.write(Data([0x0A]))
        emitted += 1
        let elapsed = DispatchTime.now().uptimeNanoseconds - startedAt
        if elapsed < frameNanoseconds {
          try await Task.sleep(nanoseconds: frameNanoseconds - elapsed)
        }
      }
    } catch {
      fail("ScreenCaptureKit failed: \(error.localizedDescription)")
    }
  }
}
