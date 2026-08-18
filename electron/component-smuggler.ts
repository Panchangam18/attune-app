import type { ElementPickerSelection } from './element-picker.js';

export interface ComponentSmuggleAnchor {
  token: string;
  roles: string[];
  selector: string;
  fingerprint: ElementPickerSelection['fingerprint'];
  placement: 'inside' | 'top' | 'bottom' | 'left' | 'right';
}

export interface ComponentSmuggleEndpoint {
  appId: string;
  appName: string;
  appPid?: number;
  webSocketDebuggerUrl: string;
  anchor: ComponentSmuggleAnchor;
}

export interface ComponentSmuggleKeyChord {
  key: string;
  code: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  repeat?: boolean;
}

export type ComponentSmuggleKeyForwarder = (chord: ComponentSmuggleKeyChord) => Promise<unknown>;

export interface ComponentSmuggleCaptureRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  rootWidth: number;
  rootHeight: number;
  offsetX: number;
  offsetY: number;
  screenX: number;
  screenY: number;
  outerWidth: number;
  outerHeight: number;
  innerWidth: number;
  innerHeight: number;
  contentOffsetX: number;
  contentOffsetY: number;
  nativeWindowId?: number;
}

export type ComponentSmuggleFrameStreamStarter = (
  region: ComponentSmuggleCaptureRegion,
  onFrame: (pngBase64: string) => void,
) => Promise<() => void | Promise<void>>;

export function componentSmuggleGlobalCaptureRectangle(region: ComponentSmuggleCaptureRegion) {
  return {
    x: Number(region.screenX) + Number(region.contentOffsetX || 0) + Number(region.x),
    y: Number(region.screenY) + Number(region.contentOffsetY || 0) + Number(region.y),
    width: Number(region.width),
    height: Number(region.height),
  };
}

export interface ComponentSmugglePageClient {
  readonly recommendedPumpIntervalMs?: number;
  connect(): Promise<void>;
  evaluate(expression: string, timeoutMs?: number): Promise<any>;
  click(x: number, y: number): Promise<void>;
  move(x: number, y: number): Promise<void>;
  wheel(
    x: number,
    y: number,
    deltaX: number,
    deltaY: number,
    modifiers?: { altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean },
  ): Promise<void>;
  insertText(value: string): Promise<void>;
  pressKey(
    key: string,
    code: string,
    modifiers?: { altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean },
  ): Promise<void>;
  close(): void;
}

export interface ComponentSmuggleSpec {
  schemaVersion: 1;
  smuggleId: string;
  createdAt: string;
  source: Omit<ComponentSmuggleEndpoint, 'webSocketDebuggerUrl'>;
  target: Omit<ComponentSmuggleEndpoint, 'webSocketDebuggerUrl'>;
  transport: 'dom-twin';
}

export function componentSmuggleAnchor(selection: ElementPickerSelection, token: string): ComponentSmuggleAnchor {
  return {
    token,
    roles: [...selection.roles],
    selector: selection.selector,
    fingerprint: selection.fingerprint,
    placement: selection.placement === 'top' || selection.placement === 'bottom'
      || selection.placement === 'left' || selection.placement === 'right'
      ? selection.placement
      : 'inside',
  };
}

export function buildComponentSmuggleSourceExpression(anchor: ComponentSmuggleAnchor): string {
  return `(${runComponentSmuggleSource.toString()})(${JSON.stringify(anchor)})`;
}

export function buildComponentSmuggleTargetExpression(anchor: ComponentSmuggleAnchor): string {
  return `(${runComponentSmuggleTarget.toString()})(${JSON.stringify(anchor)})`;
}

/** Serialized into the source renderer. Keep this function self-contained. */
function runComponentSmuggleSource(anchor: ComponentSmuggleAnchor) {
  const runtime = globalThis as any;
  const doc = runtime.document;
  runtime.__attuneComponentSmuggleSource?.cleanup?.();

  const compact = (value: unknown, limit = 160) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
  const labelFor = (element: any) => compact(
    element?.getAttribute?.('aria-label')
      || element?.getAttribute?.('title')
      || element?.getAttribute?.('placeholder'),
  );
  const fingerprintScore = (baseline: any, element: any) => {
    if (!baseline || !element) return 0;
    let score = 0;
    if ((element.tagName?.toLowerCase?.() || '') === baseline.tag) score += 0.2;
    if (baseline.domRole && element.getAttribute?.('role') === baseline.domRole) score += 0.15;
    if (baseline.label && labelFor(element) === baseline.label) score += 0.2;
    if (baseline.text) {
      const text = compact(element.innerText || element.textContent);
      if (text === baseline.text) score += 0.16;
      else if (text.includes(baseline.text) || baseline.text.includes(text)) score += 0.08;
    }
    const entries = Object.entries(baseline.attributes || {});
    if (entries.length) {
      const matches = entries.filter(([name, value]) => compact(element.getAttribute?.(name)) === value).length;
      score += 0.2 * (matches / entries.length);
    }
    const classes = baseline.classes || [];
    if (classes.length) score += 0.09 * (classes.filter((name: string) => element.classList?.contains(name)).length / classes.length);
    if (baseline.ancestor && element.parentElement) {
      if ((element.parentElement.tagName?.toLowerCase?.() || '') === baseline.ancestor.tag) score += 0.04;
      if (baseline.ancestor.domRole && element.parentElement.getAttribute?.('role') === baseline.ancestor.domRole) score += 0.03;
      if (baseline.ancestor.label && labelFor(element.parentElement) === baseline.ancestor.label) score += 0.03;
    }
    return score;
  };
  const resolveAnchor = () => {
    const retained = runtime.__attuneSmuggleAnchors?.[anchor.token];
    if (retained?.isConnected) return retained;
    const marked = doc.querySelector?.(`[data-attune-smuggle-anchor=${JSON.stringify(anchor.token)}]`);
    if (marked) return marked;
    for (const role of anchor.roles || []) {
      const candidates = [...doc.querySelectorAll(`[data-attune-host-roles~=${JSON.stringify(role)}]`)];
      if (candidates.length === 1) return candidates[0];
      if (candidates.length > 1) {
        const ranked = candidates.map((element: any) => ({ element, score: fingerprintScore(anchor.fingerprint, element) }))
          .sort((left: any, right: any) => right.score - left.score);
        if (ranked[0]?.score >= 0.58 && ranked[0].score - (ranked[1]?.score || 0) >= 0.1) return ranked[0].element;
      }
    }
    try {
      const direct = [...doc.querySelectorAll(anchor.selector)];
      if (direct.length === 1 && fingerprintScore(anchor.fingerprint, direct[0]) >= 0.45) return direct[0];
    } catch {}
    const candidates = [...doc.querySelectorAll(anchor.fingerprint?.tag || '*')]
      .filter((element: any) => !element.closest?.('[data-attune-component-smuggle]'))
      .slice(0, 2500)
      .map((element: any) => ({ element, score: fingerprintScore(anchor.fingerprint, element) }))
      .sort((left: any, right: any) => right.score - left.score);
    if (candidates[0]?.score >= 0.68 && candidates[0].score - (candidates[1]?.score || 0) >= 0.12) return candidates[0].element;
    return null;
  };

  const styleProperties = [
    'display', 'position', 'box-sizing', 'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
    'aspect-ratio',
    'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'inset', 'top', 'right', 'bottom', 'left', 'z-index', 'overflow', 'overflow-x', 'overflow-y',
    'flex', 'flex-basis', 'flex-direction', 'flex-grow', 'flex-shrink', 'flex-wrap', 'align-content', 'align-items',
    'align-self', 'justify-content', 'justify-items', 'justify-self', 'place-content', 'place-items', 'place-self',
    'order', 'gap', 'row-gap', 'column-gap',
    'grid-template-areas', 'grid-template-columns', 'grid-template-rows',
    'grid-auto-flow', 'grid-auto-columns', 'grid-auto-rows',
    'grid-area', 'grid-column', 'grid-column-start', 'grid-column-end',
    'grid-row', 'grid-row-start', 'grid-row-end',
    'color', 'background', 'background-color', 'background-image', 'background-position', 'background-size',
    'background-repeat', 'background-origin', 'background-clip',
    'border', 'border-width', 'border-style', 'border-color', 'border-radius', 'border-collapse', 'border-spacing',
    'outline', 'outline-offset', 'box-shadow', 'text-shadow', 'opacity',
    'font', 'font-family', 'font-size', 'font-style', 'font-weight', 'letter-spacing', 'line-height',
    'text-align', 'text-decoration', 'text-overflow', 'text-transform', 'white-space', 'word-break',
    'overflow-wrap', 'vertical-align', '-webkit-text-fill-color', '-webkit-text-stroke',
    'cursor', 'pointer-events', 'appearance', '-webkit-appearance',
    'object-fit', 'object-position', 'transform', 'transform-origin',
    'clip', 'clip-path', 'filter', 'backdrop-filter', '-webkit-backdrop-filter',
    'mask', 'mask-image', 'mask-position', 'mask-size', 'mask-repeat',
    '-webkit-mask', '-webkit-mask-image', '-webkit-mask-position', '-webkit-mask-size', '-webkit-mask-repeat',
    'mix-blend-mode', 'isolation', 'visibility', 'float', 'clear', 'table-layout', 'list-style',
  ];
  const allowedAttribute = (name: string) => (
    /^(aria-|data-)/.test(name)
    || [
      'id', 'role', 'title', 'alt', 'href', 'src', 'type', 'name', 'placeholder', 'tabindex', 'contenteditable',
      'xmlns', 'xmlns:xlink', 'viewbox', 'preserveaspectratio', 'd', 'fill', 'fill-rule', 'fill-opacity',
      'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-opacity',
      'clip-path', 'clip-rule', 'mask', 'filter', 'opacity', 'transform', 'vector-effect',
      'xlink:href', 'xml:space', 'width', 'height', 'x', 'y', 'x1', 'x2', 'y1', 'y2',
      'cx', 'cy', 'r', 'rx', 'ry', 'points', 'offset', 'stop-color', 'stop-opacity',
    ].includes(name)
  ) && name !== 'data-attune-smuggle-anchor' && !name.startsWith('data-attune-component-smuggle');
  const unsafeTags = new Set(['script', 'style', 'link', 'meta', 'iframe', 'object', 'embed', 'webview']);
  const pseudoSnapshot = (node: any, side: '::before' | '::after') => {
    const computed = runtime.getComputedStyle(node, side);
    const content = String(computed.content || '');
    const hasText = content !== 'none' && content !== 'normal' && content !== '""' && content !== "''";
    const hasPaint = computed.backgroundColor !== 'rgba(0, 0, 0, 0)'
      || computed.backgroundImage !== 'none'
      || computed.borderTopStyle !== 'none'
      || computed.borderRightStyle !== 'none'
      || computed.borderBottomStyle !== 'none'
      || computed.borderLeftStyle !== 'none'
      || computed.boxShadow !== 'none';
    if (!hasText && !hasPaint) return null;
    let text = '';
    if (hasText && (content.startsWith('"') || content.startsWith("'"))) {
      try { text = JSON.parse(content); } catch { text = content.slice(1, -1); }
    }
    const style: Record<string, string> = {};
    for (const property of styleProperties) {
      const value = computed.getPropertyValue(property);
      if (value) style[property] = value;
    }
    return { side, text, style };
  };
  const serialize = (node: any, path: number[], budget: {
    count: number;
    elementCount: number;
    textNodeCount: number;
    textLength: number;
  }): any => {
    if (!node || budget.count >= 1800 || path.length > 32) return null;
    if (node.nodeType === 3) {
      budget.count += 1;
      budget.textNodeCount += 1;
      budget.textLength += String(node.nodeValue || '').length;
      return { kind: 'text', text: node.nodeValue || '', path };
    }
    if (node.nodeType !== 1 || node.closest?.('[data-attune-component-smuggle]')) return null;
    const tag = node.tagName?.toLowerCase?.() || 'div';
    if (unsafeTags.has(tag)) return null;
    budget.count += 1;
    budget.elementCount += 1;
    const computed = runtime.getComputedStyle(node);
    const style: Record<string, string> = {};
    for (const property of styleProperties) {
      const value = computed.getPropertyValue(property);
      if (value) style[property] = value;
    }
    const attributes: Record<string, string> = {};
    for (const attribute of [...(node.attributes || [])]) {
      const originalName = String(attribute.name || '');
      const normalizedName = originalName.toLowerCase();
      if (allowedAttribute(normalizedName)) attributes[originalName] = String(attribute.value || '').slice(0, 4000);
    }
    const children = [...(node.childNodes || [])]
      .map((child: any, index: number) => serialize(child, [...path, index], budget))
      .filter(Boolean);
    const state: Record<string, unknown> = {};
    if ('value' in node && typeof node.value === 'string') state.value = node.value;
    if ('checked' in node) state.checked = Boolean(node.checked);
    if ('selectedIndex' in node) state.selectedIndex = Number(node.selectedIndex);
    return {
      kind: 'element', tag, namespace: node.namespaceURI || '', path, attributes, style, state,
      before: pseudoSnapshot(node, '::before'),
      after: pseudoSnapshot(node, '::after'),
      children,
    };
  };

  let root = resolveAnchor();
  if (!root) return { ok: false, reason: 'source-anchor-unresolved' };
  const outbox: any[] = [];
  const createdExternalElements = new WeakSet();
  const baselineVisibleOverlays = new WeakSet();
  const overlaySelector = [
    '[role="menu"]', '[role="dialog"]', '[role="listbox"]', '[role="tree"]', '[role="tooltip"]',
    '[aria-modal="true"]', '[popover]', '[data-radix-popper-content-wrapper]', '[data-floating-ui-portal]',
  ].join(',');
  const isVisible = (element: any) => {
    const bounds = element?.getBoundingClientRect?.();
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return false;
    const computed = runtime.getComputedStyle(element);
    return computed.display !== 'none' && computed.visibility !== 'hidden' && computed.opacity !== '0';
  };
  for (const element of [...doc.querySelectorAll(overlaySelector)]) {
    if (isVisible(element)) baselineVisibleOverlays.add(element);
  }
  let lastActionAt = 0;
  let lastActionElement: any = null;
  let satelliteRoots: any[] = [];
  let version = 0;
  let acknowledgedActionRevision = 0;
  let snapshotScheduled = false;
  let disposed = false;
  const markCreatedExternal = (node: any) => {
    if (node?.nodeType !== 1) return;
    if (!root?.contains?.(node)) createdExternalElements.add(node);
    for (const descendant of [...(node.querySelectorAll?.('*') || [])]) {
      if (!root?.contains?.(descendant)) createdExternalElements.add(descendant);
    }
  };
  const collectSatellites = () => {
    const linkedIds = new Set<string>();
    const owners = [root, lastActionElement].filter(Boolean);
    for (const owner of owners) {
      const candidates = [owner, ...(owner.querySelectorAll?.('[aria-controls],[aria-owns]') || [])];
      for (const candidate of candidates) {
        for (const attribute of ['aria-controls', 'aria-owns']) {
          for (const id of String(candidate.getAttribute?.(attribute) || '').split(/\s+/).filter(Boolean)) linkedIds.add(id);
        }
      }
    }
    const actionRecent = runtime.Date.now() - lastActionAt < 10_000;
    const pool = new Set<any>();
    for (const id of linkedIds) {
      const linked = doc.getElementById(id);
      if (linked) pool.add(linked);
    }
    for (const candidate of [...doc.querySelectorAll(overlaySelector)]) pool.add(candidate);
    if (actionRecent) {
      for (const candidate of [...doc.body.querySelectorAll('*')].slice(0, 6000)) {
        if (!createdExternalElements.has(candidate)) continue;
        const computed = runtime.getComputedStyle(candidate);
        const zIndex = Number.parseInt(computed.zIndex, 10);
        if ((computed.position === 'fixed' || computed.position === 'absolute') && (Number.isFinite(zIndex) ? zIndex >= 10 : true)) {
          pool.add(candidate);
        }
      }
    }
    const candidates = [...pool].filter((candidate: any) => {
      if (!candidate?.isConnected || root.contains(candidate) || candidate.contains(root) || !isVisible(candidate)) return false;
      const linked = Boolean(candidate.id && linkedIds.has(candidate.id));
      const novel = createdExternalElements.has(candidate) || !baselineVisibleOverlays.has(candidate);
      return linked || (actionRecent && novel);
    });
    const depth = (element: any) => {
      let value = 0;
      for (let current = element; current?.parentElement; current = current.parentElement) value += 1;
      return value;
    };
    candidates.sort((left: any, right: any) => depth(left) - depth(right));
    return candidates.filter((candidate: any, index: number) => (
      !candidates.slice(0, index).some((ancestor: any) => ancestor.contains(candidate))
    )).slice(0, 8);
  };
  const snapshot = () => {
    snapshotScheduled = false;
    if (disposed) return;
    if (!root?.isConnected) root = resolveAnchor();
    if (!root) return;
    const budget = { count: 0, elementCount: 0, textNodeCount: 0, textLength: 0 };
    const tree = serialize(root, [], budget);
    if (!tree) return;
    const bounds = root.getBoundingClientRect?.();
    satelliteRoots = collectSatellites();
    const satellites = satelliteRoots.map((satellite: any, index: number) => {
      const satelliteBounds = satellite.getBoundingClientRect();
      return {
        tree: serialize(satellite, [-1, index], budget),
        bounds: {
          x: satelliteBounds.left - bounds.left,
          y: satelliteBounds.top - bounds.top,
          width: satelliteBounds.width,
          height: satelliteBounds.height,
        },
      };
    }).filter((satellite: any) => satellite.tree);
    version += 1;
    outbox.length = 0;
    outbox.push({
      type: 'snapshot',
      version,
      acknowledgedActionRevision,
      tree,
      satellites,
      diagnostics: {
        rootTag: root.tagName?.toLowerCase?.() || '',
        nodeCount: budget.count,
        elementCount: budget.elementCount,
        textNodeCount: budget.textNodeCount,
        textLength: budget.textLength,
        width: Math.round(bounds?.width || 0),
        height: Math.round(bounds?.height || 0),
        satelliteCount: satellites.length,
      },
    });
  };
  const schedule = () => {
    if (snapshotScheduled || disposed) return;
    snapshotScheduled = true;
    runtime.queueMicrotask(snapshot);
  };
  const observer = new runtime.MutationObserver((records: any[]) => {
    for (const record of records) {
      for (const node of [...(record.addedNodes || [])]) markCreatedExternal(node);
    }
    schedule();
  });
  observer.observe(doc.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  doc.addEventListener('input', schedule, true);
  doc.addEventListener('change', schedule, true);
  runtime.addEventListener('resize', schedule, true);

  const nodeAtPath = (path: number[]) => {
    if (!root?.isConnected) root = resolveAnchor();
    const satellitePath = path?.[0] === -1;
    let node = satellitePath ? satelliteRoots[path[1]] : root;
    for (const index of satellitePath ? path.slice(2) : (path || [])) node = node?.childNodes?.[index];
    return node || null;
  };
  const editableFor = (node: any) => {
    let current = node?.nodeType === 1 ? node : node?.parentElement;
    while (current) {
      if (current.isContentEditable || ['input', 'textarea', 'select'].includes(current.tagName?.toLowerCase?.())) return current;
      if (current === root || satelliteRoots.includes(current)) break;
      current = current.parentElement;
    }
    return node;
  };
  const textPoint = (rootElement: any, point: any) => {
    let node = rootElement;
    for (const index of point?.path || []) node = node?.childNodes?.[index];
    if (!node) return null;
    const maximum = node.nodeType === 3 ? String(node.nodeValue || '').length : node.childNodes?.length || 0;
    return { node, offset: Math.max(0, Math.min(Number(point?.offset) || 0, maximum)) };
  };
  const applySelection = (element: any, selectionState: any) => {
    if (!element || !selectionState) return;
    if (selectionState.kind === 'control' && typeof element.setSelectionRange === 'function') {
      try {
        element.setSelectionRange(
          Number(selectionState.start) || 0,
          Number(selectionState.end) || 0,
          selectionState.direction || 'none',
        );
      } catch {}
      return;
    }
    if (selectionState.kind !== 'contenteditable') return;
    const anchorPoint = textPoint(element, selectionState.anchor);
    const focusPoint = textPoint(element, selectionState.focus);
    if (!anchorPoint || !focusPoint) return;
    try {
      const selection = doc.getSelection?.();
      if (!selection) return;
      selection.removeAllRanges();
      if (typeof selection.setBaseAndExtent === 'function') {
        selection.setBaseAndExtent(anchorPoint.node, anchorPoint.offset, focusPoint.node, focusPoint.offset);
      } else {
        const range = doc.createRange();
        range.setStart(anchorPoint.node, anchorPoint.offset);
        range.setEnd(focusPoint.node, focusPoint.offset);
        selection.addRange(range);
      }
    } catch {}
  };
  const setNativeValue = (element: any, value: unknown) => {
    const prototype = Object.getPrototypeOf(element);
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    if (descriptor?.set) descriptor.set.call(element, String(value ?? ''));
    else element.value = String(value ?? '');
  };
  const applyActions = (actions: any[]) => {
    for (const action of actions || []) {
      const node = nodeAtPath(action.path);
      const element = editableFor(node);
      if (!element) continue;
      if (action.type === 'input' || action.type === 'change') {
        element.focus?.({ preventScroll: true });
        applySelection(element, action.selectionBefore);
        if ('value' in element) setNativeValue(element, action.value);
        if ('checked' in element && typeof action.checked === 'boolean') element.checked = action.checked;
        if (element.isContentEditable && typeof action.html === 'string') element.innerHTML = action.html;
        const InputEventConstructor = runtime.InputEvent || runtime.Event;
        element.dispatchEvent(new InputEventConstructor(action.type, {
          bubbles: true,
          composed: true,
          inputType: action.inputType,
          data: action.data,
        }));
        applySelection(element, action.selectionAfter);
      } else if (action.type === 'keydown') {
        element.focus?.({ preventScroll: true });
        applySelection(element, action.selectionBefore);
        element.dispatchEvent(new runtime.KeyboardEvent('keydown', {
          key: action.key, code: action.code, bubbles: true, composed: true,
          altKey: action.altKey, ctrlKey: action.ctrlKey, metaKey: action.metaKey, shiftKey: action.shiftKey,
        }));
      }
    }
    schedule();
    return true;
  };
  const clickPoint = (path: number[], position?: { xRatio?: number; yRatio?: number }) => {
    const element = nodeAtPath(path);
    lastActionAt = runtime.Date.now();
    lastActionElement = element?.nodeType === 1 ? element : element?.parentElement;
    const bounds = element?.getBoundingClientRect?.();
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null;
    const xRatio = Number.isFinite(position?.xRatio) ? Math.max(0, Math.min(1, Number(position?.xRatio))) : 0.5;
    const yRatio = Number.isFinite(position?.yRatio) ? Math.max(0, Math.min(1, Number(position?.yRatio))) : 0.5;
    return { x: bounds.left + bounds.width * xRatio, y: bounds.top + bounds.height * yRatio };
  };
  const captureRegion = () => {
    if (!root?.isConnected) root = resolveAnchor();
    const bounds = root?.getBoundingClientRect?.();
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null;
    const x = Math.max(0, bounds.left);
    const y = Math.max(0, bounds.top);
    const right = Math.min(runtime.innerWidth, bounds.right);
    const bottom = Math.min(runtime.innerHeight, bounds.bottom);
    if (right <= x || bottom <= y) return null;
    const innerWidth = Number(runtime.innerWidth) || 0;
    const innerHeight = Number(runtime.innerHeight) || 0;
    const outerWidth = Number(runtime.outerWidth) || innerWidth;
    const outerHeight = Number(runtime.outerHeight) || innerHeight;
    return {
      x,
      y,
      width: right - x,
      height: bottom - y,
      rootWidth: bounds.width,
      rootHeight: bounds.height,
      offsetX: x - bounds.left,
      offsetY: y - bounds.top,
      screenX: Number(runtime.screenX) || 0,
      screenY: Number(runtime.screenY) || 0,
      outerWidth,
      outerHeight,
      innerWidth,
      innerHeight,
      // Chromium desktop shells generally have no browser chrome, making both
      // offsets zero. In a browser window these values account for the tab and
      // toolbar area between the native window frame and the page viewport.
      contentOffsetX: Math.max(0, (outerWidth - innerWidth) / 2),
      contentOffsetY: Math.max(0, outerHeight - innerHeight),
      nativeWindowId: Number(runtime.__attuneNativeWindowId) || undefined,
    };
  };
  const capturePoint = (position?: { xRatio?: number; yRatio?: number }) => {
    if (!root?.isConnected) root = resolveAnchor();
    const bounds = root?.getBoundingClientRect?.();
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null;
    const xRatio = Number.isFinite(position?.xRatio) ? Math.max(0, Math.min(1, Number(position?.xRatio))) : 0.5;
    const yRatio = Number.isFinite(position?.yRatio) ? Math.max(0, Math.min(1, Number(position?.yRatio))) : 0.5;
    lastActionAt = runtime.Date.now();
    lastActionElement = root;
    return { x: bounds.left + bounds.width * xRatio, y: bounds.top + bounds.height * yRatio };
  };
  const hoverPoint = (position?: { xRatio?: number; yRatio?: number } | null) => {
    if (!root?.isConnected) root = resolveAnchor();
    const bounds = root?.getBoundingClientRect?.();
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null;
    lastActionAt = runtime.Date.now();
    lastActionElement = root;
    if (!position) {
      const viewportWidth = Number(runtime.innerWidth) || 0;
      const viewportHeight = Number(runtime.innerHeight) || 0;
      if (bounds.top >= 1) return { x: Math.max(0, Math.min(viewportWidth - 1, bounds.left)), y: bounds.top - 1 };
      if (bounds.bottom < viewportHeight - 1) return { x: Math.max(0, Math.min(viewportWidth - 1, bounds.left)), y: bounds.bottom + 1 };
      if (bounds.left >= 1) return { x: bounds.left - 1, y: Math.max(0, Math.min(viewportHeight - 1, bounds.top)) };
      if (bounds.right < viewportWidth - 1) return { x: bounds.right + 1, y: Math.max(0, Math.min(viewportHeight - 1, bounds.top)) };
      return { x: -1, y: -1 };
    }
    const xRatio = Number.isFinite(position.xRatio) ? Math.max(0, Math.min(1, Number(position.xRatio))) : 0.5;
    const yRatio = Number.isFinite(position.yRatio) ? Math.max(0, Math.min(1, Number(position.yRatio))) : 0.5;
    return { x: bounds.left + bounds.width * xRatio, y: bounds.top + bounds.height * yRatio };
  };
  const focusPrimaryEditable = () => {
    if (!root?.isConnected) root = resolveAnchor();
    if (!root) return { ok: false };
    const selector = 'textarea,input:not([type="button"]):not([type="submit"]),[contenteditable="true"],[contenteditable="plaintext-only"]';
    const active = doc.activeElement;
    const candidate = active?.matches?.(selector) && (active === root || root.contains(active))
      ? active
      : root.matches?.(selector)
        ? root
        : [...(root.querySelectorAll?.(selector) || [])].find((element: any) => {
          const bounds = element.getBoundingClientRect?.();
          if (!bounds || bounds.width <= 0 || bounds.height <= 0) return false;
          const computed = runtime.getComputedStyle(element);
          return computed.display !== 'none' && computed.visibility !== 'hidden';
        });
    if (!candidate?.focus) return { ok: false };
    candidate.focus({ preventScroll: true });
    return { ok: true, tag: candidate.tagName?.toLowerCase?.() || '', contentEditable: Boolean(candidate.isContentEditable) };
  };
  const focusPath = (path: number[], selectionState?: any) => {
    const element = editableFor(nodeAtPath(path));
    if (!element?.focus) return { ok: false };
    element.focus({ preventScroll: true });
    applySelection(element, selectionState);
    return {
      ok: true,
      contentEditable: Boolean(element.isContentEditable),
      tag: element.tagName?.toLowerCase?.() || '',
    };
  };
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    observer.disconnect();
    doc.removeEventListener('input', schedule, true);
    doc.removeEventListener('change', schedule, true);
    runtime.removeEventListener('resize', schedule, true);
    try { root?.removeAttribute?.('data-attune-smuggle-anchor'); } catch {}
    if (runtime.__attuneSmuggleAnchors) delete runtime.__attuneSmuggleAnchors[anchor.token];
    delete runtime.__attuneComponentSmuggleSource;
  };
  runtime.__attuneComponentSmuggleSource = {
    drain: () => outbox.splice(0),
    applyActions,
    capturePoint,
    captureRegion,
    clickPoint,
    focusPrimaryEditable,
    focusPath,
    hoverPoint,
    settleActions: async (revision: number) => {
      await Promise.resolve();
      await Promise.resolve();
      acknowledgedActionRevision = Math.max(acknowledgedActionRevision, Number(revision) || 0);
      snapshot();
      return { version, acknowledgedActionRevision };
    },
    cleanup,
    status: () => ({
      connected: Boolean(root?.isConnected),
      version,
      acknowledgedActionRevision,
      outboxLength: outbox.length,
      rootTag: root?.tagName?.toLowerCase?.() || '',
      roles: compact(root?.getAttribute?.('data-attune-host-roles'), 300).split(/\s+/).filter(Boolean),
    }),
  };
  snapshot();
  return { ok: true, connected: root.isConnected };
}

/** Serialized into the target renderer. Keep this function self-contained. */
function runComponentSmuggleTarget(anchor: ComponentSmuggleAnchor) {
  const runtime = globalThis as any;
  const doc = runtime.document;
  runtime.__attuneComponentSmuggleTarget?.cleanup?.();

  const compact = (value: unknown, limit = 160) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
  const labelFor = (element: any) => compact(
    element?.getAttribute?.('aria-label')
      || element?.getAttribute?.('title')
      || element?.getAttribute?.('placeholder'),
  );
  const fingerprintScore = (baseline: any, element: any) => {
    if (!baseline || !element) return 0;
    let score = 0;
    if ((element.tagName?.toLowerCase?.() || '') === baseline.tag) score += 0.2;
    if (baseline.domRole && element.getAttribute?.('role') === baseline.domRole) score += 0.15;
    if (baseline.label && labelFor(element) === baseline.label) score += 0.2;
    if (baseline.text) {
      const text = compact(element.innerText || element.textContent);
      if (text === baseline.text) score += 0.16;
      else if (text.includes(baseline.text) || baseline.text.includes(text)) score += 0.08;
    }
    const entries = Object.entries(baseline.attributes || {});
    if (entries.length) {
      const matches = entries.filter(([name, value]) => compact(element.getAttribute?.(name)) === value).length;
      score += 0.2 * (matches / entries.length);
    }
    const classes = baseline.classes || [];
    if (classes.length) score += 0.09 * (classes.filter((name: string) => element.classList?.contains(name)).length / classes.length);
    if (baseline.ancestor && element.parentElement) {
      if ((element.parentElement.tagName?.toLowerCase?.() || '') === baseline.ancestor.tag) score += 0.04;
      if (baseline.ancestor.domRole && element.parentElement.getAttribute?.('role') === baseline.ancestor.domRole) score += 0.03;
      if (baseline.ancestor.label && labelFor(element.parentElement) === baseline.ancestor.label) score += 0.03;
    }
    return score;
  };
  const resolveAnchor = () => {
    const retained = runtime.__attuneSmuggleAnchors?.[anchor.token];
    if (retained?.isConnected) return retained;
    const marked = doc.querySelector?.(`[data-attune-smuggle-anchor=${JSON.stringify(anchor.token)}]`);
    if (marked) return marked;
    for (const role of anchor.roles || []) {
      const candidates = [...doc.querySelectorAll(`[data-attune-host-roles~=${JSON.stringify(role)}]`)];
      if (candidates.length === 1) return candidates[0];
      if (candidates.length > 1) {
        const ranked = candidates.map((element: any) => ({ element, score: fingerprintScore(anchor.fingerprint, element) }))
          .sort((left: any, right: any) => right.score - left.score);
        if (ranked[0]?.score >= 0.58 && ranked[0].score - (ranked[1]?.score || 0) >= 0.1) return ranked[0].element;
      }
    }
    try {
      const direct = [...doc.querySelectorAll(anchor.selector)];
      if (direct.length === 1 && fingerprintScore(anchor.fingerprint, direct[0]) >= 0.45) return direct[0];
    } catch {}
    const candidates = [...doc.querySelectorAll(anchor.fingerprint?.tag || '*')]
      .filter((element: any) => !element.closest?.('[data-attune-component-smuggle]'))
      .slice(0, 2500)
      .map((element: any) => ({ element, score: fingerprintScore(anchor.fingerprint, element) }))
      .sort((left: any, right: any) => right.score - left.score);
    if (candidates[0]?.score >= 0.68 && candidates[0].score - (candidates[1]?.score || 0) >= 0.12) return candidates[0].element;
    return null;
  };

  let mount = resolveAnchor();
  if (!mount) return { ok: false, reason: 'target-anchor-unresolved' };
  const placement = anchor.placement === 'top' || anchor.placement === 'bottom'
    || anchor.placement === 'left' || anchor.placement === 'right'
    ? anchor.placement
    : 'inside';
  const host = doc.createElement('attune-component-smuggle');
  host.setAttribute('data-attune-component-smuggle', 'host');
  Object.assign(host.style, {
    display: 'block', position: 'relative', isolation: 'isolate', zIndex: '1',
    margin: '8px', maxWidth: 'none', pointerEvents: 'auto', flex: '0 0 auto', alignSelf: 'flex-start',
  });
  const shadow = host.attachShadow({ mode: 'open' });
  const reset = doc.createElement('style');
  reset.textContent = ':host{all:initial;display:block;position:relative}*,*::before,*::after{box-sizing:border-box}';
  const surface = doc.createElement('div');
  surface.setAttribute('data-attune-component-smuggle', 'surface');
  Object.assign(surface.style, { display: 'block', position: 'relative', maxWidth: 'none' });
  const visualViewport = doc.createElement('div');
  visualViewport.setAttribute('data-attune-component-smuggle', 'visual-viewport');
  Object.assign(visualViewport.style, {
    display: 'block', position: 'relative', overflow: 'hidden', outline: 'none',
    userSelect: 'none', WebkitUserSelect: 'none', transformOrigin: 'top left',
  });
  const visualImage = doc.createElement('img');
  visualImage.alt = '';
  visualImage.draggable = false;
  visualImage.setAttribute('data-attune-component-smuggle', 'visual-frame');
  Object.assign(visualImage.style, {
    display: 'block', position: 'absolute', pointerEvents: 'none', userSelect: 'none',
  });
  const visualInput = doc.createElement('textarea');
  visualInput.setAttribute('aria-label', 'Interact with smuggled component');
  visualInput.setAttribute('data-attune-component-smuggle', 'input-relay');
  visualInput.autocapitalize = 'off';
  visualInput.autocomplete = 'off';
  visualInput.spellcheck = false;
  Object.assign(visualInput.style, {
    position: 'absolute', inset: '0', width: '100%', height: '100%', margin: '0', padding: '0',
    border: '0', outline: '0', resize: 'none', opacity: '0', color: 'transparent',
    background: 'transparent', caretColor: 'transparent', cursor: 'default', overflow: 'hidden',
  });
  visualViewport.append(visualImage, visualInput);
  const close = doc.createElement('button');
  close.type = 'button';
  close.setAttribute('aria-label', 'Stop component smuggling');
  close.setAttribute('aria-hidden', 'true');
  close.tabIndex = -1;
  close.textContent = '×';
  Object.assign(close.style, {
    position: 'absolute', top: '-8px', right: '-8px', zIndex: '2147483647',
    width: '22px', height: '22px', padding: '0', border: '1px solid rgba(255,255,255,.28)',
    borderRadius: '999px', background: 'rgb(28,29,33)', color: 'white',
    font: '16px/20px system-ui,sans-serif', cursor: 'pointer', pointerEvents: 'none',
    opacity: '0', visibility: 'hidden', transition: 'opacity 120ms ease',
    WebkitAppRegion: 'no-drag',
  });
  shadow.append(reset, surface, close);
  const portalHost = doc.createElement('attune-component-smuggle-portals');
  portalHost.setAttribute('data-attune-component-smuggle', 'portals');
  Object.assign(portalHost.style, {
    all: 'initial', position: 'fixed', inset: '0', zIndex: '2147483646',
    width: '100vw', height: '100vh', pointerEvents: 'none', overflow: 'visible',
  });
  const portalShadow = portalHost.attachShadow({ mode: 'open' });
  const portalReset = doc.createElement('style');
  portalReset.textContent = ':host{all:initial;position:fixed;inset:0;pointer-events:none}*,*::before,*::after{box-sizing:border-box}';
  const portalSurface = doc.createElement('div');
  portalSurface.setAttribute('data-attune-component-smuggle', 'portal-surface');
  Object.assign(portalSurface.style, { position: 'fixed', inset: '0', pointerEvents: 'none', overflow: 'visible' });
  const resizeLayer = doc.createElement('div');
  resizeLayer.setAttribute('data-attune-component-smuggle', 'resize-controls');
  Object.assign(resizeLayer.style, {
    position: 'fixed', left: '0', top: '0', width: '0', height: '0', zIndex: '2147483647',
    pointerEvents: 'none', opacity: '0', visibility: 'hidden',
    outline: '1px solid rgba(243,214,111,.9)', outlineOffset: '1px',
  });
  const resizeHandleSpecs: Record<string, Record<string, string>> = {
    n: { left: '50%', top: '0', width: '32px', height: '10px', transform: 'translate(-50%,-50%)', cursor: 'ns-resize' },
    s: { left: '50%', top: '100%', width: '32px', height: '10px', transform: 'translate(-50%,-50%)', cursor: 'ns-resize' },
    e: { left: '100%', top: '50%', width: '10px', height: '32px', transform: 'translate(-50%,-50%)', cursor: 'ew-resize' },
    w: { left: '0', top: '50%', width: '10px', height: '32px', transform: 'translate(-50%,-50%)', cursor: 'ew-resize' },
    ne: { left: '100%', top: '0', width: '12px', height: '12px', transform: 'translate(-50%,-50%)', cursor: 'nesw-resize' },
    nw: { left: '0', top: '0', width: '12px', height: '12px', transform: 'translate(-50%,-50%)', cursor: 'nwse-resize' },
    se: { left: '100%', top: '100%', width: '12px', height: '12px', transform: 'translate(-50%,-50%)', cursor: 'nwse-resize' },
    sw: { left: '0', top: '100%', width: '12px', height: '12px', transform: 'translate(-50%,-50%)', cursor: 'nesw-resize' },
  };
  const resizeHandles = new Map<string, any>();
  for (const [direction, geometry] of Object.entries(resizeHandleSpecs)) {
    const handle = doc.createElement('button');
    handle.type = 'button';
    handle.tabIndex = -1;
    handle.setAttribute('aria-label', `Resize smuggled component ${direction}`);
    handle.setAttribute('data-attune-smuggle-resize-handle', direction);
    Object.assign(handle.style, {
      position: 'absolute', display: 'block', margin: '0', padding: '0', zIndex: '1',
      border: '1px solid rgb(16,18,17)', borderRadius: direction.length === 2 ? '3px' : '999px',
      background: '#f3d66f', boxShadow: '0 1px 5px rgba(0,0,0,.5)',
      pointerEvents: 'none', touchAction: 'none', WebkitAppRegion: 'no-drag',
      ...geometry,
    });
    resizeLayer.appendChild(handle);
    resizeHandles.set(direction, handle);
  }
  portalSurface.appendChild(resizeLayer);
  portalShadow.append(portalReset, portalSurface);
  doc.documentElement.appendChild(portalHost);
  const voidTags = new Set(['input', 'img', 'br', 'hr', 'meta', 'link', 'source', 'track', 'area', 'base', 'col', 'embed', 'param', 'wbr']);
  let closing = false;
  const pickerActiveAttribute = 'data-attune-element-picker-active';
  let selectionModeActive = false;
  let positionResizeLayer = () => {};
  const updateCloseVisibility = () => {
    const visible = doc.documentElement.getAttribute(pickerActiveAttribute) === 'true';
    selectionModeActive = visible;
    close.style.opacity = visible ? '1' : '0';
    close.style.visibility = visible ? 'visible' : 'hidden';
    close.style.pointerEvents = visible ? 'auto' : 'none';
    close.tabIndex = visible ? 0 : -1;
    close.setAttribute('aria-hidden', visible ? 'false' : 'true');
    resizeLayer.style.opacity = visible ? '1' : '0';
    resizeLayer.style.visibility = visible ? 'visible' : 'hidden';
    portalHost.style.zIndex = visible ? '2147483647' : '2147483646';
    for (const handle of resizeHandles.values()) handle.style.pointerEvents = visible ? 'auto' : 'none';
    positionResizeLayer();
  };
  const selectionModeObserver = new runtime.MutationObserver(updateCloseVisibility);
  selectionModeObserver.observe(doc.documentElement, {
    attributes: true,
    attributeFilter: [pickerActiveAttribute],
  });
  updateCloseVisibility();
  const contained = placement === 'top' || placement === 'bottom'
    || placement === 'left' || placement === 'right';
  const layoutAttribute = 'data-attune-component-smuggle-layout';
  const layoutStyle = doc.createElement('style');
  layoutStyle.setAttribute('data-attune-component-smuggle', 'layout');
  (doc.head || doc.documentElement).appendChild(layoutStyle);
  let decoratedMount: any = null;
  let mountBaseline: any = null;
  const releaseContainedMount = () => {
    decoratedMount?.removeAttribute?.(layoutAttribute);
    decoratedMount = null;
    mountBaseline = null;
    layoutStyle.textContent = '';
  };
  const prepareContainedMount = (container: any) => {
    if (!contained || !container || decoratedMount === container) return;
    releaseContainedMount();
    const bounds = container.getBoundingClientRect();
    const computed = runtime.getComputedStyle(container);
    mountBaseline = {
      width: bounds.width,
      height: bounds.height,
      clientWidth: container.clientWidth,
      clientHeight: container.clientHeight,
      scrollWidth: container.scrollWidth,
      scrollHeight: container.scrollHeight,
      paddingLeft: Number.parseFloat(computed.paddingLeft) || 0,
      paddingRight: Number.parseFloat(computed.paddingRight) || 0,
      paddingTop: Number.parseFloat(computed.paddingTop) || 0,
      paddingBottom: Number.parseFloat(computed.paddingBottom) || 0,
      position: computed.position === 'static' ? 'relative' : computed.position,
      overflowX: computed.overflowX,
      overflowY: computed.overflowY,
    };
    decoratedMount = container;
    container.setAttribute(layoutAttribute, anchor.token);
    Object.assign(host.style, {
      position: 'absolute', left: '', right: '', top: '', bottom: '',
      margin: '0', zIndex: '1', flex: 'none', alignSelf: 'auto',
    });
    close.style.top = '0';
    close.style.right = '0';
  };
  const layoutContainedHost = () => {
    if (!contained || !decoratedMount?.isConnected || !mountBaseline || !host.isConnected) return;
    const hostBounds = host.getBoundingClientRect();
    const hostWidth = Math.max(0, hostBounds.width);
    const hostHeight = Math.max(0, hostBounds.height);
    const horizontalGap = hostWidth > 0 ? 8 : 0;
    const verticalGap = hostHeight > 0 ? 8 : 0;
    const horizontalReserve = placement === 'left' || placement === 'right' ? hostWidth + horizontalGap : 0;
    const verticalReserve = placement === 'top' || placement === 'bottom' ? hostHeight + verticalGap : 0;
    const paddingLeft = mountBaseline.paddingLeft + (placement === 'left' ? horizontalReserve : 0);
    const paddingRight = mountBaseline.paddingRight + (placement === 'right' ? horizontalReserve : 0);
    const paddingTop = mountBaseline.paddingTop + (placement === 'top' ? verticalReserve : 0);
    const paddingBottom = mountBaseline.paddingBottom + (placement === 'bottom' ? verticalReserve : 0);
    const availableWidth = Math.max(0, mountBaseline.width - mountBaseline.paddingLeft - mountBaseline.paddingRight);
    const availableHeight = Math.max(0, mountBaseline.height - mountBaseline.paddingTop - mountBaseline.paddingBottom);
    const needsHorizontalScroll = placement === 'top' || placement === 'bottom'
      ? hostWidth > availableWidth + 1
      : horizontalReserve + mountBaseline.scrollWidth > mountBaseline.clientWidth + 1;
    const needsVerticalScroll = placement === 'top' || placement === 'bottom'
      ? verticalReserve + mountBaseline.scrollHeight > mountBaseline.clientHeight + 1
      : hostHeight > availableHeight + 1;
    const selector = `[${layoutAttribute}=${JSON.stringify(anchor.token)}]`;
    const css = `${selector}{
      position:${mountBaseline.position}!important;
      box-sizing:border-box!important;
      inline-size:${mountBaseline.width}px!important;
      min-inline-size:0!important;
      max-inline-size:${mountBaseline.width}px!important;
      block-size:${mountBaseline.height}px!important;
      min-block-size:${mountBaseline.height}px!important;
      max-block-size:${mountBaseline.height}px!important;
      padding-left:${paddingLeft}px!important;
      padding-right:${paddingRight}px!important;
      padding-top:${paddingTop}px!important;
      padding-bottom:${paddingBottom}px!important;
      overflow-x:${needsHorizontalScroll ? 'auto' : mountBaseline.overflowX}!important;
      overflow-y:${needsVerticalScroll ? 'auto' : mountBaseline.overflowY}!important;
    }`;
    if (layoutStyle.textContent !== css) layoutStyle.textContent = css;
    host.style.left = placement === 'left' || placement === 'top' || placement === 'bottom'
      ? `${mountBaseline.paddingLeft}px`
      : '';
    host.style.right = placement === 'right' ? `${mountBaseline.paddingRight}px` : '';
    if (placement === 'bottom') {
      const containerBounds = decoratedMount.getBoundingClientRect();
      let contentBottom = mountBaseline.paddingTop;
      for (const child of Array.from(decoratedMount.children || []) as any[]) {
        if (child === host) continue;
        const childPosition = runtime.getComputedStyle(child).position;
        if (childPosition === 'absolute' || childPosition === 'fixed') continue;
        const childBounds = child.getBoundingClientRect();
        const relativeBottom = childBounds.bottom - containerBounds.top + decoratedMount.scrollTop;
        if (Number.isFinite(relativeBottom)) contentBottom = Math.max(contentBottom, relativeBottom);
      }
      const bottomAlignedTop = Math.max(
        mountBaseline.paddingTop,
        mountBaseline.clientHeight - mountBaseline.paddingBottom - hostHeight,
      );
      host.style.top = `${Math.max(bottomAlignedTop, contentBottom + verticalGap)}px`;
      host.style.bottom = '';
    } else {
      host.style.top = `${mountBaseline.paddingTop}px`;
      host.style.bottom = '';
    }
  };
  const remeasureContainedMount = () => {
    if (!contained || !decoratedMount?.isConnected) return;
    const container = decoratedMount;
    releaseContainedMount();
    prepareContainedMount(container);
    layoutContainedHost();
  };
  const appendHost = () => {
    if (closing) return false;
    if (!mount?.isConnected) {
      const resolved = resolveAnchor();
      if (resolved !== mount) {
        releaseContainedMount();
        mount = resolved;
      }
    }
    if (!mount) return false;
    const container = voidTags.has(mount.tagName?.toLowerCase?.()) ? mount.parentElement : mount;
    if (!container) return false;
    prepareContainedMount(container);
    if (placement === 'left' || placement === 'top') {
      if (host.parentElement !== container || host !== container.firstChild) container.insertBefore(host, container.firstChild);
    } else if (host.parentElement !== container) {
      container.appendChild(host);
    }
    if (!portalHost.isConnected) doc.documentElement.appendChild(portalHost);
    layoutContainedHost();
    runtime.requestAnimationFrame(layoutContainedHost);
    return true;
  };
  appendHost();

  const actions: any[] = [];
  const beforeInputSelections = new Map<string, any>();
  let nextActionRevision = 1;
  let latestActionRevision = 0;
  let lastAcknowledgedActionRevision = 0;
  const enqueueAction = (action: any) => {
    const revision = nextActionRevision;
    nextActionRevision += 1;
    latestActionRevision = revision;
    actions.push({ ...action, revision });
  };
  const visualPosition = (event: any) => {
    const bounds = visualViewport.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return null;
    return {
      xRatio: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      yRatio: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
    };
  };
  const enqueueVisualHover = (position: any, trusted: boolean) => {
    const previous = actions[actions.length - 1];
    if (previous?.type === 'visual-hover') {
      previous.position = position;
      previous.trusted = trusted;
      return;
    }
    enqueueAction({ type: 'visual-hover', position, trusted });
  };
  const enqueueVisualWheel = (action: any) => {
    const previous = actions[actions.length - 1];
    if (previous?.type === 'visual-wheel'
      && previous.altKey === action.altKey
      && previous.ctrlKey === action.ctrlKey
      && previous.metaKey === action.metaKey
      && previous.shiftKey === action.shiftKey) {
      previous.position = action.position;
      previous.deltaX += action.deltaX;
      previous.deltaY += action.deltaY;
      previous.trusted = action.trusted;
      return;
    }
    enqueueAction({ type: 'visual-wheel', ...action });
  };
  visualViewport.addEventListener('pointermove', (event: any) => {
    event.stopPropagation();
    const position = visualPosition(event);
    if (position) enqueueVisualHover(position, event.isTrusted);
  }, true);
  visualViewport.addEventListener('pointerleave', (event: any) => {
    event.stopPropagation();
    enqueueVisualHover(null, event.isTrusted);
  }, true);
  visualViewport.addEventListener('wheel', (event: any) => {
    event.preventDefault();
    event.stopPropagation();
    const position = visualPosition(event);
    if (!position) return;
    const deltaScale = event.deltaMode === 1
      ? 16
      : event.deltaMode === 2 ? Math.max(1, visualViewport.clientHeight) : 1;
    enqueueVisualWheel({
      position,
      deltaX: Number(event.deltaX || 0) * deltaScale,
      deltaY: Number(event.deltaY || 0) * deltaScale,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      trusted: event.isTrusted,
    });
  }, { capture: true, passive: false });
  visualViewport.addEventListener('pointerdown', (event: any) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    visualInput.focus({ preventScroll: true });
    const position = visualPosition(event);
    if (!position) return;
    enqueueAction({
      type: 'visual-click',
      trusted: event.isTrusted,
      position,
      clickCount: Math.max(1, Number(event.detail) || 1),
    });
  }, true);
  visualInput.addEventListener('keydown', (event: any) => {
    event.stopPropagation();
    const modifierOnly = ['Alt', 'Control', 'Meta', 'Shift'].includes(String(event.key || ''));
    if (modifierOnly) return;
    const directKeys = new Set([
      'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown',
      'Backspace', 'Delete', 'Tab', 'Escape',
    ]);
    const direct = event.metaKey || event.ctrlKey || directKeys.has(event.key) || /^F\d+$/.test(event.key);
    if (!direct) return;
    event.preventDefault();
    enqueueAction({
      type: 'visual-key', key: event.key, code: event.code, trusted: event.isTrusted,
      altKey: event.altKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey,
      repeat: event.repeat,
    });
  }, true);
  visualInput.addEventListener('beforeinput', (event: any) => {
    event.preventDefault();
    event.stopPropagation();
    enqueueAction({
      type: 'visual-edit', inputType: event.inputType, data: typeof event.data === 'string' ? event.data : null,
      trusted: event.isTrusted, composing: Boolean(event.isComposing),
    });
    visualInput.value = '';
  }, true);
  let lastVersion = 0;
  let disposed = false;
  const pathElementFromEvent = (event: any) => (
    (event.composedPath?.() || []).find((item: any) => item?.getAttribute?.('data-attune-smuggle-path'))
  );
  const pathFromEvent = (event: any) => {
    const element = pathElementFromEvent(event);
    const value = element?.getAttribute?.('data-attune-smuggle-path');
    if (value === null || value === undefined) return null;
    return value ? value.split('.').map((part: string) => Number(part)) : [];
  };
  const isPseudo = (node: any) => node?.nodeType === 1 && node.hasAttribute?.('data-attune-smuggle-pseudo');
  const logicalChildren = (node: any) => [...(node?.childNodes || [])].filter((child: any) => !isPseudo(child));
  const selectionPoint = (rootElement: any, node: any, offset: number) => {
    if (!rootElement || !node || (node !== rootElement && !rootElement.contains?.(node))) return null;
    if (node?.parentElement?.closest?.('[data-attune-smuggle-pseudo]')) return null;
    const path: number[] = [];
    for (let current = node; current && current !== rootElement;) {
      const parent = current.parentNode;
      if (!parent) return null;
      const index = logicalChildren(parent).indexOf(current);
      if (index < 0) return null;
      path.unshift(index);
      current = parent;
    }
    const logicalOffset = node.nodeType === 1
      ? logicalChildren({ childNodes: [...node.childNodes].slice(0, Math.max(0, offset)) }).length
      : offset;
    return { path, offset: Math.max(0, Number(logicalOffset) || 0) };
  };
  const selectionFor = (element: any) => {
    if (!element) return null;
    if (typeof element.selectionStart === 'number') {
      return {
        kind: 'control',
        start: element.selectionStart,
        end: element.selectionEnd,
        direction: element.selectionDirection,
      };
    }
    if (!element.isContentEditable) return null;
    const selection = shadow.getSelection?.() || doc.getSelection?.();
    if (!selection?.rangeCount || !element.contains(selection.anchorNode) || !element.contains(selection.focusNode)) return null;
    const anchorPoint = selectionPoint(element, selection.anchorNode, selection.anchorOffset);
    const focusPoint = selectionPoint(element, selection.focusNode, selection.focusOffset);
    return anchorPoint && focusPoint ? { kind: 'contenteditable', anchor: anchorPoint, focus: focusPoint } : null;
  };
  const editableHtml = (element: any) => {
    if (!element?.isContentEditable) return undefined;
    const clone = element.cloneNode(true);
    for (const pseudo of [...clone.querySelectorAll('[data-attune-smuggle-pseudo]')]) pseudo.remove();
    for (const node of [clone, ...clone.querySelectorAll('[data-attune-smuggle-path]')]) {
      node.removeAttribute?.('data-attune-smuggle-path');
    }
    return String(clone.innerHTML || '').slice(0, 200_000);
  };
  const captureAction = (event: any) => {
    const path = pathFromEvent(event);
    if (!path) return;
    const pathKey = path.join('.');
    const eventTarget = event.target?.nodeType === 1 ? event.target : event.target?.parentElement;
    const editable = eventTarget?.closest?.('input,textarea,select,[contenteditable="true"],[contenteditable="plaintext-only"]');
    if (event.type === 'beforeinput') {
      beforeInputSelections.set(pathKey, selectionFor(editable));
      return;
    }
    if (event.type === 'click') {
      if (!editable) event.preventDefault();
      event.stopPropagation();
      const pathElement = pathElementFromEvent(event);
      const bounds = pathElement?.getBoundingClientRect?.();
      const hasPointerPosition = event.isTrusted && bounds?.width > 0 && bounds?.height > 0;
      enqueueAction({
        type: 'click', path, trusted: event.isTrusted, editable: Boolean(editable),
        position: hasPointerPosition ? {
          xRatio: (event.clientX - bounds.left) / bounds.width,
          yRatio: (event.clientY - bounds.top) / bounds.height,
        } : undefined,
        selectionAfter: selectionFor(editable),
      });
    } else if (event.type === 'input' || event.type === 'change') {
      const target = event.target;
      event.stopPropagation();
      enqueueAction({
        type: event.type,
        path,
        value: target?.value,
        checked: target?.checked,
        contentEditable: Boolean(target?.isContentEditable),
        html: editableHtml(target),
        inputType: event.inputType,
        data: typeof event.data === 'string' ? event.data : null,
        trusted: event.isTrusted,
        selectionBefore: beforeInputSelections.get(pathKey) || null,
        selectionAfter: selectionFor(editable),
      });
      beforeInputSelections.delete(pathKey);
    } else if (event.type === 'keydown') {
      const modifierOnly = ['Alt', 'Control', 'Meta', 'Shift'].includes(String(event.key || ''));
      const appShortcut = Boolean(editable) && (event.metaKey || event.ctrlKey) && !modifierOnly;
      if (appShortcut) event.preventDefault();
      if (editable) event.stopPropagation();
      if (appShortcut) {
        enqueueAction({
          type: 'shortcut', path, key: event.key, code: event.code, trusted: event.isTrusted,
          editable: true, selectionBefore: selectionFor(editable),
          altKey: event.altKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey,
          repeat: event.repeat,
        });
      } else {
        enqueueAction({
          type: 'keydown', path, key: event.key, code: event.code, trusted: event.isTrusted,
          editable: Boolean(editable),
          selectionBefore: selectionFor(editable),
          altKey: event.altKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey,
        });
      }
    }
  };
  surface.addEventListener('click', captureAction, true);
  surface.addEventListener('beforeinput', captureAction, true);
  surface.addEventListener('input', captureAction, true);
  surface.addEventListener('change', captureAction, true);
  surface.addEventListener('keydown', captureAction, true);
  portalSurface.addEventListener('click', captureAction, true);
  portalSurface.addEventListener('beforeinput', captureAction, true);
  portalSurface.addEventListener('input', captureAction, true);
  portalSurface.addEventListener('change', captureAction, true);
  portalSurface.addEventListener('keydown', captureAction, true);
  const requestClose = (trusted = false) => {
    if (closing) return false;
    closing = true;
    observer.disconnect();
    enqueueAction({ type: 'close', trusted });
    host.remove();
    return true;
  };
  close.addEventListener('click', (event: any) => {
    event.preventDefault();
    event.stopPropagation();
    requestClose(event.isTrusted);
  });

  const createNode = (serialized: any): any => {
    if (!serialized) return null;
    if (serialized.kind === 'text') return doc.createTextNode(serialized.text || '');
    const element = serialized.namespace === 'http://www.w3.org/2000/svg'
      ? doc.createElementNS(serialized.namespace, serialized.tag)
      : doc.createElement(serialized.tag || 'div');
    for (const [name, value] of Object.entries(serialized.attributes || {})) {
      try {
        if (name === 'xlink:href') element.setAttributeNS('http://www.w3.org/1999/xlink', name, String(value));
        else if (name === 'xml:space') element.setAttributeNS('http://www.w3.org/XML/1998/namespace', name, String(value));
        else element.setAttribute(name, String(value));
      } catch {}
    }
    element.setAttribute('data-attune-smuggle-path', (serialized.path || []).join('.'));
    for (const [property, value] of Object.entries(serialized.style || {})) {
      try { element.style.setProperty(property, String(value)); } catch {}
    }
    if ((serialized.path || []).length === 0 && ['fixed', 'absolute'].includes(element.style.position)) {
      element.style.position = 'relative';
      element.style.inset = 'auto';
    }
    const createPseudo = (pseudo: any) => {
      if (!pseudo) return null;
      const node = doc.createElement('span');
      node.setAttribute('data-attune-smuggle-pseudo', pseudo.side || '');
      node.setAttribute('aria-hidden', 'true');
      node.setAttribute('contenteditable', 'false');
      for (const [property, value] of Object.entries(pseudo.style || {})) {
        try { node.style.setProperty(property, String(value)); } catch {}
      }
      node.style.pointerEvents = 'none';
      node.style.userSelect = 'none';
      node.textContent = pseudo.text || '';
      return node;
    };
    const before = createPseudo(serialized.before);
    if (before) element.appendChild(before);
    for (const child of serialized.children || []) {
      const childNode = createNode(child);
      if (childNode) element.appendChild(childNode);
    }
    const after = createPseudo(serialized.after);
    if (after) element.appendChild(after);
    if (serialized.state) {
      if ('value' in serialized.state && 'value' in element) element.value = serialized.state.value;
      if ('checked' in serialized.state && 'checked' in element) element.checked = serialized.state.checked;
      if ('selectedIndex' in serialized.state && 'selectedIndex' in element) element.selectedIndex = serialized.state.selectedIndex;
    }
    return element;
  };
  let currentFrame: any = null;
  let currentSourceSize = { width: 0, height: 0 };
  let currentVisualFrame: any = null;
  let currentVisualSequence = 0;
  let currentSatellites: Array<{ wrapper: any; bounds: any }> = [];
  let customViewSize: { width: number; height: number } | null = null;
  let customViewOffset = { x: 0, y: 0 };
  let resizeState: any = null;
  const sourceSize = () => ({
    width: Math.max(1, Number(currentSourceSize.width) || Number(currentVisualFrame?.rootWidth) || Number(currentVisualFrame?.width) || 1),
    height: Math.max(1, Number(currentSourceSize.height) || Number(currentVisualFrame?.rootHeight) || Number(currentVisualFrame?.height) || 1),
  });
  const viewSize = () => {
    const source = sourceSize();
    return {
      width: Math.max(1, Number(customViewSize?.width) || source.width),
      height: Math.max(1, Number(customViewSize?.height) || source.height),
    };
  };
  const applyHostGeometry = (size: { width: number; height: number }) => {
    host.style.width = `${size.width}px`;
    host.style.height = `${size.height}px`;
    host.style.transform = customViewOffset.x || customViewOffset.y
      ? `translate(${customViewOffset.x}px, ${customViewOffset.y}px)`
      : 'none';
    host.style.transformOrigin = 'top left';
    surface.style.width = `${size.width}px`;
    surface.style.height = `${size.height}px`;
  };
  positionResizeLayer = () => {
    if (!selectionModeActive || !host.isConnected) {
      resizeLayer.style.display = 'none';
      return;
    }
    const bounds = host.getBoundingClientRect();
    if (!(bounds.width > 0) || !(bounds.height > 0)) {
      resizeLayer.style.display = 'none';
      return;
    }
    resizeLayer.style.display = 'block';
    resizeLayer.style.left = `${bounds.left}px`;
    resizeLayer.style.top = `${bounds.top}px`;
    resizeLayer.style.width = `${bounds.width}px`;
    resizeLayer.style.height = `${bounds.height}px`;
  };
  const positionSatellites = () => {
    const rootElement = currentFrame?.firstElementChild;
    if (!rootElement?.isConnected) return;
    const source = sourceSize();
    const view = viewSize();
    const scaleX = view.width / source.width;
    const scaleY = view.height / source.height;
    const rootBounds = rootElement.getBoundingClientRect();
    for (const satellite of currentSatellites) {
      satellite.wrapper.style.left = `${rootBounds.left + Number(satellite.bounds.x || 0) * scaleX}px`;
      satellite.wrapper.style.top = `${rootBounds.top + Number(satellite.bounds.y || 0) * scaleY}px`;
      satellite.wrapper.style.width = `${Number(satellite.bounds.width || 0)}px`;
      satellite.wrapper.style.height = `${Number(satellite.bounds.height || 0)}px`;
      satellite.wrapper.style.transform = `scale(${scaleX}, ${scaleY})`;
    }
  };
  const renderSatellites = (satellites: any[]) => {
    for (const satellite of currentSatellites) satellite.wrapper.remove();
    currentSatellites = [];
    for (const satellite of satellites || []) {
      const next = createNode(satellite.tree);
      if (!next) continue;
      if (['fixed', 'absolute'].includes(next.style.position)) {
        next.style.position = 'relative';
        next.style.inset = 'auto';
        next.style.transform = 'none';
      }
      const wrapper = doc.createElement('div');
      wrapper.setAttribute('data-attune-component-smuggle', 'satellite');
      Object.assign(wrapper.style, {
        position: 'fixed', transformOrigin: 'top left', pointerEvents: 'auto', overflow: 'visible',
      });
      wrapper.appendChild(next);
      portalSurface.appendChild(wrapper);
      currentSatellites.push({ wrapper, bounds: satellite.bounds || {} });
    }
    positionSatellites();
  };
  const fitSurface = () => {
    if (!currentFrame?.isConnected) return;
    const source = sourceSize();
    const view = viewSize();
    const scaleX = view.width / source.width;
    const scaleY = view.height / source.height;
    applyHostGeometry(view);
    currentFrame.style.width = `${source.width}px`;
    currentFrame.style.height = `${source.height}px`;
    currentFrame.style.transform = `scale(${scaleX}, ${scaleY})`;
    currentFrame.style.transformOrigin = 'top left';
    positionSatellites();
    layoutContainedHost();
    positionResizeLayer();
  };
  const fitVisual = () => {
    if (!currentVisualFrame || visualViewport.parentElement !== surface) return;
    const source = sourceSize();
    const view = viewSize();
    const scaleX = view.width / source.width;
    const scaleY = view.height / source.height;
    applyHostGeometry(view);
    visualViewport.style.width = `${view.width}px`;
    visualViewport.style.height = `${view.height}px`;
    visualImage.style.left = `${Number(currentVisualFrame.offsetX || 0) * scaleX}px`;
    visualImage.style.top = `${Number(currentVisualFrame.offsetY || 0) * scaleY}px`;
    visualImage.style.width = `${Number(currentVisualFrame.width || source.width) * scaleX}px`;
    visualImage.style.height = `${Number(currentVisualFrame.height || source.height) * scaleY}px`;
    layoutContainedHost();
    positionResizeLayer();
  };
  const refreshView = () => {
    fitSurface();
    fitVisual();
    layoutContainedHost();
    positionResizeLayer();
  };
  const resizeTo = (width: number, height: number) => {
    const nextWidth = Math.max(48, Math.min(8192, Number(width) || viewSize().width));
    const nextHeight = Math.max(32, Math.min(8192, Number(height) || viewSize().height));
    customViewSize = { width: nextWidth, height: nextHeight };
    refreshView();
    return { ...customViewSize };
  };
  const resetSize = () => {
    customViewSize = null;
    customViewOffset = { x: 0, y: 0 };
    refreshView();
    return viewSize();
  };
  const suspendPickerFrame = () => {
    for (const kind of ['freeze', 'outline', 'placement', 'label']) {
      const node = doc.querySelector(`[data-attune-element-picker=${JSON.stringify(kind)}]`);
      node?.style?.setProperty?.('display', 'none', 'important');
    }
  };
  const beginResize = (direction: string, event: any) => {
    if (!selectionModeActive || closing || disposed) return;
    const bounds = host.getBoundingClientRect();
    resizeState = {
      direction,
      pointerId: event.pointerId,
      startX: Number(event.clientX) || 0,
      startY: Number(event.clientY) || 0,
      width: bounds.width,
      height: bounds.height,
      offsetX: customViewOffset.x,
      offsetY: customViewOffset.y,
    };
    suspendPickerFrame();
    event.preventDefault?.();
    event.stopPropagation?.();
    event.stopImmediatePropagation?.();
  };
  const moveResize = (event: any) => {
    if (!resizeState || (resizeState.pointerId !== undefined && event.pointerId !== resizeState.pointerId)) return;
    const deltaX = (Number(event.clientX) || 0) - resizeState.startX;
    const deltaY = (Number(event.clientY) || 0) - resizeState.startY;
    let width = resizeState.width;
    let height = resizeState.height;
    if (resizeState.direction.includes('e')) width = resizeState.width + deltaX;
    if (resizeState.direction.includes('w')) width = resizeState.width - deltaX;
    if (resizeState.direction.includes('s')) height = resizeState.height + deltaY;
    if (resizeState.direction.includes('n')) height = resizeState.height - deltaY;
    width = Math.max(48, Math.min(8192, width));
    height = Math.max(32, Math.min(8192, height));
    customViewOffset = {
      x: resizeState.offsetX + (resizeState.direction.includes('w') ? resizeState.width - width : 0),
      y: resizeState.offsetY + (resizeState.direction.includes('n') ? resizeState.height - height : 0),
    };
    customViewSize = { width, height };
    refreshView();
    event.preventDefault?.();
    event.stopPropagation?.();
    event.stopImmediatePropagation?.();
  };
  const endResize = (event: any) => {
    if (!resizeState || (resizeState.pointerId !== undefined && event.pointerId !== resizeState.pointerId)) return;
    resizeState = null;
    positionResizeLayer();
    event.preventDefault?.();
    event.stopPropagation?.();
    event.stopImmediatePropagation?.();
  };
  for (const [direction, handle] of resizeHandles) {
    handle.addEventListener('pointerdown', (event: any) => beginResize(direction, event), true);
  }
  runtime.addEventListener('pointermove', moveResize, true);
  runtime.addEventListener('pointerup', endResize, true);
  runtime.addEventListener('pointercancel', endResize, true);
  const applyVisual = (frame: any) => {
    if (disposed || !frame?.data || Number(frame.sequence) <= currentVisualSequence) return false;
    appendHost();
    currentVisualSequence = Number(frame.sequence);
    currentVisualFrame = frame;
    currentFrame = null;
    currentSourceSize = {
      width: Number(frame.rootWidth || frame.width) || 0,
      height: Number(frame.rootHeight || frame.height) || 0,
    };
    if (visualViewport.parentElement !== surface) surface.replaceChildren(visualViewport);
    visualImage.src = `data:image/png;base64,${frame.data}`;
    fitVisual();
    return true;
  };
  const captureFocus = () => {
    const active = shadow.activeElement;
    if (!active || !surface.contains(active)) return null;
    const path = active.getAttribute?.('data-attune-smuggle-path');
    if (path === null || path === undefined) return null;
    return { path, selection: selectionFor(active) };
  };
  const resolveSelectionPoint = (rootElement: any, point: any) => {
    let node = rootElement;
    for (const index of point?.path || []) node = logicalChildren(node)[index];
    if (!node) return null;
    const maximum = node.nodeType === 3 ? String(node.nodeValue || '').length : logicalChildren(node).length;
    return { node, offset: Math.max(0, Math.min(Number(point?.offset) || 0, maximum)) };
  };
  const restoreSelection = (active: any, selectionState: any) => {
    if (!selectionState) return;
    if (selectionState.kind === 'control' && typeof active.setSelectionRange === 'function') {
      try {
        active.setSelectionRange(selectionState.start, selectionState.end, selectionState.direction || 'none');
      } catch {}
      return;
    }
    if (selectionState.kind !== 'contenteditable') return;
    const anchorPoint = resolveSelectionPoint(active, selectionState.anchor);
    const focusPoint = resolveSelectionPoint(active, selectionState.focus);
    if (!anchorPoint || !focusPoint) return;
    try {
      const selection = shadow.getSelection?.() || doc.getSelection?.();
      if (!selection) return;
      selection.removeAllRanges();
      if (typeof selection.setBaseAndExtent === 'function') {
        selection.setBaseAndExtent(anchorPoint.node, anchorPoint.offset, focusPoint.node, focusPoint.offset);
      } else {
        const range = doc.createRange();
        range.setStart(anchorPoint.node, anchorPoint.offset);
        range.setEnd(focusPoint.node, focusPoint.offset);
        selection.addRange(range);
      }
    } catch {}
  };
  const restoreFocus = (state: any) => {
    if (!state) return;
    const escaped = runtime.CSS?.escape ? runtime.CSS.escape(String(state.path)) : String(state.path).replace(/"/g, '\\"');
    const active = surface.querySelector(`[data-attune-smuggle-path="${escaped}"]`);
    if (!active?.focus) return;
    active.focus({ preventScroll: true });
    restoreSelection(active, state.selection);
  };
  const patchNode = (current: any, next: any): any => {
    if (!current) return next;
    const sameElement = current.nodeType === 1 && next.nodeType === 1
      && current.localName === next.localName && current.namespaceURI === next.namespaceURI;
    if (current.nodeType !== next.nodeType || (current.nodeType === 1 && !sameElement)) {
      current.replaceWith(next);
      return next;
    }
    if (current.nodeType === 3) {
      if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue;
      return current;
    }
    for (const name of current.getAttributeNames?.() || []) {
      if (!next.hasAttribute(name)) current.removeAttribute(name);
    }
    for (const name of next.getAttributeNames?.() || []) {
      const value = next.getAttribute(name);
      if (current.getAttribute(name) !== value) current.setAttribute(name, value);
    }
    if ('value' in current && current.value !== next.value) current.value = next.value;
    if ('checked' in current && current.checked !== next.checked) current.checked = next.checked;
    if ('selectedIndex' in current && current.selectedIndex !== next.selectedIndex) current.selectedIndex = next.selectedIndex;
    const currentChildren = [...current.childNodes];
    const nextChildren = [...next.childNodes];
    for (let index = 0; index < Math.max(currentChildren.length, nextChildren.length); index += 1) {
      if (!currentChildren[index] && nextChildren[index]) current.appendChild(nextChildren[index]);
      else if (currentChildren[index] && !nextChildren[index]) currentChildren[index].remove();
      else if (currentChildren[index] && nextChildren[index]) patchNode(currentChildren[index], nextChildren[index]);
    }
    return current;
  };
  const apply = (packets: any[]) => {
    if (disposed) return false;
    appendHost();
    for (const packet of packets || []) {
      if (packet.type !== 'snapshot' || packet.version <= lastVersion) continue;
      const acknowledgedRevision = Number(packet.acknowledgedActionRevision) || 0;
      if (acknowledgedRevision < latestActionRevision) continue;
      const focusState = captureFocus();
      const next = createNode(packet.tree);
      if (!next) continue;
      if (!currentFrame?.isConnected) {
        const frame = doc.createElement('div');
        frame.setAttribute('data-attune-component-smuggle', 'frame');
        Object.assign(frame.style, { display: 'block', position: 'relative', transformOrigin: 'top left' });
        frame.appendChild(next);
        surface.replaceChildren(frame);
        currentFrame = frame;
      } else if (currentFrame.firstChild) {
        patchNode(currentFrame.firstChild, next);
      } else {
        currentFrame.appendChild(next);
      }
      const renderedRoot = currentFrame.firstElementChild;
      currentSourceSize = {
        width: Number(packet.diagnostics?.width) || renderedRoot?.scrollWidth || 0,
        height: Number(packet.diagnostics?.height) || renderedRoot?.scrollHeight || 0,
      };
      renderSatellites(packet.satellites || []);
      fitSurface();
      restoreFocus(focusState);
      runtime.requestAnimationFrame(fitSurface);
      lastVersion = packet.version;
      lastAcknowledgedActionRevision = acknowledgedRevision;
    }
    return true;
  };
  const observer = new runtime.MutationObserver(() => { if (!disposed && !closing) appendHost(); });
  observer.observe(doc.documentElement, { subtree: true, childList: true });
  const resizeObserver = runtime.ResizeObserver ? new runtime.ResizeObserver(() => { fitSurface(); fitVisual(); layoutContainedHost(); }) : null;
  resizeObserver?.observe(host);
  runtime.addEventListener('resize', remeasureContainedMount, true);
  runtime.addEventListener('scroll', positionResizeLayer, true);
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    observer.disconnect();
    selectionModeObserver.disconnect();
    resizeObserver?.disconnect();
    runtime.removeEventListener('resize', remeasureContainedMount, true);
    runtime.removeEventListener('scroll', positionResizeLayer, true);
    runtime.removeEventListener('pointermove', moveResize, true);
    runtime.removeEventListener('pointerup', endResize, true);
    runtime.removeEventListener('pointercancel', endResize, true);
    host.remove();
    portalHost.remove();
    releaseContainedMount();
    layoutStyle.remove();
    try { mount?.removeAttribute?.('data-attune-smuggle-anchor'); } catch {}
    if (runtime.__attuneSmuggleAnchors) delete runtime.__attuneSmuggleAnchors[anchor.token];
    delete runtime.__attuneComponentSmuggleTarget;
  };
  runtime.__attuneComponentSmuggleTarget = {
    apply,
    applyVisual,
    requestClose,
    resizeTo,
    resetSize,
    isResizing: () => Boolean(resizeState),
    drainActions: () => actions.splice(0),
    cleanup,
    status: () => ({
      connected: host.isConnected,
      version: lastVersion,
      latestActionRevision,
      acknowledgedActionRevision: lastAcknowledgedActionRevision,
      pendingActionCount: actions.length,
      satelliteCount: currentSatellites.length,
      rendering: currentVisualFrame ? 'source-capture' : 'dom-twin',
      visualSequence: currentVisualSequence,
      sourceSize: sourceSize(),
      viewSize: viewSize(),
      viewOffset: { ...customViewOffset },
      customSize: Boolean(customViewSize),
      resizing: Boolean(resizeState),
      closing,
      placement,
      placementLayout: contained ? 'contained' : 'inside',
      mountTag: mount?.tagName?.toLowerCase?.() || '',
      roles: compact(mount?.getAttribute?.('data-attune-host-roles'), 300).split(/\s+/).filter(Boolean),
    }),
  };
  return { ok: true, connected: host.isConnected, placement };
}

type CdpResponse = {
  id?: number;
  result?: { result?: { value?: unknown; description?: string }; [key: string]: unknown };
  error?: { message?: string };
};

type WebSocketLike = {
  addEventListener(type: string, listener: (event: any) => void, options?: { once?: boolean }): void;
  send(message: string): void;
  close(): void;
};

class CdpPageClient implements ComponentSmugglePageClient {
  private socket: WebSocketLike | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, {
    resolve(value: CdpResponse['result']): void;
    reject(error: Error): void;
    timer: NodeJS.Timeout;
  }>();

  constructor(private readonly url: string, private readonly label: string) {}

  async connect(): Promise<void> {
    const WebSocketConstructor = (globalThis as unknown as { WebSocket?: new (url: string) => WebSocketLike }).WebSocket;
    if (!WebSocketConstructor) throw new Error('Chromium connection support is unavailable');
    this.socket = new WebSocketConstructor(this.url);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${this.label} connection timed out`)), 5000);
      this.socket!.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      this.socket!.addEventListener('error', () => { clearTimeout(timer); reject(new Error(`${this.label} connection failed`)); }, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      let message: CdpResponse;
      try { message = JSON.parse(String(event.data)); } catch { return; }
      if (!message.id || !this.pending.has(message.id)) return;
      const pending = this.pending.get(message.id)!;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(`${this.label}: ${message.error.message || 'CDP command failed'}`));
      else pending.resolve(message.result);
    });
    const rejectPending = () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`${this.label} disconnected`));
      }
      this.pending.clear();
    };
    this.socket.addEventListener('close', rejectPending);
    this.socket.addEventListener('error', rejectPending);
  }

  private send(method: string, params: Record<string, unknown> = {}, timeoutMs = 15000): Promise<CdpResponse['result']> {
    if (!this.socket) throw new Error(`${this.label} is not connected`);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${this.label} ${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket!.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression: string, timeoutMs = 20000): Promise<any> {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    }, timeoutMs);
    const remote = result?.result;
    if (remote?.description?.startsWith('Uncaught')) throw new Error(`${this.label}: ${remote.description}`);
    return remote?.value;
  }

  async click(x: number, y: number): Promise<void> {
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  }

  async move(x: number, y: number): Promise<void> {
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x, y, button: 'none', buttons: 0, pointerType: 'mouse',
    });
  }

  async wheel(
    x: number,
    y: number,
    deltaX: number,
    deltaY: number,
    modifiers: { altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean } = {},
  ): Promise<void> {
    const modifierMask = (modifiers.altKey ? 1 : 0)
      | (modifiers.ctrlKey ? 2 : 0)
      | (modifiers.metaKey ? 4 : 0)
      | (modifiers.shiftKey ? 8 : 0);
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel', x, y, deltaX, deltaY, modifiers: modifierMask,
      button: 'none', buttons: 0, pointerType: 'mouse',
    });
  }

  async insertText(value: string): Promise<void> {
    await this.send('Input.insertText', { text: value });
  }

  async pressKey(
    key: string,
    code: string,
    modifiers: { altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean } = {},
  ): Promise<void> {
    const virtualKeyCodes: Record<string, number> = {
      Backspace: 8, Tab: 9, Enter: 13, Escape: 27, ' ': 32,
      ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40,
      Delete: 46, Home: 36, End: 35, PageUp: 33, PageDown: 34,
    };
    const modifierMask = (modifiers.altKey ? 1 : 0)
      | (modifiers.ctrlKey ? 2 : 0)
      | (modifiers.metaKey ? 4 : 0)
      | (modifiers.shiftKey ? 8 : 0);
    const params = {
      key,
      code: code || key,
      modifiers: modifierMask,
      windowsVirtualKeyCode: virtualKeyCodes[key] || (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0),
      nativeVirtualKeyCode: virtualKeyCodes[key] || 0,
    };
    await this.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...params });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...params });
  }

  close(): void {
    this.socket?.close();
    this.socket = null;
  }
}

export class ComponentSmuggleBridge {
  private readonly sourceClient: ComponentSmugglePageClient;
  private readonly targetClient: ComponentSmugglePageClient;
  private timer: NodeJS.Timeout | null = null;
  private pumping = false;
  private stopped = false;
  private firstSnapshotLogged = false;
  private lastSatelliteCount = -1;
  private lastRuntimeCheckAt = 0;
  private visualSequence = 0;
  private visualFrameApplying = false;
  private pendingVisualFrame: { data: string; region: ComponentSmuggleCaptureRegion } | null = null;
  private visualCaptureKey = '';
  private stopVisualFrameStream: (() => void | Promise<void>) | null = null;

  constructor(
    readonly source: ComponentSmuggleEndpoint,
    readonly target: ComponentSmuggleEndpoint,
    private readonly onStop?: (reason: 'closed' | 'error', error?: Error) => void,
    private readonly forwardKeyChord?: ComponentSmuggleKeyForwarder,
    private readonly startFrameStream?: ComponentSmuggleFrameStreamStarter,
    pageClients: { source?: ComponentSmugglePageClient; target?: ComponentSmugglePageClient } = {},
  ) {
    this.sourceClient = pageClients.source
      ?? new CdpPageClient(source.webSocketDebuggerUrl, `${source.appName} source`);
    this.targetClient = pageClients.target
      ?? new CdpPageClient(target.webSocketDebuggerUrl, `${target.appName} target`);
  }

  async start(): Promise<void> {
    this.log('starting', {
      sourceApp: this.source.appName,
      sourceRoles: this.source.anchor.roles,
      sourceTag: this.source.anchor.fingerprint.tag,
      targetApp: this.target.appName,
      targetRoles: this.target.anchor.roles,
      targetTag: this.target.anchor.fingerprint.tag,
      targetPlacement: this.target.anchor.placement,
    });
    await Promise.all([this.sourceClient.connect(), this.targetClient.connect()]);
    const [sourceResult, targetResult] = await Promise.all([
      this.sourceClient.evaluate(buildComponentSmuggleSourceExpression(this.source.anchor)),
      this.targetClient.evaluate(buildComponentSmuggleTargetExpression(this.target.anchor)),
    ]);
    if (!sourceResult?.ok) throw new Error(`Could not resolve the source component: ${sourceResult?.reason || 'unknown error'}`);
    if (!targetResult?.ok) throw new Error(`Could not resolve the destination: ${targetResult?.reason || 'unknown error'}`);
    this.log('installed', { sourceConnected: sourceResult.connected, targetConnected: targetResult.connected });
    await this.ensureVisualFrameStream(true);
    const pumpIntervalMs = Math.max(
      40,
      this.sourceClient.recommendedPumpIntervalMs || 0,
      this.targetClient.recommendedPumpIntervalMs || 0,
    );
    this.timer = setInterval(() => void this.pump(), pumpIntervalMs);
    await this.pump();
  }

  private async reinstallMissingRuntime(): Promise<void> {
    const now = Date.now();
    if (now - this.lastRuntimeCheckAt < 1000) return;
    this.lastRuntimeCheckAt = now;
    const [sourceStatus, targetStatus] = await Promise.all([
      this.sourceClient.evaluate('globalThis.__attuneComponentSmuggleSource?.status?.() || null'),
      this.targetClient.evaluate('globalThis.__attuneComponentSmuggleTarget?.status?.() || null'),
    ]);
    if (!sourceStatus) {
      this.log('reinstalling-source');
      await this.sourceClient.evaluate(buildComponentSmuggleSourceExpression(this.source.anchor));
    }
    if (!targetStatus) {
      this.log('reinstalling-target');
      await this.targetClient.evaluate(buildComponentSmuggleTargetExpression(this.target.anchor));
    }
    await this.ensureVisualFrameStream();
  }

  private async ensureVisualFrameStream(force = false): Promise<void> {
    if (!this.startFrameStream || this.stopped) return;
    const region = await this.sourceClient.evaluate(
      'globalThis.__attuneComponentSmuggleSource?.captureRegion?.() || null',
    ) as ComponentSmuggleCaptureRegion | null;
    if (!region?.width || !region?.height) return;
    const captureKey = [
      region.screenX, region.screenY, region.outerWidth, region.outerHeight,
      region.contentOffsetX, region.contentOffsetY,
      region.x, region.y, region.width, region.height,
    ].map((value) => Math.round(Number(value) * 2) / 2).join(':');
    if (!force && captureKey === this.visualCaptureKey && this.stopVisualFrameStream) return;
    const previousStop = this.stopVisualFrameStream;
    this.stopVisualFrameStream = null;
    if (previousStop) await previousStop();
    this.visualCaptureKey = captureKey;
    const stop = await this.startFrameStream(region, (data) => this.enqueueVisualFrame(data, region));
    if (this.stopped) {
      await stop();
      return;
    }
    this.stopVisualFrameStream = stop;
    this.log('visual-stream-started', {
      width: Math.round(region.width),
      height: Math.round(region.height),
    });
  }

  private enqueueVisualFrame(data: string, region: ComponentSmuggleCaptureRegion): void {
    if (this.stopped || !data) return;
    this.pendingVisualFrame = { data, region };
    if (!this.visualFrameApplying) void this.flushVisualFrames();
  }

  private async flushVisualFrames(): Promise<void> {
    if (this.visualFrameApplying || this.stopped) return;
    this.visualFrameApplying = true;
    try {
      while (!this.stopped && this.pendingVisualFrame) {
        const { data, region } = this.pendingVisualFrame;
        this.pendingVisualFrame = null;
        this.visualSequence += 1;
        const frame = {
          sequence: this.visualSequence,
          data,
          width: region.width,
          height: region.height,
          rootWidth: region.rootWidth,
          rootHeight: region.rootHeight,
          offsetX: region.offsetX,
          offsetY: region.offsetY,
        };
        await this.targetClient.evaluate(
          `globalThis.__attuneComponentSmuggleTarget?.applyVisual?.(${JSON.stringify(frame)}) || false`,
        );
      }
    } catch (error) {
      if (!this.stopped) {
        this.log('visual-stream-frame-error', { message: error instanceof Error ? error.message : String(error) });
      }
    } finally {
      this.visualFrameApplying = false;
      if (!this.stopped && this.pendingVisualFrame) void this.flushVisualFrames();
    }
  }

  private async pump(): Promise<void> {
    if (this.stopped || this.pumping) return;
    this.pumping = true;
    try {
      await this.reinstallMissingRuntime();
      const actions = await this.targetClient.evaluate('globalThis.__attuneComponentSmuggleTarget?.drainActions?.() || []');
      if (actions?.length) {
        const actionCounts = actions.reduce((counts: Record<string, number>, action: { type?: string }) => {
          const type = String(action?.type || 'unknown');
          counts[type] = (counts[type] || 0) + 1;
          return counts;
        }, {});
        const diagnosticCounts = Object.fromEntries(
          Object.entries(actionCounts).filter(([type]) => type !== 'visual-hover' && type !== 'visual-wheel'),
        );
        if (Object.keys(diagnosticCounts).length) this.log('target-actions', diagnosticCounts);
      }
      const replayable = [];
      for (const action of actions || []) {
        if (action.type === 'close') {
          await this.stop(true);
          this.onStop?.('closed');
          return;
        }
        if (action.type === 'visual-click') {
          const point = await this.sourceClient.evaluate(
            `globalThis.__attuneComponentSmuggleSource?.capturePoint?.(${JSON.stringify(action.position || null)}) || null`,
          );
          if (point) await this.sourceClient.click(point.x, point.y);
        } else if (action.type === 'visual-hover') {
          const point = await this.sourceClient.evaluate(
            `globalThis.__attuneComponentSmuggleSource?.hoverPoint?.(${JSON.stringify(action.position || null)}) || null`,
          );
          if (point) await this.sourceClient.move(point.x, point.y);
        } else if (action.type === 'visual-wheel') {
          const point = await this.sourceClient.evaluate(
            `globalThis.__attuneComponentSmuggleSource?.hoverPoint?.(${JSON.stringify(action.position || null)}) || null`,
          );
          if (point) await this.sourceClient.wheel(point.x, point.y, action.deltaX, action.deltaY, action);
        } else if (action.type === 'visual-edit' && action.trusted) {
          await this.replayVisualEdit(action);
        } else if (action.type === 'visual-key' && action.trusted) {
          try {
            await this.sourceClient.evaluate('globalThis.__attuneComponentSmuggleSource?.focusPrimaryEditable?.() || null');
            if (action.metaKey || action.ctrlKey) {
              if (!this.forwardKeyChord) throw new Error('native key forwarding is unavailable');
              const result = await this.forwardKeyChord(action);
              this.log('visual-shortcut-forwarded', { code: action.code, result });
            } else {
              await this.sourceClient.pressKey(action.key, action.code, action);
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.log('visual-key-forward-error', { code: action.code, message });
          }
        } else if (action.type === 'click') {
          const point = await this.sourceClient.evaluate(
            `globalThis.__attuneComponentSmuggleSource?.clickPoint?.(${JSON.stringify(action.path)}, ${JSON.stringify(action.position || null)}) || null`,
          );
          if (point) await this.sourceClient.click(point.x, point.y);
          if (action.editable && action.selectionAfter) {
            await this.sourceClient.evaluate(
              `globalThis.__attuneComponentSmuggleSource?.focusPath?.(${JSON.stringify(action.path)}, ${JSON.stringify(action.selectionAfter)}) || null`,
            );
          }
        } else if (action.type === 'input' && action.trusted && action.inputType) {
          const handled = await this.replayNativeEdit(action);
          if (!handled) replayable.push(action);
        } else if (action.type === 'shortcut' && action.trusted && action.editable) {
          try {
            await this.sourceClient.evaluate(
              `globalThis.__attuneComponentSmuggleSource?.focusPath?.(${JSON.stringify(action.path)}, ${JSON.stringify(action.selectionBefore || null)}) || null`,
            );
            if (!this.forwardKeyChord) throw new Error('native key forwarding is unavailable');
            const result = await this.forwardKeyChord(action);
            this.log('shortcut-forwarded', { code: action.code, result });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.log('shortcut-forward-error', { code: action.code, message });
          }
        } else if (action.type === 'keydown' && action.trusted && action.editable) {
          const navigationKeys = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown', 'Tab', 'Escape']);
          if (navigationKeys.has(action.key)) {
            await this.sourceClient.evaluate(
              `globalThis.__attuneComponentSmuggleSource?.focusPath?.(${JSON.stringify(action.path)}, ${JSON.stringify(action.selectionBefore || null)}) || null`,
            );
            await this.sourceClient.pressKey(action.key, action.code, action);
          }
        } else {
          replayable.push(action);
        }
      }
      if (replayable.length) {
        await this.sourceClient.evaluate(
          `globalThis.__attuneComponentSmuggleSource?.applyActions?.(${JSON.stringify(replayable)})`,
        );
      }
      const latestActionRevision = (actions || []).reduce(
        (latest: number, action: { revision?: number }) => Math.max(latest, Number(action?.revision) || 0),
        0,
      );
      if (latestActionRevision) {
        await this.sourceClient.evaluate(
          `globalThis.__attuneComponentSmuggleSource?.settleActions?.(${latestActionRevision}) || null`,
        );
      }
      const packets = await this.sourceClient.evaluate('globalThis.__attuneComponentSmuggleSource?.drain?.() || []');
      if (packets?.length) {
        const latestDiagnostics = packets[packets.length - 1]?.diagnostics || {};
        if (!this.firstSnapshotLogged) {
          this.firstSnapshotLogged = true;
          this.log('first-snapshot', latestDiagnostics || { diagnostics: 'unavailable' });
        }
        const satelliteCount = Number(latestDiagnostics.satelliteCount || 0);
        if (satelliteCount !== this.lastSatelliteCount) {
          this.lastSatelliteCount = satelliteCount;
          this.log('satellites-changed', { count: satelliteCount });
        }
      }
      if (packets?.length && !this.startFrameStream) {
        await this.targetClient.evaluate(`globalThis.__attuneComponentSmuggleTarget?.apply?.(${JSON.stringify(packets)})`);
      }
    } catch (error) {
      if (this.stopped) return;
      const normalized = error instanceof Error ? error : new Error(String(error));
      this.log('error', { message: normalized.message });
      await this.stop(true);
      this.onStop?.('error', normalized);
    } finally {
      this.pumping = false;
    }
  }

  private async replayVisualEdit(action: any): Promise<boolean> {
    const focused = await this.sourceClient.evaluate(
      'globalThis.__attuneComponentSmuggleSource?.focusPrimaryEditable?.() || null',
    );
    if (!focused?.ok) return false;
    const inputType = String(action.inputType || '');
    if (inputType.startsWith('insert') && typeof action.data === 'string' && action.data) {
      await this.sourceClient.insertText(action.data);
      return true;
    }
    if (inputType === 'insertParagraph' || inputType === 'insertLineBreak') {
      await this.sourceClient.pressKey('Enter', 'Enter');
      return true;
    }
    return false;
  }

  private async replayNativeEdit(action: any): Promise<boolean> {
    const focused = await this.sourceClient.evaluate(
      `globalThis.__attuneComponentSmuggleSource?.focusPath?.(${JSON.stringify(action.path)}, ${JSON.stringify(action.selectionBefore || null)}) || null`,
    );
    if (!focused?.ok) return false;
    const inputType = String(action.inputType || '');
    if (inputType.startsWith('format')) return true;
    if (inputType.startsWith('insert') && typeof action.data === 'string' && action.data) {
      await this.sourceClient.insertText(action.data);
      return true;
    }
    if (inputType === 'insertParagraph' || inputType === 'insertLineBreak') {
      await this.sourceClient.pressKey('Enter', 'Enter');
      return true;
    }
    if (/^delete.*Backward$/.test(inputType)) {
      await this.sourceClient.pressKey('Backspace', 'Backspace');
      return true;
    }
    if (/^delete.*Forward$/.test(inputType)) {
      await this.sourceClient.pressKey('Delete', 'Delete');
      return true;
    }
    return false;
  }

  async stop(cleanup = true): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.log('stopping', { cleanup });
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const stopFrameStream = this.stopVisualFrameStream;
    this.stopVisualFrameStream = null;
    if (stopFrameStream) await stopFrameStream();
    if (cleanup) {
      await Promise.allSettled([
        this.sourceClient.evaluate('globalThis.__attuneComponentSmuggleSource?.cleanup?.()'),
        this.targetClient.evaluate('globalThis.__attuneComponentSmuggleTarget?.cleanup?.()'),
      ]);
    }
    this.sourceClient.close();
    this.targetClient.close();
    this.log('stopped');
  }

  private log(event: string, details?: Record<string, unknown>): void {
    const suffix = details ? ` ${JSON.stringify(details)}` : '';
    console.info(`[attune:smuggle] ${event}${suffix}`);
  }
}
