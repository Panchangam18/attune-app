import AppKit
import CoreGraphics
import Foundation

let aKey = CGKeyCode(0)
let slashKey = CGKeyCode(44)
let keyboardModifiers: CGEventFlags = [.maskShift, .maskControl, .maskAlternate, .maskCommand]
let originalParentPid = getppid()
var lastSignalAt: [String: TimeInterval] = [:]

func browserSignalPrefix(_ application: NSRunningApplication?) -> String? {
  let bundleId = application?.bundleIdentifier
  if bundleId?.hasPrefix("com.apple.Safari") == true {
    return "safari"
  }
  if bundleId?.hasPrefix("com.google.Chrome") == true
    || application?.localizedName?.localizedCaseInsensitiveContains("Chrome") == true {
    return "chrome"
  }
  return nil
}

func signalForKeyDown(_ event: CGEvent) -> String? {
  guard event.getIntegerValueField(.keyboardEventAutorepeat) == 0 else {
    return nil
  }

  let application = NSWorkspace.shared.frontmostApplication
  let browser = browserSignalPrefix(application)
  let key = CGKeyCode(event.getIntegerValueField(.keyboardEventKeycode))
  let modifiers = event.flags.intersection(keyboardModifiers)
  if key == aKey,
     modifiers.contains(.maskCommand),
     modifiers.contains(.maskAlternate),
     !modifiers.contains(.maskShift),
     !modifiers.contains(.maskControl) {
    if let browser {
      return "picker:\(browser)"
    }
    if let application, application.processIdentifier > 0 {
      if let bundleId = application.bundleIdentifier, !bundleId.isEmpty {
        return "picker:app:\(application.processIdentifier):\(bundleId)"
      }
      return "picker:app:\(application.processIdentifier)"
    }
    return nil
  }
  if key == slashKey, modifiers.isEmpty, let browser {
    return browser
  }
  return nil
}

func emit(_ signal: String) {
  print(signal)
  fflush(stdout)
}

func emitOnce(_ signal: String) {
  let now = ProcessInfo.processInfo.systemUptime
  let debounceSeconds = signal.hasPrefix("picker:") ? 0.5 : 0.1
  if let previous = lastSignalAt[signal], now - previous < debounceSeconds {
    return
  }
  lastSignalAt[signal] = now
  emit(signal)
}

print("status:\(CGPreflightListenEventAccess() ? "granted" : "denied")")
fflush(stdout)
if let testSignal = ProcessInfo.processInfo.environment["ATTUNE_BROWSER_SLASH_TEST_SIGNAL"],
   ["safari", "chrome", "picker:safari", "picker:chrome"].contains(testSignal)
      || testSignal.range(of: #"^picker:app:[1-9][0-9]*(?::[A-Za-z0-9][A-Za-z0-9._-]{0,255})?$"#, options: .regularExpression) != nil {
  emit(testSignal)
}

let eventMask = CGEventMask(1 << CGEventType.keyDown.rawValue)
let eventTap = CGEvent.tapCreate(
  tap: .cgSessionEventTap,
  place: .headInsertEventTap,
  options: .listenOnly,
  eventsOfInterest: eventMask,
  callback: { _, eventType, event, _ in
    if eventType == .keyDown, let signal = signalForKeyDown(event) {
      emitOnce(signal)
    }
    return Unmanaged.passUnretained(event)
  },
  userInfo: nil
)

guard let eventTap else {
  fputs("Unable to create browser keyboard event tap\n", stderr)
  exit(1)
}

let runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, eventTap, 0)
CFRunLoopAddSource(CFRunLoopGetCurrent(), runLoopSource, .commonModes)
CGEvent.tapEnable(tap: eventTap, enable: true)
Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in
  if getppid() != originalParentPid {
    exit(0)
  }
}
CFRunLoopRun()
