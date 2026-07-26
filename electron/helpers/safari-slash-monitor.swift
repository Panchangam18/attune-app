import AppKit
import CoreGraphics
import Foundation

let slashKey = CGKeyCode(44)
let blockedModifiers: CGEventFlags = [.maskShift, .maskControl, .maskAlternate, .maskCommand]
var wasDown = false

print("status:\(CGPreflightListenEventAccess() ? "granted" : "denied")")
fflush(stdout)
if let testSignal = ProcessInfo.processInfo.environment["ATTUNE_BROWSER_SLASH_TEST_SIGNAL"],
   testSignal == "safari" || testSignal == "chrome" {
  print(testSignal)
  fflush(stdout)
}

while true {
  autoreleasepool {
    let isDown = CGEventSource.keyState(.combinedSessionState, key: slashKey)
    if isDown && !wasDown {
      let flags = CGEventSource.flagsState(.combinedSessionState)
      let frontmostBundleId = NSWorkspace.shared.frontmostApplication?.bundleIdentifier
      if frontmostBundleId == "com.apple.Safari" && flags.intersection(blockedModifiers).isEmpty {
        print("safari")
        fflush(stdout)
      } else if (frontmostBundleId?.hasPrefix("com.google.Chrome") == true
        || NSWorkspace.shared.frontmostApplication?.localizedName?.localizedCaseInsensitiveContains("Chrome") == true)
        && flags.intersection(blockedModifiers).isEmpty {
        print("chrome")
        fflush(stdout)
      }
    }
    wasDown = isDown
  }
  usleep(15_000)
}
