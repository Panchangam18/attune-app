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

@main
struct WindowRegionCapture {
  static func main() async {
    _ = NSApplication.shared
    let arguments = CommandLine.arguments
    guard arguments.count == 6 else { fail("usage: window-region-capture <pid> <x> <y> <width> <height>") }
    guard let ownerPID = Int32(arguments[1]),
          let x = Double(arguments[2]),
          let y = Double(arguments[3]),
          let width = Double(arguments[4]),
          let height = Double(arguments[5]),
          width > 0,
          height > 0 else { fail("invalid capture arguments") }
    guard CGPreflightScreenCaptureAccess() else { fail("screen capture permission is unavailable") }

    do {
      let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
      let candidates = content.windows.filter { $0.owningApplication?.processID == ownerPID && $0.frame.width > 100 && $0.frame.height > 100 }
      guard let window = candidates.max(by: { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height }) else {
        fail("no capturable window for pid \(ownerPID)")
      }
      let filter = SCContentFilter(desktopIndependentWindow: window)
      let scale = CGFloat(filter.pointPixelScale)
      let configuration = SCStreamConfiguration()
      configuration.width = max(1, Int(window.frame.width * scale))
      configuration.height = max(1, Int(window.frame.height * scale))
      configuration.showsCursor = false
      configuration.ignoreShadowsSingleWindow = true
      configuration.captureResolution = .best
      let fullImage = try await SCScreenshotManager.captureImage(
        contentFilter: filter,
        configuration: configuration
      )
      let requestedBounds = CGRect(x: x, y: y, width: width, height: height)
      let intersection = requestedBounds.intersection(window.frame)
      guard !intersection.isNull && intersection.width > 0 && intersection.height > 0 else {
        fail("requested region is outside the source window")
      }
      let crop = CGRect(
        x: (intersection.minX - window.frame.minX) * scale,
        y: (intersection.minY - window.frame.minY) * scale,
        width: intersection.width * scale,
        height: intersection.height * scale
      ).integral
      guard let image = fullImage.cropping(to: crop) else { fail("could not crop captured window") }

      let data = NSMutableData()
      guard let destination = CGImageDestinationCreateWithData(data, UTType.png.identifier as CFString, 1, nil) else {
        fail("could not create PNG destination")
      }
      CGImageDestinationAddImage(destination, image, nil)
      guard CGImageDestinationFinalize(destination) else { fail("could not encode PNG") }
      FileHandle.standardError.write(Data("window=\(window.windowID) bounds=\(window.frame) pixels=\(image.width)x\(image.height)\n".utf8))
      FileHandle.standardOutput.write((data as Data).base64EncodedData())
    } catch {
      fail("ScreenCaptureKit failed: \(error.localizedDescription)")
    }
  }
}
