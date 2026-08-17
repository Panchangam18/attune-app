import CoreGraphics
import Foundation

let keyCodes: [String: CGKeyCode] = [
  "KeyA": 0, "KeyS": 1, "KeyD": 2, "KeyF": 3, "KeyH": 4, "KeyG": 5,
  "KeyZ": 6, "KeyX": 7, "KeyC": 8, "KeyV": 9, "KeyB": 11,
  "KeyQ": 12, "KeyW": 13, "KeyE": 14, "KeyR": 15, "KeyY": 16, "KeyT": 17,
  "Digit1": 18, "Digit2": 19, "Digit3": 20, "Digit4": 21, "Digit6": 22,
  "Digit5": 23, "Equal": 24, "Digit9": 25, "Digit7": 26, "Minus": 27,
  "Digit8": 28, "Digit0": 29, "BracketRight": 30, "KeyO": 31, "KeyU": 32,
  "BracketLeft": 33, "KeyI": 34, "KeyP": 35, "Enter": 36, "KeyL": 37,
  "KeyJ": 38, "Quote": 39, "KeyK": 40, "Semicolon": 41, "Backslash": 42,
  "Comma": 43, "Slash": 44, "KeyN": 45, "KeyM": 46, "Period": 47,
  "Tab": 48, "Space": 49, "Backquote": 50, "Backspace": 51, "Escape": 53,
  "F17": 64, "NumpadDecimal": 65, "NumpadMultiply": 67, "NumpadAdd": 69,
  "NumLock": 71, "NumpadDivide": 75, "NumpadEnter": 76, "NumpadSubtract": 78,
  "F18": 79, "F19": 80, "NumpadEqual": 81, "Numpad0": 82, "Numpad1": 83,
  "Numpad2": 84, "Numpad3": 85, "Numpad4": 86, "Numpad5": 87, "Numpad6": 88,
  "Numpad7": 89, "F20": 90, "Numpad8": 91, "Numpad9": 92, "F5": 96,
  "F6": 97, "F7": 98, "F3": 99, "F8": 100, "F9": 101, "F11": 103,
  "F13": 105, "F16": 106, "F14": 107, "F10": 109, "F12": 111, "F15": 113,
  "Home": 115, "PageUp": 116, "Delete": 117, "F4": 118, "End": 119,
  "F2": 120, "PageDown": 121, "F1": 122, "ArrowLeft": 123, "ArrowRight": 124,
  "ArrowDown": 125, "ArrowUp": 126,
]

func fail(_ message: String) -> Never {
  FileHandle.standardError.write(Data("\(message)\n".utf8))
  exit(1)
}

let arguments = CommandLine.arguments
guard arguments.count == 4 else { fail("usage: key-chord-forwarder <pid> <code> <modifiers>") }
guard let pid = pid_t(arguments[1]), pid > 0 else { fail("invalid target pid") }
guard let keyCode = keyCodes[arguments[2]] else { fail("unsupported keyboard code: \(arguments[2])") }

let requestedModifiers = Set(arguments[3].split(separator: ",").map(String.init))
let modifierKeys: [(name: String, keyCode: CGKeyCode, flag: CGEventFlags)] = [
  ("meta", 55, .maskCommand),
  ("ctrl", 59, .maskControl),
  ("alt", 58, .maskAlternate),
  ("shift", 56, .maskShift),
]
let activeModifiers = modifierKeys.filter { requestedModifiers.contains($0.name) }
let eventSource = CGEventSource(stateID: .privateState)

func post(keyCode: CGKeyCode, keyDown: Bool, flags: CGEventFlags) {
  guard let event = CGEvent(keyboardEventSource: eventSource, virtualKey: keyCode, keyDown: keyDown) else {
    fail("could not create keyboard event")
  }
  event.flags = flags
  event.postToPid(pid)
}

var flags: CGEventFlags = []
for modifier in activeModifiers {
  flags.insert(modifier.flag)
  post(keyCode: modifier.keyCode, keyDown: true, flags: flags)
}
post(keyCode: keyCode, keyDown: true, flags: flags)
post(keyCode: keyCode, keyDown: false, flags: flags)
for modifier in activeModifiers.reversed() {
  flags.remove(modifier.flag)
  post(keyCode: modifier.keyCode, keyDown: false, flags: flags)
}

print("forwarded")
