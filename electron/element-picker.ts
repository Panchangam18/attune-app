export const ELEMENT_PICKER_ACCELERATOR = 'CommandOrControl+Option+A';
export const ELEMENT_PICKER_TIMEOUT_MS = 5 * 60 * 1000;
export const ELEMENT_SELECTION_TTL_MS = 24 * 60 * 60 * 1000;
export const ELEMENT_SMUGGLE_ANCHOR_ATTRIBUTE = 'data-attune-smuggle-anchor';

export type ElementPickerIntent = 'reference' | 'smuggle-source' | 'smuggle-target';
export type ElementSmugglePlacement = 'inside' | 'top' | 'bottom' | 'left' | 'right';

export interface ElementPickerOptions {
  mode?: 'reference' | 'smuggle-target';
  anchorToken?: string;
}

export interface ElementPickerFingerprint {
  tag: string;
  domRole: string;
  label: string;
  text: string;
  attributes: Record<string, string>;
  classes: string[];
  ancestor: {
    tag: string;
    domRole: string;
    label: string;
  } | null;
}

export interface ElementPickerSelection {
  status: 'selected';
  intent: ElementPickerIntent;
  pageTitle: string;
  roles: string[];
  selector: string;
  selectorStability: 'semantic' | 'high' | 'medium' | 'low';
  placement?: ElementSmugglePlacement;
  fingerprint: ElementPickerFingerprint;
  bounds: { x: number; y: number; width: number; height: number };
  styles: {
    display: string;
    position: string;
    color: string;
    backgroundColor: string;
    fontSize: string;
    fontFamily: string;
    borderRadius: string;
  };
}

export interface ElementPickerCancellation {
  status: 'cancelled';
}

export type ElementPickerResult = ElementPickerSelection | ElementPickerCancellation;

export interface ElementSelectionReceipt extends ElementPickerSelection {
  schemaVersion: 1;
  selectionId: string;
  appId: string;
  appName: string;
  selectedAt: string;
  expiresAt: string;
}

/**
 * Build the temporary, self-contained picker that runs in an attached renderer.
 * No user-provided JavaScript is evaluated and every listener/DOM node is removed
 * after selection, cancellation, replacement, or timeout.
 */
export function buildElementPickerExpression(
  appName: string,
  frozenFrameDataUrl: string | null = null,
  options: ElementPickerOptions = {},
): string {
  const safeOptions = {
    mode: options.mode === 'smuggle-target' ? 'smuggle-target' : 'reference',
    anchorToken: String(options.anchorToken || '').slice(0, 80),
  };
  return `(${runElementPicker.toString()})(${JSON.stringify(appName)}, ${JSON.stringify(frozenFrameDataUrl)}, ${ELEMENT_PICKER_TIMEOUT_MS}, ${JSON.stringify(safeOptions)})`;
}

export function isElementPickerResult(value: unknown): value is ElementPickerResult {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ElementPickerResult>;
  if (candidate.status === 'cancelled') return true;
  if (candidate.status !== 'selected') return false;
  const selection = candidate as Partial<ElementPickerSelection>;
  return Array.isArray(selection.roles)
    && (selection.intent === 'reference' || selection.intent === 'smuggle-source' || selection.intent === 'smuggle-target')
    && (selection.placement === undefined || selection.placement === 'inside' || selection.placement === 'top' || selection.placement === 'bottom' || selection.placement === 'left' || selection.placement === 'right')
    && typeof selection.selector === 'string'
    && Boolean(selection.fingerprint)
    && typeof selection.fingerprint?.tag === 'string'
    && Boolean(selection.bounds)
    && Boolean(selection.styles);
}

export function formatElementReference(receipt: ElementSelectionReceipt, receiptPath: string): string {
  const fingerprint = receipt.fingerprint;
  const semantic = receipt.roles.length > 0;
  const elementDetails = [
    `<${fingerprint.tag || 'element'}>`,
    fingerprint.domRole ? `role=${JSON.stringify(fingerprint.domRole)}` : '',
    fingerprint.label ? `label=${JSON.stringify(fingerprint.label)}` : '',
  ].filter(Boolean).join(' ');
  const ancestor = fingerprint.ancestor
    ? [
      `<${fingerprint.ancestor.tag || 'element'}>`,
      fingerprint.ancestor.domRole ? `role=${JSON.stringify(fingerprint.ancestor.domRole)}` : '',
      fingerprint.ancestor.label ? `label=${JSON.stringify(fingerprint.ancestor.label)}` : '',
    ].filter(Boolean).join(' ')
    : '';
  const styleSummary = [
    `display=${receipt.styles.display}`,
    `position=${receipt.styles.position}`,
    `color=${receipt.styles.color}`,
    `background=${receipt.styles.backgroundColor}`,
    `font-size=${receipt.styles.fontSize}`,
    `border-radius=${receipt.styles.borderRadius}`,
  ].join('; ');

  return [
    'Attune element reference (selected by the user)',
    `App: ${receipt.appName}`,
    semantic
      ? `Semantic role${receipt.roles.length === 1 ? '' : 's'}: ${receipt.roles.join(', ')}`
      : 'Semantic role: unmapped',
    semantic ? `Selector: ${receipt.selector}` : `Diagnostic selector (${receipt.selectorStability} stability): ${receipt.selector}`,
    `Element: ${elementDetails}`,
    ancestor ? `Parent context: ${ancestor}` : '',
    !fingerprint.label && fingerprint.text ? `Visible text: ${JSON.stringify(fingerprint.text)}` : '',
    `Bounds: x=${receipt.bounds.x}, y=${receipt.bounds.y}, width=${receipt.bounds.width}, height=${receipt.bounds.height}`,
    `Current styles: ${styleSummary}`,
    `Receipt: ${receiptPath}`,
  ].filter(Boolean).join('\n');
}

/** Serialized into the target renderer by buildElementPickerExpression(). */
function runElementPicker(
  appName: string,
  frozenFrameDataUrl: string | null,
  timeoutMs: number,
  pickerOptions: { mode: 'reference' | 'smuggle-target'; anchorToken: string },
) {
  const runtime = globalThis as unknown as {
    document: any;
    window: any;
    Element: { new (...args: any[]): any };
    CSS: { escape(value: string): string };
    getComputedStyle(element: any): any;
    innerWidth: number;
    innerHeight: number;
    setTimeout(callback: () => void, milliseconds: number): ReturnType<typeof setTimeout>;
    clearTimeout(timer: ReturnType<typeof setTimeout>): void;
  };
  const doc = runtime.document;
  const win = runtime.window;
  const pickerNodeAttribute = 'data-attune-element-picker';
  const pickerActiveAttribute = 'data-attune-element-picker-active';
  const existingCleanup = win.__attuneElementPickerCleanup;
  if (typeof existingCleanup === 'function') existingCleanup('replaced');

  return new Promise<string>((resolve) => {
    let settled = false;
    let listenersActive = true;
    let pointerElement: any = null;
    let chain: any[] = [];
    let chainIndex = 0;
    let lastPoint = { x: 0, y: 0 };
    const root = doc.documentElement;
    const previousPickerActiveValue = root.getAttribute(pickerActiveAttribute);
    root.setAttribute(pickerActiveAttribute, 'true');

    const style = doc.createElement('style');
    style.setAttribute(pickerNodeAttribute, 'style');
    style.textContent = `
      html[${pickerActiveAttribute}="true"] *,
      html[${pickerActiveAttribute}="true"] *::before,
      html[${pickerActiveAttribute}="true"] *::after {
        animation-play-state: paused !important;
        transition-duration: 0s !important;
        scroll-behavior: auto !important;
        caret-color: transparent !important;
        cursor: crosshair !important;
      }
      [data-attune-element-picker="freeze"] {
        display: block !important;
        position: fixed !important;
        inset: 0 !important;
        z-index: 2147483647 !important;
        width: 100vw !important;
        height: 100vh !important;
        margin: 0 !important;
        padding: 0 !important;
        border: 0 !important;
        pointer-events: none !important;
        object-fit: fill !important;
        user-select: none !important;
      }
      [data-attune-element-picker="outline"] {
        display: block !important;
        position: fixed !important;
        z-index: 2147483647 !important;
        pointer-events: none !important;
        box-sizing: border-box !important;
        border: 2px solid #d8c88f !important;
        background: rgb(112 173 135 / 18%) !important;
        box-shadow: 0 8px 28px rgb(0 0 0 / 28%) !important;
      }
      [data-attune-element-picker="label"] {
        display: block !important;
        position: fixed !important;
        z-index: 2147483647 !important;
        pointer-events: none !important;
        box-sizing: border-box !important;
        max-width: min(520px, calc(100vw - 24px)) !important;
        padding: 7px 9px !important;
        border: 1px solid #d8c88f !important;
        border-radius: 6px !important;
        color: #ebe9e4 !important;
        background: #101211 !important;
        box-shadow: 0 8px 28px rgb(0 0 0 / 36%) !important;
        font: 600 12px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
        letter-spacing: 0 !important;
        white-space: normal !important;
      }
      [data-attune-element-picker="placement"] {
        position: fixed !important;
        z-index: 2147483647 !important;
        pointer-events: none !important;
        box-sizing: border-box !important;
        width: 6px !important;
        min-width: 6px !important;
        border-radius: 999px !important;
        background: #f3d66f !important;
        box-shadow: 0 0 0 2px rgb(16 18 17 / 90%), 0 5px 20px rgb(0 0 0 / 40%) !important;
      }
    `;
    const freezeFrame = frozenFrameDataUrl ? doc.createElement('img') : null;
    if (freezeFrame) {
      freezeFrame.setAttribute(pickerNodeAttribute, 'freeze');
      freezeFrame.setAttribute('alt', '');
      freezeFrame.setAttribute('aria-hidden', 'true');
      freezeFrame.setAttribute('draggable', 'false');
      freezeFrame.src = frozenFrameDataUrl;
    }
    const outline = doc.createElement('div');
    outline.setAttribute(pickerNodeAttribute, 'outline');
    const label = doc.createElement('div');
    label.setAttribute(pickerNodeAttribute, 'label');
    const placementIndicator = doc.createElement('div');
    placementIndicator.setAttribute(pickerNodeAttribute, 'placement');
    placementIndicator.style.setProperty('display', 'none', 'important');
    (doc.head || doc.documentElement).appendChild(style);
    (doc.body || doc.documentElement).append(...[freezeFrame, outline, placementIndicator, label].filter(Boolean));

    const clean = (value: unknown, limit = 120) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
    const isPickerNode = (element: any) => Boolean(element?.closest?.(`[${pickerNodeAttribute}]`));
    const isSmuggleResizeHandle = (event: any) => (event.composedPath?.() || []).some((item: any) => (
      item?.hasAttribute?.('data-attune-smuggle-resize-handle')
    ));
    const isSmuggleResizeInteraction = (event: any) => (
      isSmuggleResizeHandle(event) || Boolean(win.__attuneComponentSmuggleTarget?.isResizing?.())
    );
    const rolesFor = (element: any) => clean(element?.getAttribute?.('data-attune-host-roles'), 300).split(/\s+/).filter(Boolean);
    const accessibleLabel = (element: any) => clean(
      element?.getAttribute?.('aria-label')
        || element?.getAttribute?.('title')
        || element?.getAttribute?.('placeholder'),
    );
    const preferredElement = (element: any) => {
      // Smuggling is component-oriented. Prefer Attune's semantic component even
      // when the pointer lands on a generated leaf inside it (for example,
      // Slack's empty contenteditable <p>). ArrowDown still lets the user walk
      // back toward an exact descendant when that is intentional.
      const semantic = element?.closest?.('[data-attune-host-roles]');
      if (semantic && semantic !== doc.body && semantic !== doc.documentElement) return semantic;
      return element?.closest?.(
        'button, a, input, textarea, select, [role], [aria-label], [data-testid], [data-test-id], [data-qa]',
      ) || element;
    };
    const buildChain = (rawElement: any) => {
      const result = [];
      let current = rawElement;
      while (current && current !== doc.documentElement && result.length < 18) {
        if (!isPickerNode(current)) result.push(current);
        current = current.parentElement;
      }
      const preferred = preferredElement(rawElement);
      const preferredIndex = result.indexOf(preferred);
      return { result, preferredIndex: preferredIndex >= 0 ? preferredIndex : 0 };
    };
    const currentElement = () => chain[chainIndex] || pointerElement;
    const placementFor = (element: any, point = lastPoint): ElementSmugglePlacement => {
      if (pickerOptions.mode !== 'smuggle-target') return 'inside';
      const bounds = element?.getBoundingClientRect?.();
      if (!bounds || bounds.width <= 0 || bounds.height <= 0) return 'inside';
      const verticalRatio = (Number(point?.y) - bounds.top) / bounds.height;
      if (verticalRatio <= 0.3) return 'top';
      if (verticalRatio >= 0.7) return 'bottom';
      const horizontalRatio = (Number(point?.x) - bounds.left) / bounds.width;
      if (horizontalRatio <= 0.3) return 'left';
      if (horizontalRatio >= 0.7) return 'right';
      return 'inside';
    };

    const positionOverlay = () => {
      const element = currentElement();
      if (!element?.isConnected) return;
      const bounds = element.getBoundingClientRect();
      outline.style.setProperty('display', 'block', 'important');
      label.style.setProperty('display', 'block', 'important');
      outline.style.left = `${Math.max(0, bounds.left)}px`;
      outline.style.top = `${Math.max(0, bounds.top)}px`;
      outline.style.width = `${Math.max(0, Math.min(bounds.width, runtime.innerWidth - Math.max(0, bounds.left)))}px`;
      outline.style.height = `${Math.max(0, Math.min(bounds.height, runtime.innerHeight - Math.max(0, bounds.top)))}px`;
      const roles = rolesFor(element);
      const tag = element.tagName?.toLowerCase?.() || 'element';
      const name = accessibleLabel(element) || clean(element.innerText || element.textContent, 64);
      const placement = placementFor(element);
      const modeLabel = pickerOptions.mode === 'smuggle-target'
        ? placement === 'top'
          ? 'Place in TOP of highlighted component'
          : placement === 'bottom'
            ? 'Place in BOTTOM of highlighted component'
          : placement === 'left'
            ? 'Place in LEFT side of highlighted component'
          : placement === 'right'
            ? 'Place in RIGHT side of highlighted component'
            : 'Insert INSIDE highlighted component'
        : 'Click to copy · Option-click highlighted component to smuggle';
      if (pickerOptions.mode === 'smuggle-target' && placement !== 'inside') {
        placementIndicator.style.setProperty('display', 'block', 'important');
        if (placement === 'top' || placement === 'bottom') {
          placementIndicator.style.left = `${Math.max(0, bounds.left)}px`;
          placementIndicator.style.top = `${Math.max(0, Math.min(runtime.innerHeight - 6, placement === 'top' ? bounds.top - 3 : bounds.bottom - 3))}px`;
          placementIndicator.style.width = `${Math.max(8, Math.min(bounds.width, runtime.innerWidth - Math.max(0, bounds.left)))}px`;
          placementIndicator.style.height = '6px';
        } else {
          placementIndicator.style.left = `${Math.max(0, Math.min(runtime.innerWidth - 6, placement === 'left' ? bounds.left - 3 : bounds.right - 3))}px`;
          placementIndicator.style.top = `${Math.max(0, bounds.top)}px`;
          placementIndicator.style.width = '6px';
          placementIndicator.style.height = `${Math.max(8, Math.min(bounds.height, runtime.innerHeight - Math.max(0, bounds.top)))}px`;
        }
      } else {
        placementIndicator.style.setProperty('display', 'none', 'important');
      }
      label.textContent = `${modeLabel}  ·  ${roles.length ? roles.join(' · ') : 'Unmapped'}  <${tag}>${name ? `  ${name}` : ''}`;
      const labelLeft = Math.max(8, Math.min(bounds.left, runtime.innerWidth - Math.min(520, label.offsetWidth || 260) - 8));
      const below = bounds.bottom + 8;
      const labelTop = below + (label.offsetHeight || 34) < runtime.innerHeight
        ? below
        : Math.max(8, bounds.top - (label.offsetHeight || 34) - 8);
      label.style.left = `${labelLeft}px`;
      label.style.top = `${labelTop}px`;
    };

    const unique = (selector: string) => {
      try { return doc.querySelectorAll(selector).length === 1; } catch { return false; }
    };
    const attributeSelector = (element: any) => {
      if (element.id) {
        const selector = `#${runtime.CSS.escape(element.id)}`;
        if (unique(selector)) return { selector, stability: 'high' };
      }
      for (const attribute of ['data-testid', 'data-test-id', 'data-qa', 'aria-label', 'name']) {
        const value = element.getAttribute?.(attribute);
        if (!value) continue;
        const selector = `[${attribute}=${JSON.stringify(value)}]`;
        if (unique(selector)) return { selector, stability: 'high' };
      }
      const domRole = element.getAttribute?.('role');
      const ariaLabel = element.getAttribute?.('aria-label');
      if (domRole && ariaLabel) {
        const selector = `[role=${JSON.stringify(domRole)}][aria-label=${JSON.stringify(ariaLabel)}]`;
        if (unique(selector)) return { selector, stability: 'high' };
      }
      if (domRole) {
        const selector = `[role=${JSON.stringify(domRole)}]`;
        if (unique(selector)) return { selector, stability: 'medium' };
      }
      return null;
    };
    const diagnosticSelector = (element: any) => {
      const semanticRoles = rolesFor(element);
      if (semanticRoles.length) {
        return {
          selector: `[data-attune-host-roles~=${JSON.stringify(semanticRoles[0])}]`,
          stability: 'semantic',
        };
      }
      const direct = attributeSelector(element);
      if (direct) return direct;
      const segments = [];
      let current = element;
      while (current && current !== doc.documentElement && segments.length < 5) {
        const stable = attributeSelector(current);
        if (stable) {
          segments.unshift(stable.selector);
          return { selector: segments.join(' > '), stability: 'medium' };
        }
        let segment = current.tagName?.toLowerCase?.() || '*';
        const stableClasses = [...(current.classList || [])]
          .filter((name: string) => /^[a-z][a-z0-9_-]{2,48}$/i.test(name) && !/\d{3,}|[a-f0-9]{8,}/i.test(name))
          .slice(0, 2);
        if (stableClasses.length) segment += `.${stableClasses.map((name: string) => runtime.CSS.escape(name)).join('.')}`;
        const siblings = current.parentElement
          ? [...current.parentElement.children].filter((sibling: any) => sibling.tagName === current.tagName)
          : [];
        if (siblings.length > 1) segment += `:nth-of-type(${siblings.indexOf(current) + 1})`;
        segments.unshift(segment);
        const candidate = segments.join(' > ');
        if (unique(candidate)) return { selector: candidate, stability: stableClasses.length ? 'medium' : 'low' };
        current = current.parentElement;
      }
      return { selector: segments.join(' > '), stability: 'low' };
    };
    const describe = (element: any) => element ? {
      tag: element.tagName?.toLowerCase?.() || '',
      domRole: clean(element.getAttribute?.('role')),
      label: accessibleLabel(element),
    } : null;
    const captureSelection = (
      element: any,
      intent: 'reference' | 'smuggle-source' | 'smuggle-target',
      placement: ElementSmugglePlacement = 'inside',
    ) => {
      const bounds = element.getBoundingClientRect();
      const computed = runtime.getComputedStyle(element);
      const attributes: Record<string, string> = {};
      for (const name of ['id', 'role', 'aria-label', 'aria-labelledby', 'title', 'placeholder', 'name', 'data-testid', 'data-test-id', 'data-qa']) {
        const value = clean(element.getAttribute?.(name), 160);
        if (value) attributes[name] = value;
      }
      const selector = diagnosticSelector(element);
      return {
        status: 'selected',
        intent,
        pageTitle: clean(doc.title, 160),
        roles: rolesFor(element),
        selector: selector.selector,
        selectorStability: selector.stability,
        placement,
        fingerprint: {
          tag: element.tagName?.toLowerCase?.() || '',
          domRole: clean(element.getAttribute?.('role')),
          label: accessibleLabel(element),
          text: clean(element.innerText || element.textContent, 160),
          attributes,
          classes: [...(element.classList || [])]
            .filter((name: string) => /^[a-z][a-z0-9_-]{2,48}$/i.test(name) && !/\d{3,}|[a-f0-9]{8,}/i.test(name))
            .slice(0, 8),
          ancestor: describe(element.parentElement),
        },
        bounds: {
          x: Math.round(bounds.x),
          y: Math.round(bounds.y),
          width: Math.round(bounds.width),
          height: Math.round(bounds.height),
        },
        styles: {
          display: computed.display,
          position: computed.position,
          color: computed.color,
          backgroundColor: computed.backgroundColor,
          fontSize: computed.fontSize,
          fontFamily: computed.fontFamily,
          borderRadius: computed.borderRadius,
        },
      };
    };

    const removeListeners = () => {
      if (!listenersActive) return;
      listenersActive = false;
      win.removeEventListener('pointermove', onPointerMove, true);
      win.removeEventListener('click', onClick, true);
      win.removeEventListener('keydown', onKeyDown, true);
      for (const eventName of blockedEventNames) win.removeEventListener(eventName, blockHostEvent, true);
      win.removeEventListener('resize', positionOverlay, true);
      win.removeEventListener('scroll', positionOverlay, true);
    };
    const removeNodes = () => {
      style.remove();
      freezeFrame?.remove();
      outline.remove();
      placementIndicator.remove();
      label.remove();
      if (previousPickerActiveValue === null) root.removeAttribute(pickerActiveAttribute);
      else root.setAttribute(pickerActiveAttribute, previousPickerActiveValue);
      if (win.__attuneElementPickerCleanup === cancel) delete win.__attuneElementPickerCleanup;
      if (win.__attuneElementPickerComplete === complete) delete win.__attuneElementPickerComplete;
      if (win.__attuneElementPickerCommand === applyPickerCommand) delete win.__attuneElementPickerCommand;
    };
    const finish = (result: Record<string, unknown>) => {
      if (settled) return;
      settled = true;
      runtime.clearTimeout(timeout);
      removeListeners();
      resolve(JSON.stringify(result));
    };
    const cancel = (_reason?: string) => {
      finish({ status: 'cancelled' });
      removeNodes();
    };
    const complete = () => {
      removeListeners();
      outline.style.setProperty('display', 'none', 'important');
      placementIndicator.style.setProperty('display', 'none', 'important');
      label.textContent = `${appName} element copied`;
      label.style.top = '12px';
      label.style.left = '50%';
      label.style.transform = 'translateX(-50%)';
      runtime.setTimeout(removeNodes, 900);
    };
    function onPointerMove(event: any) {
      if (isSmuggleResizeInteraction(event)) return;
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      const raw = (event.composedPath?.() || []).find((item: any) => item instanceof runtime.Element && !isPickerNode(item))
        || doc.elementFromPoint(event.clientX, event.clientY);
      if (!raw || isPickerNode(raw)) return;
      lastPoint = { x: event.clientX, y: event.clientY };
      if (raw !== pointerElement) {
        pointerElement = raw;
        const next = buildChain(raw);
        chain = next.result;
        chainIndex = next.preferredIndex;
      }
      positionOverlay();
    }
    function onClick(event: any) {
      if (isSmuggleResizeHandle(event)) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        return;
      }
      const eventPath = event.composedPath?.() || [];
      const smuggleClose = eventPath.find((item: any) => (
        item?.getAttribute?.('aria-label') === 'Stop component smuggling'
      ));
      if (smuggleClose && win.__attuneComponentSmuggleTarget?.requestClose?.(Boolean(event.isTrusted))) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        cancel('smuggle-close');
        return;
      }
      const intent = pickerOptions.mode === 'smuggle-target'
        ? 'smuggle-target'
        : event.altKey ? 'smuggle-source' : 'reference';
      // Option is the command that changes the intent; it must not silently
      // change the highlighted component into the deepest raw DOM leaf.
      const selected = currentElement();
      if (!selected || isPickerNode(selected)) return;
      lastPoint = { x: Number(event.clientX) || lastPoint.x, y: Number(event.clientY) || lastPoint.y };
      const placement = intent === 'smuggle-target' ? placementFor(selected, lastPoint) : 'inside';
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      if (intent !== 'reference' && pickerOptions.anchorToken) {
        win.__attuneSmuggleAnchors ||= {};
        win.__attuneSmuggleAnchors[pickerOptions.anchorToken] = selected;
        selected.setAttribute?.('data-attune-smuggle-anchor', pickerOptions.anchorToken);
      }
      finish(captureSelection(selected, intent, placement));
      label.textContent = intent === 'smuggle-source'
        ? 'Source selected — choose a destination…'
        : intent === 'smuggle-target'
          ? `${placement === 'inside' ? 'Inside' : placement === 'top' ? 'Top' : placement === 'bottom' ? 'Bottom' : placement === 'left' ? 'Left' : 'Right'} destination selected — starting smuggle…`
          : 'Selected — copying reference…';
      runtime.setTimeout(() => { if (label.isConnected) cancel('copy-timeout'); }, 5000);
    }
    function applyPickerCommand(command: string) {
      if (command === 'cancel') {
        cancel('escape');
        return true;
      }
      if (command !== 'up' && command !== 'down') return false;
      if (chain.length) {
        if (command === 'up') chainIndex = Math.min(chain.length - 1, chainIndex + 1);
        else chainIndex = Math.max(0, chainIndex - 1);
      }
      positionOverlay();
      return true;
    }
    function onKeyDown(event: any) {
      const command = event.key === 'Escape'
        ? 'cancel'
        : event.key === 'ArrowUp' ? 'up' : event.key === 'ArrowDown' ? 'down' : null;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      if (command) applyPickerCommand(command);
    }

    const blockedEventNames = [
      'pointerdown', 'pointerup', 'pointerover', 'pointerout',
      'mousedown', 'mouseup', 'mousemove', 'mouseover', 'mouseout',
      'auxclick', 'dblclick', 'contextmenu', 'wheel',
      'touchstart', 'touchmove', 'touchend',
      'dragstart', 'dragover', 'drop',
      'keypress', 'keyup', 'beforeinput', 'input', 'change', 'submit',
      'copy', 'cut', 'paste',
    ];
    function blockHostEvent(event: any) {
      if (isSmuggleResizeInteraction(event)) return;
      if (event.cancelable) event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
    }

    win.addEventListener('pointermove', onPointerMove, true);
    win.addEventListener('click', onClick, true);
    win.addEventListener('keydown', onKeyDown, true);
    for (const eventName of blockedEventNames) {
      win.addEventListener(eventName, blockHostEvent, { capture: true, passive: false });
    }
    win.addEventListener('resize', positionOverlay, true);
    win.addEventListener('scroll', positionOverlay, true);
    const initial = doc.elementFromPoint(lastPoint.x, lastPoint.y);
    if (initial && !isPickerNode(initial)) {
      pointerElement = initial;
      const firstChain = buildChain(initial);
      chain = firstChain.result;
      chainIndex = firstChain.preferredIndex;
      positionOverlay();
    }
    const timeout = runtime.setTimeout(() => cancel('timeout'), timeoutMs);
    win.__attuneElementPickerCleanup = cancel;
    win.__attuneElementPickerComplete = complete;
    win.__attuneElementPickerCommand = applyPickerCommand;
  });
}
