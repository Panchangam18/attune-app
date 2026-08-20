import { execFile } from 'node:child_process';

import type {
  ComponentSmuggleKeyChord,
  ComponentSmuggleKeyForwarder,
  ComponentSmugglePageClient,
} from './component-smuggler.js';
import { serializeSafariCommand } from './safari-command-queue.js';

export interface SafariPageReference {
  appPid: number;
  windowId: number;
  tabIndex: number;
  url: string;
}

function quoteAppleScriptString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ')}"`;
}

function quoteAppleScriptJavaScript(value: string): string {
  const lines = value.replace(/\r\n?/g, '\n').split('\n');
  return `(${lines.map(quoteAppleScriptString).join(' & linefeed & ')})`;
}

function runAppleScript(script: string, timeoutMs: number): Promise<string> {
  return serializeSafariCommand(() => new Promise((resolve, reject) => {
    execFile('/usr/bin/osascript', ['-e', script], {
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error((stderr || stdout || error.message).trim()));
        return;
      }
      resolve(stdout.trim());
    });
  }));
}

/**
 * Extension-free Safari control plane. Apple Events carries only compact DOM
 * commands; the high-rate visual stream remains in ScreenCaptureKit.
 */
export class SafariAppleEventsPageClient implements ComponentSmugglePageClient {
  readonly recommendedPumpIntervalMs = 220;
  readonly pollSourceMutations = false;

  constructor(
    private readonly page: SafariPageReference,
    private readonly forwardKeyChord?: ComponentSmuggleKeyForwarder,
  ) {}

  async connect(): Promise<void> {
    await this.evaluate(`(() => {
      globalThis.__attuneNativeWindowId = ${this.page.windowId};
      return true;
    })()`);
  }

  async evaluate(expression: string, timeoutMs = 5000): Promise<any> {
    const javascript = `JSON.stringify((() => {
      try {
        const value = (${expression});
        return { ok: true, value: value === undefined ? null : value };
      } catch (error) {
        return { ok: false, error: String(error && (error.stack || error.message) || error) };
      }
    })())`;
    // Keep the runtime multiline so an ordinary // comment cannot consume the
    // statements after it. Send it as direct source: CSP-hardened sites such as
    // YouTube intentionally reject eval/new Function, even through Apple Events.
    const script = `tell application "Safari"
      if not (exists window id ${this.page.windowId}) then error "Safari source window is unavailable"
      set sourceWindow to window id ${this.page.windowId}
      if (count of tabs of sourceWindow) < ${this.page.tabIndex} then error "Safari source tab is unavailable"
      set sourceTab to tab ${this.page.tabIndex} of sourceWindow
      return do JavaScript ${quoteAppleScriptJavaScript(javascript)} in sourceTab
    end tell`;
    const raw = await runAppleScript(script, timeoutMs);
    let packet: { ok?: boolean; value?: unknown; error?: string };
    try {
      packet = JSON.parse(raw) as typeof packet;
    } catch {
      throw new Error(`Safari returned an invalid JavaScript result: ${raw.slice(0, 160)}`);
    }
    if (!packet.ok) throw new Error(packet.error || 'Safari JavaScript failed');
    return packet.value;
  }

  private async clickAtPointExpression(pointExpression: string): Promise<void> {
    await this.evaluate(`(() => {
      const point = ${pointExpression};
      if (!point) return false;
      const x = Number(point.x);
      const y = Number(point.y);
      const element = document.elementFromPoint(x, y);
      if (!element) return false;
      const options = {
        bubbles: true, composed: true, cancelable: true,
        clientX: x, clientY: y, button: 0, buttons: 1,
      };
      element.dispatchEvent(new PointerEvent('pointerdown', options));
      element.dispatchEvent(new MouseEvent('mousedown', options));
      element.dispatchEvent(new PointerEvent('pointerup', { ...options, buttons: 0 }));
      element.dispatchEvent(new MouseEvent('mouseup', { ...options, buttons: 0 }));
      element.click();
      return true;
    })()`);
  }

  async click(x: number, y: number): Promise<void> {
    await this.clickAtPointExpression(`({ x: ${Number(x)}, y: ${Number(y)} })`);
  }

  async clickAtComponentPosition(position?: { xRatio?: number; yRatio?: number }): Promise<void> {
    await this.clickAtPointExpression(
      `globalThis.__attuneComponentSmuggleSource?.capturePoint?.(${JSON.stringify(position || null)}) || null`,
    );
  }

  private async moveAtPointExpression(pointExpression: string): Promise<void> {
    await this.evaluate(`(() => {
      const point = ${pointExpression};
      if (!point) return false;
      const x = Number(point.x);
      const y = Number(point.y);
      const next = x >= 0 && y >= 0
        ? document.elementFromPoint(x, y)
        : null;
      const previous = globalThis.__attuneSmuggleHoverElement || null;
      const PointerEventConstructor = globalThis.PointerEvent || globalThis.MouseEvent;
      const fire = (element, name, Constructor, relatedTarget, bubbles) => {
        if (!element) return;
        element.dispatchEvent(new Constructor(name, {
          bubbles, composed: true, cancelable: false, relatedTarget,
          clientX: x, clientY: y, button: 0, buttons: 0,
        }));
      };
      if (previous !== next) {
        fire(previous, 'pointerout', PointerEventConstructor, next, true);
        fire(previous, 'mouseout', MouseEvent, next, true);
        fire(previous, 'pointerleave', PointerEventConstructor, next, false);
        fire(previous, 'mouseleave', MouseEvent, next, false);
        fire(next, 'pointerover', PointerEventConstructor, previous, true);
        fire(next, 'mouseover', MouseEvent, previous, true);
        fire(next, 'pointerenter', PointerEventConstructor, previous, false);
        fire(next, 'mouseenter', MouseEvent, previous, false);
      }
      if (next) {
        fire(next, 'pointermove', PointerEventConstructor, previous, true);
        fire(next, 'mousemove', MouseEvent, previous, true);
      }
      globalThis.__attuneSmuggleHoverElement = next;
      return true;
    })()`);
  }

  async move(x: number, y: number): Promise<void> {
    await this.moveAtPointExpression(`({ x: ${Number(x)}, y: ${Number(y)} })`);
  }

  async moveAtComponentPosition(position?: { xRatio?: number; yRatio?: number } | null): Promise<void> {
    await this.moveAtPointExpression(
      `globalThis.__attuneComponentSmuggleSource?.hoverPoint?.(${JSON.stringify(position || null)}) || null`,
    );
  }

  async wheel(
    x: number,
    y: number,
    deltaX: number,
    deltaY: number,
    modifiers: { altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean } = {},
  ): Promise<void> {
    await this.wheelAtPointExpression(
      `({ x: ${Number(x)}, y: ${Number(y)} })`, deltaX, deltaY, modifiers,
    );
  }

  async wheelAtComponentPosition(
    position: { xRatio?: number; yRatio?: number },
    deltaX: number,
    deltaY: number,
    modifiers: { altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean } = {},
  ): Promise<void> {
    await this.wheelAtPointExpression(
      `globalThis.__attuneComponentSmuggleSource?.hoverPoint?.(${JSON.stringify(position || null)}) || null`,
      deltaX, deltaY, modifiers,
    );
  }

  private async wheelAtPointExpression(
    pointExpression: string,
    deltaX: number,
    deltaY: number,
    modifiers: { altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean } = {},
  ): Promise<void> {
    await this.evaluate(`(() => {
      const point = ${pointExpression};
      if (!point) return false;
      const x = Number(point.x);
      const y = Number(point.y);
      const deltaX = ${Number(deltaX)};
      const deltaY = ${Number(deltaY)};
      const target = x >= 0 && y >= 0 ? document.elementFromPoint(x, y) : null;
      if (!target) return false;
      const scrollState = [];
      for (let node = target; node && node.nodeType === 1; node = node.parentElement) {
        scrollState.push({ node, left: node.scrollLeft, top: node.scrollTop });
      }
      const wheelEvent = new WheelEvent('wheel', {
        bubbles: true, composed: true, cancelable: true,
        clientX: x, clientY: y, deltaX, deltaY, deltaMode: WheelEvent.DOM_DELTA_PIXEL,
        altKey: ${Boolean(modifiers.altKey)}, ctrlKey: ${Boolean(modifiers.ctrlKey)},
        metaKey: ${Boolean(modifiers.metaKey)}, shiftKey: ${Boolean(modifiers.shiftKey)},
      });
      const useDefaultScroll = target.dispatchEvent(wheelEvent);
      if (!useDefaultScroll) return true;
      if (scrollState.some(({ node, left, top }) => node.scrollLeft !== left || node.scrollTop !== top)) return true;
      const overflowAllowsScroll = (value) => /^(auto|scroll|overlay)$/.test(String(value || ''));
      for (let node = target; node && node.nodeType === 1; node = node.parentElement) {
        const style = getComputedStyle(node);
        const canScrollX = Math.abs(deltaX) > 0 && node.scrollWidth > node.clientWidth && overflowAllowsScroll(style.overflowX);
        const canScrollY = Math.abs(deltaY) > 0 && node.scrollHeight > node.clientHeight && overflowAllowsScroll(style.overflowY);
        if (!canScrollX && !canScrollY) continue;
        if (canScrollX) node.scrollLeft += deltaX;
        if (canScrollY) node.scrollTop += deltaY;
        return true;
      }
      globalThis.scrollBy(deltaX, deltaY);
      return true;
    })()`);
  }

  async insertText(value: string): Promise<void> {
    await this.insertTextAtElementExpression('document.activeElement', value);
  }

  async insertTextInPrimaryEditable(value: string): Promise<boolean> {
    return this.insertTextAtElementExpression(
      `(() => {
        const focused = globalThis.__attuneComponentSmuggleSource?.focusPrimaryEditable?.();
        return focused?.ok ? document.activeElement : null;
      })()`,
      value,
    );
  }

  private async insertTextAtElementExpression(elementExpression: string, value: string): Promise<boolean> {
    return Boolean(await this.evaluate(`(() => {
      const element = ${elementExpression};
      if (!element) return false;
      const text = ${JSON.stringify(value)};
      if (typeof element.setRangeText === 'function' && 'selectionStart' in element) {
        const start = Number(element.selectionStart) || 0;
        const end = Number(element.selectionEnd) || start;
        element.setRangeText(text, start, end, 'end');
        element.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: text }));
        return true;
      }
      if (element.isContentEditable) return document.execCommand('insertText', false, text);
      return false;
    })()`));
  }

  async pressKey(
    key: string,
    code: string,
    modifiers: { altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean } = {},
  ): Promise<void> {
    if (!this.forwardKeyChord) throw new Error('Safari native key forwarding is unavailable');
    await this.forwardKeyChord({ key, code, ...modifiers } as ComponentSmuggleKeyChord);
  }

  close(): void {}
}
