import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import type { ElementPickerSelection } from './element-picker.js';

export interface ComponentSmuggleAnchor {
  token: string;
  roles: string[];
  selector: string;
  fingerprint: ElementPickerSelection['fingerprint'];
  placement: 'inside' | 'replace' | 'top' | 'bottom' | 'left' | 'right';
}

export interface ComponentSmuggleEndpoint {
  appId: string;
  appName: string;
  appPid?: number;
  pageTitle?: string;
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
  pixelRatio?: number;
  continuousVisuals?: boolean;
  nativeWindowId?: number;
  islandId?: string;
  visualKind?: string;
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

export async function componentSmuggleEmbeddedFontCss(fontFaces: any[]): Promise<string> {
  const allowedExtensions = new Set(['.woff', '.woff2', '.ttf', '.otf']);
  const mimeTypes: Record<string, string> = {
    '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  };
  const descriptor = (value: unknown, fallback: string) => {
    const normalized = String(value || '').trim();
    return /^[a-zA-Z0-9 ._-]{1,80}$/.test(normalized) ? normalized : fallback;
  };
  const rules: string[] = [];
  const seen = new Set<string>();
  let totalBytes = 0;
  for (const face of (fontFaces || []).slice(0, 24)) {
    const family = String(face?.family || '').trim();
    if (!family || family.length > 160) continue;
    const urls = [...String(face?.src || '').matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)]
      .map((match) => match[2])
      .filter(Boolean);
    let embeddedSource = '';
    for (const candidate of urls) {
      let parsed: URL;
      try { parsed = new URL(candidate, String(face?.baseUrl || 'file:///')); } catch { continue; }
      if (!['file:', 'vscode-file:'].includes(parsed.protocol)) continue;
      let path: string;
      try { path = decodeURIComponent(parsed.pathname); } catch { continue; }
      const extension = extname(path).toLowerCase();
      if (!path.startsWith('/') || !allowedExtensions.has(extension)) continue;
      const key = `${family}\u0000${path}`;
      if (seen.has(key)) continue;
      try {
        const data = await readFile(path);
        if (!data.length || data.length > 2_000_000 || totalBytes + data.length > 6_000_000) continue;
        totalBytes += data.length;
        seen.add(key);
        embeddedSource = `url("data:${mimeTypes[extension]};base64,${data.toString('base64')}")`;
        break;
      } catch {}
    }
    if (!embeddedSource) continue;
    rules.push(`@font-face{font-family:${JSON.stringify(family)};src:${embeddedSource};font-style:${descriptor(face.style, 'normal')};font-weight:${descriptor(face.weight, 'normal')};font-stretch:${descriptor(face.stretch, 'normal')};font-display:${descriptor(face.display, 'swap')}}`);
  }
  return rules.join('\n');
}

export interface ComponentSmugglePageClient {
  readonly recommendedPumpIntervalMs?: number;
  connect(): Promise<void>;
  evaluate(expression: string, timeoutMs?: number): Promise<any>;
  click(x: number, y: number): Promise<void>;
  clickAtComponentPosition?(position?: { xRatio?: number; yRatio?: number }): Promise<void>;
  move(x: number, y: number): Promise<void>;
  moveAtComponentPosition?(position?: { xRatio?: number; yRatio?: number } | null): Promise<void>;
  wheel(
    x: number,
    y: number,
    deltaX: number,
    deltaY: number,
    modifiers?: { altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean },
  ): Promise<void>;
  wheelAtComponentPosition?(
    position: { xRatio?: number; yRatio?: number },
    deltaX: number,
    deltaY: number,
    modifiers?: { altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean },
  ): Promise<void>;
  insertText(value: string): Promise<void>;
  insertTextInPrimaryEditable?(value: string): Promise<boolean>;
  pressKey(
    key: string,
    code: string,
    modifiers?: { altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean },
  ): Promise<void>;
  subscribeActionSignal?(listener: () => void): Promise<() => void | Promise<void>>;
  subscribeVisualDirtySignal?(listener: () => void): Promise<() => void | Promise<void>>;
  captureComponentFrame?(region: ComponentSmuggleCaptureRegion): Promise<string | null>;
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
    placement: selection.placement === 'replace' || selection.placement === 'top' || selection.placement === 'bottom'
      || selection.placement === 'left' || selection.placement === 'right'
      ? selection.placement
      : 'inside',
  };
}

export function buildComponentSmuggleSourceExpression(
  anchor: ComponentSmuggleAnchor,
  visualOnly = false,
): string {
  return `(${runComponentSmuggleSource.toString()})(${JSON.stringify(anchor)}, ${visualOnly})`;
}

export function buildComponentSmuggleTargetExpression(anchor: ComponentSmuggleAnchor): string {
  return `(${runComponentSmuggleTarget.toString()})(${JSON.stringify(anchor)})`;
}

/** Serialized into the source renderer. Keep this function self-contained. */
function runComponentSmuggleSource(anchor: ComponentSmuggleAnchor, visualOnly = false) {
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
    'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
    'stroke-dasharray', 'stroke-dashoffset', 'stroke-opacity', 'paint-order', 'stop-color', 'stop-opacity',
    'mix-blend-mode', 'isolation', 'visibility', 'float', 'clear', 'table-layout', 'list-style',
  ];
  const allowedAttribute = (name: string) => (
    /^(aria-|data-)/.test(name)
    || [
      'id', 'role', 'title', 'alt', 'href', 'src', 'type', 'name', 'placeholder', 'tabindex', 'contenteditable',
      'colspan', 'rowspan', 'span', 'scope', 'headers', 'abbr',
      'xmlns', 'xmlns:xlink', 'viewbox', 'preserveaspectratio', 'd', 'fill', 'fill-rule', 'fill-opacity',
      'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-opacity',
      'clip-path', 'clip-rule', 'mask', 'filter', 'opacity', 'transform', 'vector-effect',
      'xlink:href', 'xml:space', 'width', 'height', 'x', 'y', 'x1', 'x2', 'y1', 'y2',
      'cx', 'cy', 'r', 'rx', 'ry', 'points', 'offset', 'stop-color', 'stop-opacity',
    ].includes(name)
  ) && name !== 'data-attune-smuggle-anchor' && !name.startsWith('data-attune-component-smuggle');
  const unsafeTags = new Set(['script', 'style', 'link', 'meta']);
  const visualIslandTags = new Set(['canvas', 'video', 'iframe', 'object', 'embed', 'webview']);
  const usedFontFamilies = new Set<string>();
  const recordFontFamilies = (value: unknown) => {
    for (const family of String(value || '').split(',')) {
      const normalized = family.trim().replace(/^['"]|['"]$/g, '').toLowerCase();
      if (normalized) usedFontFamilies.add(normalized);
    }
  };
  const nodeIds = new WeakMap<any, string>();
  const nodesById = new Map<string, any>();
  let nextNodeId = 1;
  const nodeIdFor = (node: any) => {
    if (!node) return '';
    let id = nodeIds.get(node);
    if (!id) {
      id = String(nextNodeId++);
      nodeIds.set(node, id);
    }
    nodesById.set(id, node);
    return id;
  };
  const pseudoSnapshot = (node: any, side: '::before' | '::after') => {
    const computed = runtime.getComputedStyle(node, side);
    recordFontFamilies(computed.fontFamily);
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
  const serializeElementState = (node: any, path: number[]) => {
    const tag = node.tagName?.toLowerCase?.() || 'div';
    if (unsafeTags.has(tag)) return null;
    const visualIsland = visualIslandTags.has(tag);
    const computed = runtime.getComputedStyle(node);
    recordFontFamilies(computed.fontFamily);
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
    const state: Record<string, unknown> = {};
    if ('value' in node && typeof node.value === 'string') state.value = node.value;
    if ('checked' in node) state.checked = Boolean(node.checked);
    if ('selectedIndex' in node) state.selectedIndex = Number(node.selectedIndex);
    if (Number(node.scrollTop)) state.scrollTop = Number(node.scrollTop);
    if (Number(node.scrollLeft)) state.scrollLeft = Number(node.scrollLeft);
    return {
      kind: 'element', nodeId: nodeIdFor(node), tag, namespace: node.namespaceURI || '', path, attributes, style, state,
      visualIsland,
      visualKind: visualIsland ? tag : undefined,
      before: pseudoSnapshot(node, '::before'),
      after: pseudoSnapshot(node, '::after'),
    };
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
      return { kind: 'text', nodeId: nodeIdFor(node), text: node.nodeValue || '', path };
    }
    if (node.nodeType !== 1 || node.closest?.('[data-attune-component-smuggle]')) return null;
    const elementState = serializeElementState(node, path);
    if (!elementState) return null;
    budget.count += 1;
    budget.elementCount += 1;
    const children = elementState.visualIsland
      ? []
      : [...(node.childNodes || [])]
        .map((child: any, index: number) => serialize(child, [...path, index], budget))
        .filter(Boolean);
    return { ...elementState, children };
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
  let patchScheduled = false;
  let satelliteRefreshRequested = false;
  let pendingOperations: any[] = [];
  let lastRootSize = { width: 0, height: 0 };
  const pendingElementRefreshes = new Map<string, any>();
  const pendingTextRefreshes = new Map<string, any>();
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
    const candidates = [...pool].filter((candidate: any) => {
      if (!candidate?.isConnected || root.contains(candidate) || candidate.contains(root) || !isVisible(candidate)) return false;
      const linked = Boolean(candidate.id && linkedIds.has(candidate.id));
      const novel = createdExternalElements.has(candidate) || !baselineVisibleOverlays.has(candidate);
      return linked || (actionRecent && novel && candidate.matches?.(overlaySelector));
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
  const collectFontFaces = () => {
    const faces: any[] = [];
    const visitRules = (rules: any, baseUrl: string) => {
      for (const rule of [...(rules || [])]) {
        if (rule.type === 5 && rule.style) {
          const family = String(rule.style.getPropertyValue('font-family') || '')
            .trim().replace(/^['"]|['"]$/g, '');
          if (!usedFontFamilies.has(family.toLowerCase())) continue;
          faces.push({
            family,
            src: String(rule.style.getPropertyValue('src') || ''),
            style: String(rule.style.getPropertyValue('font-style') || 'normal'),
            weight: String(rule.style.getPropertyValue('font-weight') || 'normal'),
            stretch: String(rule.style.getPropertyValue('font-stretch') || 'normal'),
            display: String(rule.style.getPropertyValue('font-display') || 'swap'),
            baseUrl,
          });
        } else if (rule.cssRules) {
          visitRules(rule.cssRules, baseUrl);
        }
      }
    };
    for (const sheet of [...(doc.styleSheets || [])]) {
      try { visitRules(sheet.cssRules, String(sheet.href || doc.baseURI || '')); } catch {}
    }
    return faces.slice(0, 24);
  };
  const signalVisualDirty = () => {
    if (disposed) return;
    try { runtime.__attuneNativeSmuggleVisualDirty?.(String(runtime.Date.now())); } catch {}
  };
  const pathForNode = (node: any) => {
    if (!node) return null;
    let base = root;
    let path: number[] = [];
    if (node !== root && !root?.contains?.(node)) {
      const satelliteIndex = satelliteRoots.findIndex((satellite: any) => (
        satellite === node || satellite.contains?.(node)
      ));
      if (satelliteIndex < 0) return null;
      base = satelliteRoots[satelliteIndex];
      path = [-1, satelliteIndex];
    }
    const tail: number[] = [];
    for (let current = node; current && current !== base; current = current.parentNode) {
      const parent = current.parentNode;
      if (!parent) return null;
      const index = [...(parent.childNodes || [])].indexOf(current);
      if (index < 0) return null;
      tail.unshift(index);
    }
    return [...path, ...tail];
  };
  const serializeSatellites = (budget: any, bounds: any) => {
    satelliteRoots = collectSatellites();
    return satelliteRoots.map((satellite: any, index: number) => {
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
  };
  const snapshot = () => {
    snapshotScheduled = false;
    patchScheduled = false;
    pendingOperations = [];
    pendingElementRefreshes.clear();
    pendingTextRefreshes.clear();
    satelliteRefreshRequested = false;
    if (disposed || visualOnly) return;
    if (!root?.isConnected) root = resolveAnchor();
    if (!root) return;
    const budget = { count: 0, elementCount: 0, textNodeCount: 0, textLength: 0 };
    const tree = serialize(root, [], budget);
    if (!tree) return;
    const bounds = root.getBoundingClientRect?.();
    lastRootSize = {
      width: Math.round(bounds?.width || 0),
      height: Math.round(bounds?.height || 0),
    };
    const satellites = serializeSatellites(budget, bounds);
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
        width: lastRootSize.width,
        height: lastRootSize.height,
        satelliteCount: satellites.length,
      },
    });
    signalVisualDirty();
  };
  const scheduleSnapshot = () => {
    if (snapshotScheduled || disposed || visualOnly) return;
    snapshotScheduled = true;
    const enqueue = runtime.requestAnimationFrame || ((callback: any) => runtime.setTimeout(callback, 16));
    enqueue(snapshot);
  };
  const flushPatches = () => {
    patchScheduled = false;
    if (disposed || visualOnly || snapshotScheduled) return;
    if (!root?.isConnected) {
      scheduleSnapshot();
      return;
    }
    for (const [nodeId, node] of pendingTextRefreshes) {
      if (node?.isConnected) pendingOperations.push({ type: 'text', nodeId, text: node.nodeValue || '' });
    }
    pendingTextRefreshes.clear();
    for (const node of pendingElementRefreshes.values()) {
      if (!node?.isConnected) continue;
      const path = pathForNode(node);
      if (!path) continue;
      const serialized = serializeElementState(node, path);
      if (serialized) pendingOperations.push({ type: 'element', node: serialized });
    }
    pendingElementRefreshes.clear();
    if (satelliteRefreshRequested) {
      satelliteRefreshRequested = false;
      const bounds = root.getBoundingClientRect?.();
      const budget = { count: 0, elementCount: 0, textNodeCount: 0, textLength: 0 };
      pendingOperations.push({ type: 'satellites', satellites: serializeSatellites(budget, bounds) });
    }
    if (!pendingOperations.length) return;
    version += 1;
    outbox.push({
      type: 'patch',
      version,
      acknowledgedActionRevision,
      operations: pendingOperations.splice(0),
    });
    if (outbox.length > 12) {
      scheduleSnapshot();
      return;
    }
    signalVisualDirty();
  };
  const queuePatchFlush = () => {
    if (patchScheduled || snapshotScheduled || disposed || visualOnly) return;
    patchScheduled = true;
    const enqueue = runtime.requestAnimationFrame || ((callback: any) => runtime.setTimeout(callback, 16));
    enqueue(flushPatches);
  };
  const queueOperation = (operation: any) => {
    if (!operation || disposed || visualOnly || snapshotScheduled) return;
    pendingOperations.push(operation);
    if (pendingOperations.length + pendingElementRefreshes.size + pendingTextRefreshes.size > 500) {
      pendingOperations = [];
      pendingElementRefreshes.clear();
      pendingTextRefreshes.clear();
      scheduleSnapshot();
      return;
    }
    queuePatchFlush();
  };
  const queueElementRefresh = (node: any) => {
    if (node?.nodeType !== 1) return;
    const nodeId = nodeIdFor(node);
    pendingElementRefreshes.set(nodeId, node);
    queuePatchFlush();
  };
  const queueTextRefresh = (node: any) => {
    if (node?.nodeType !== 3) return;
    const nodeId = nodeIdFor(node);
    pendingTextRefreshes.set(nodeId, node);
    queuePatchFlush();
  };
  const queueRootSize = () => {
    const bounds = root?.getBoundingClientRect?.();
    const width = Math.round(bounds?.width || 0);
    const height = Math.round(bounds?.height || 0);
    if (width === lastRootSize.width && height === lastRootSize.height) return;
    lastRootSize = { width, height };
    queueOperation({ type: 'root-size', width, height });
  };
  const queueTrackedAncestors = (node: any) => {
    let current = node?.nodeType === 1 ? node : node?.parentElement;
    let depth = 0;
    while (current && depth < 32) {
      if (!pathForNode(current)) break;
      queueElementRefresh(current);
      if (current === root || satelliteRoots.includes(current)) break;
      current = current.parentElement;
      depth += 1;
    }
  };
  const isCaptureRelevant = (node: any) => {
    const element = node?.nodeType === 1 ? node : node?.parentElement;
    if (!element || !root) return false;
    return element === root
      || root.contains?.(element)
      || satelliteRoots.some((satellite: any) => satellite === element || satellite.contains?.(element));
  };
  const observer = new runtime.MutationObserver((records: any[]) => {
    for (const record of records) {
      const actionRecent = runtime.Date.now() - lastActionAt < 10_000;
      if (actionRecent) {
        for (const node of [...(record.addedNodes || [])]) markCreatedExternal(node);
      }
      if (!root?.isConnected) {
        scheduleSnapshot();
        continue;
      }
      if (!isCaptureRelevant(record.target)) {
        const satelliteChanged = satelliteRoots.some((satellite: any) => (
          !satellite.isConnected || record.target === satellite || satellite.contains?.(record.target)
        ));
        if (record.type === 'childList' && (actionRecent || satelliteChanged)
          && (record.addedNodes?.length || record.removedNodes?.length)) {
          satelliteRefreshRequested = true;
          queuePatchFlush();
        }
        continue;
      }
      if (record.type === 'characterData') {
        queueTextRefresh(record.target);
        continue;
      }
      if (record.type === 'attributes') {
        queueElementRefresh(record.target);
        continue;
      }
      if (record.type === 'childList') {
        for (const node of [...(record.removedNodes || [])]) {
          const nodeId = nodeIds.get(node);
          if (nodeId) {
            pendingElementRefreshes.delete(nodeId);
            pendingTextRefreshes.delete(nodeId);
            queueOperation({ type: 'remove', nodeId });
          }
        }
        const addedNodes = [...(record.addedNodes || [])].reverse();
        for (const node of addedNodes) {
          const path = pathForNode(node);
          if (!path) continue;
          const budget = { count: 0, elementCount: 0, textNodeCount: 0, textLength: 0 };
          const serialized = serialize(node, path, budget);
          if (!serialized) continue;
          queueOperation({
            type: 'insert',
            parentId: nodeIdFor(record.target),
            beforeId: node.nextSibling ? nodeIdFor(node.nextSibling) : null,
            node: serialized,
          });
        }
        queueElementRefresh(record.target);
      }
    }
  });
  observer.observe(doc.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  const captureEvent = (event: any) => {
    if (!isCaptureRelevant(event?.target)) return;
    const type = String(event?.type || '');
    if (['input', 'change', 'keydown'].includes(type)) {
      lastActionAt = runtime.Date.now();
      lastActionElement = event.target?.nodeType === 1 ? event.target : event.target?.parentElement;
    }
    if (type === 'pointerover' || type === 'pointerout' || type === 'focusin' || type === 'focusout') {
      queueTrackedAncestors(event.target);
    } else if (['input', 'change', 'scroll', 'play', 'pause', 'seeking', 'seeked', 'animationstart', 'animationend',
      'animationiteration', 'transitionrun', 'transitionstart', 'transitionend'].includes(type)) {
      queueElementRefresh(event.target?.nodeType === 1 ? event.target : event.target?.parentElement);
    }
    if (type === 'play' || type === 'seeking' || type === 'animationstart' || type === 'animationiteration'
      || type === 'transitionrun' || type === 'transitionstart') signalVisualDirty();
  };
  const captureSelection = () => {};
  for (const eventName of [
    'input', 'change', 'keydown', 'scroll', 'pointermove', 'pointerover', 'pointerout', 'wheel',
    'focusin', 'focusout', 'play', 'pause', 'seeking', 'seeked',
    'animationstart', 'animationend', 'animationiteration', 'transitionrun', 'transitionstart', 'transitionend',
  ]) doc.addEventListener(eventName, captureEvent, true);
  doc.addEventListener('selectionchange', captureSelection, true);
  const captureResize = () => {
    queueRootSize();
  };
  runtime.addEventListener('resize', captureResize, true);
  const resizeObserver = typeof runtime.ResizeObserver === 'function'
    ? new runtime.ResizeObserver(queueRootSize)
    : null;
  resizeObserver?.observe?.(root);

  const nodeAtPath = (path: number[]) => {
    if (!root?.isConnected) root = resolveAnchor();
    const satellitePath = path?.[0] === -1;
    let node = satellitePath ? satelliteRoots[path[1]] : root;
    for (const index of satellitePath ? path.slice(2) : (path || [])) node = node?.childNodes?.[index];
    return node || null;
  };
  const nodeAtReference = (reference: string | number[]) => (
    typeof reference === 'string' ? nodesById.get(reference) || null : nodeAtPath(reference)
  );
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
      const node = nodeAtReference(action.nodeId || action.path);
      const element = editableFor(node);
      if (!element) continue;
      if (['input', 'change', 'keydown', 'shortcut'].includes(String(action.type || ''))) {
        lastActionAt = runtime.Date.now();
        lastActionElement = element?.nodeType === 1 ? element : element?.parentElement;
      }
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
      queueElementRefresh(element?.nodeType === 1 ? element : element?.parentElement);
    }
    return true;
  };
  const clickPoint = (
    reference: string | number[],
    position?: { xRatio?: number; yRatio?: number },
    trackAction = true,
  ) => {
    const element = nodeAtReference(reference);
    if (trackAction) {
      lastActionAt = runtime.Date.now();
      lastActionElement = element?.nodeType === 1 ? element : element?.parentElement;
    }
    const bounds = element?.getBoundingClientRect?.();
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null;
    const xRatio = Number.isFinite(position?.xRatio) ? Math.max(0, Math.min(1, Number(position?.xRatio))) : 0.5;
    const yRatio = Number.isFinite(position?.yRatio) ? Math.max(0, Math.min(1, Number(position?.yRatio))) : 0.5;
    return { x: bounds.left + bounds.width * xRatio, y: bounds.top + bounds.height * yRatio };
  };
  const captureRegionFor = (bounds: any, rootBounds = bounds, islandId?: string, visualKind?: string) => {
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
    const captureRoot = islandId === undefined ? root : null;
    const activeMedia = captureRoot
      ? [captureRoot, ...(captureRoot.querySelectorAll?.('video') || [])]
        .some((element: any) => element?.tagName?.toLowerCase?.() === 'video'
          && !element.paused && !element.ended && Number(element.readyState) >= 2)
      : visualKind === 'video';
    const animations = captureRoot && typeof captureRoot.getAnimations === 'function'
      ? captureRoot.getAnimations({ subtree: true })
      : [];
    const activeAnimations = animations.some((animation: any) => {
      if (animation?.playState !== 'running') return false;
      const target = animation.effect?.target;
      return target === root || root.contains?.(target);
    });
    return {
      x,
      y,
      width: right - x,
      height: bottom - y,
      rootWidth: rootBounds.width,
      rootHeight: rootBounds.height,
      offsetX: x - rootBounds.left,
      offsetY: y - rootBounds.top,
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
      pixelRatio: Math.max(1, Math.min(3, Number(runtime.devicePixelRatio) || 1)),
      continuousVisuals: Boolean(activeMedia || activeAnimations || visualKind === 'canvas'
        || visualKind === 'iframe' || visualKind === 'object' || visualKind === 'embed' || visualKind === 'webview'),
      nativeWindowId: Number(runtime.__attuneNativeWindowId) || undefined,
      islandId,
      visualKind,
    };
  };
  const captureRegion = () => {
    if (!root?.isConnected) root = resolveAnchor();
    const bounds = root?.getBoundingClientRect?.();
    return captureRegionFor(bounds);
  };
  const captureVisualRegions = () => {
    if (!root?.isConnected) root = resolveAnchor();
    if (!root) return [];
    const regions: any[] = [];
    const visit = (node: any, path: number[]) => {
      if (node?.nodeType !== 1 || node.closest?.('[data-attune-component-smuggle]')) return;
      const tag = node.tagName?.toLowerCase?.() || '';
      if (visualIslandTags.has(tag)) {
        const bounds = node.getBoundingClientRect?.();
        const region = captureRegionFor(bounds, bounds, nodeIdFor(node), tag);
        if (region) regions.push(region);
        return;
      }
      [...(node.childNodes || [])].forEach((child: any, index: number) => visit(child, [...path, index]));
    };
    visit(root, []);
    return regions;
  };
  const visualIslandCount = () => {
    if (!root?.isConnected) root = resolveAnchor();
    if (!root) return 0;
    const rootTag = root.tagName?.toLowerCase?.() || '';
    return (visualIslandTags.has(rootTag) ? 1 : 0)
      + [...(root.querySelectorAll?.([...visualIslandTags].join(',')) || [])].length;
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
  const editableSelector = 'textarea,input:not([type="button"]):not([type="submit"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"]):not([type="color"]):not([type="reset"]):not([type="image"]):not([type="hidden"]),[contenteditable]:not([contenteditable="false"]),[role="textbox"]';
  const deepestActiveElement = () => {
    let active = doc.activeElement;
    const visited = new Set<any>();
    while (active && !visited.has(active)) {
      visited.add(active);
      let nested = active.shadowRoot?.activeElement || null;
      if (!nested && String(active.tagName || '').toLowerCase() === 'iframe') {
        // Browser editors such as Google Docs keep their actual contenteditable
        // and EditContext host inside a focused, same-origin offscreen iframe.
        try { nested = active.contentDocument?.activeElement || null; } catch {}
      }
      if (!nested || nested === active) break;
      active = nested;
    }
    return active;
  };
  const focusEditable = (candidate: any) => {
    if (!candidate?.focus) return { ok: false };
    candidate.focus({ preventScroll: true });
    return {
      ok: true,
      tag: candidate.tagName?.toLowerCase?.() || '',
      contentEditable: Boolean(candidate.isContentEditable),
      editContext: Boolean(candidate.editContext),
      nestedDocument: candidate.ownerDocument !== doc,
      insideRoot: candidate === root || Boolean(root?.contains?.(candidate)),
    };
  };
  const visibleEditableWithin = (container: any) => (
    [container, ...(container?.querySelectorAll?.(editableSelector) || [])].find((element: any) => {
      if (!element?.matches?.(editableSelector)) return false;
      const bounds = element.getBoundingClientRect?.();
      if (!bounds || bounds.width <= 0 || bounds.height <= 0) return false;
      const computed = runtime.getComputedStyle(element);
      return computed.display !== 'none' && computed.visibility !== 'hidden';
    })
  );
  const focusEditableAt = (position?: { xRatio?: number; yRatio?: number }) => {
    if (!root?.isConnected) root = resolveAnchor();
    if (!root) return { ok: false };
    const active = deepestActiveElement();
    const actionRecent = runtime.Date.now() - lastActionAt < 2_000;
    // Some editors keep their actual textarea/contenteditable in a body-level
    // portal. A trusted click inside the selected component may therefore focus
    // an editable outside the retained root; keep that freshly focused control.
    if (actionRecent && active?.matches?.(editableSelector)) return focusEditable(active);
    const bounds = root.getBoundingClientRect?.();
    if (bounds?.width > 0 && bounds?.height > 0) {
      const xRatio = Number.isFinite(position?.xRatio) ? Math.max(0, Math.min(1, Number(position?.xRatio))) : 0.5;
      const yRatio = Number.isFinite(position?.yRatio) ? Math.max(0, Math.min(1, Number(position?.yRatio))) : 0.5;
      const hit = doc.elementFromPoint?.(bounds.left + bounds.width * xRatio, bounds.top + bounds.height * yRatio);
      const direct = hit?.matches?.(editableSelector) ? hit : hit?.closest?.(editableSelector);
      if (direct) return focusEditable(direct);
      const nested = visibleEditableWithin(hit) || visibleEditableWithin(root);
      if (nested) return focusEditable(nested);
    }
    return { ok: false };
  };
  const focusPrimaryEditable = () => {
    if (!root?.isConnected) root = resolveAnchor();
    if (!root) return { ok: false };
    const active = deepestActiveElement();
    const actionRecent = runtime.Date.now() - lastActionAt < 2_000;
    const candidate = active?.matches?.(editableSelector)
      && (active === root || root.contains(active) || actionRecent)
      ? active
      : root.matches?.(editableSelector)
        ? root
        : visibleEditableWithin(root);
    return focusEditable(candidate);
  };
  const focusActiveEditable = () => {
    const active = deepestActiveElement();
    return active?.matches?.(editableSelector) ? focusEditable(active) : { ok: false };
  };
  const focusPath = (reference: string | number[], selectionState?: any) => {
    const element = editableFor(nodeAtReference(reference));
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
    resizeObserver?.disconnect?.();
    for (const eventName of [
      'input', 'change', 'keydown', 'scroll', 'pointermove', 'pointerover', 'pointerout', 'wheel',
      'focusin', 'focusout', 'play', 'pause', 'seeking', 'seeked',
      'animationstart', 'animationend', 'animationiteration', 'transitionrun', 'transitionstart', 'transitionend',
    ]) doc.removeEventListener(eventName, captureEvent, true);
    doc.removeEventListener('selectionchange', captureSelection, true);
    runtime.removeEventListener('resize', captureResize, true);
    try { root?.removeAttribute?.('data-attune-smuggle-anchor'); } catch {}
    if (runtime.__attuneSmuggleAnchors) delete runtime.__attuneSmuggleAnchors[anchor.token];
    delete runtime.__attuneComponentSmuggleSource;
  };
  runtime.__attuneComponentSmuggleSource = {
    drain: () => outbox.splice(0),
    applyActions,
    capturePoint,
    captureRegion,
    captureVisualRegions,
    clickPoint,
    focusActiveEditable,
    focusEditableAt,
    focusPrimaryEditable,
    focusPath,
    hoverPoint,
    settleActions: async (revision: number) => {
      await Promise.resolve();
      await Promise.resolve();
      acknowledgedActionRevision = Math.max(acknowledgedActionRevision, Number(revision) || 0);
      for (const packet of outbox) packet.acknowledgedActionRevision = acknowledgedActionRevision;
      if (!visualOnly) {
        flushPatches();
      }
      return { version, acknowledgedActionRevision };
    },
    cleanup,
    status: () => ({
      connected: Boolean(root?.isConnected),
      version,
      acknowledgedActionRevision,
      outboxLength: outbox.length,
      pendingOperationCount: pendingOperations.length + pendingElementRefreshes.size + pendingTextRefreshes.size,
      syncMode: 'incremental',
      rootTag: root?.tagName?.toLowerCase?.() || '',
      visualIslandCount: visualIslandCount(),
      roles: compact(root?.getAttribute?.('data-attune-host-roles'), 300).split(/\s+/).filter(Boolean),
    }),
  };
  if (!visualOnly) snapshot();
  return {
    ok: true,
    connected: root.isConnected,
    visualIslandCount: visualIslandCount(),
    fontFaces: collectFontFaces(),
  };
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
  const placement = anchor.placement === 'replace' || anchor.placement === 'top' || anchor.placement === 'bottom'
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
    display: 'block', position: 'absolute', inset: '0', zIndex: '2', overflow: 'hidden', outline: 'none',
    pointerEvents: 'auto',
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
    position: 'fixed', left: '0', top: '0', width: '1px', height: '1px', margin: '0', padding: '0',
    border: '0', outline: '0', resize: 'none', opacity: '0', color: 'transparent',
    background: 'transparent', caretColor: 'transparent', overflow: 'hidden', pointerEvents: 'none',
  });
  visualViewport.appendChild(visualImage);
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
  portalSurface.append(visualInput, resizeLayer);
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
  const replacing = placement === 'replace';
  const layoutAttribute = 'data-attune-component-smuggle-layout';
  const layoutStyle = doc.createElement('style');
  layoutStyle.setAttribute('data-attune-component-smuggle', 'layout');
  (doc.head || doc.documentElement).appendChild(layoutStyle);
  const fontStyle = doc.createElement('style');
  fontStyle.setAttribute('data-attune-component-smuggle', 'fonts');
  (doc.head || doc.documentElement).appendChild(fontStyle);
  const installFontFaces = (css: unknown) => {
    fontStyle.textContent = String(css || '').slice(0, 12_000_000);
    return { ok: true, bytes: fontStyle.textContent.length };
  };
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
  const prepareReplacementMount = (element: any) => {
    if (!replacing || !element || decoratedMount === element) return;
    releaseContainedMount();
    decoratedMount = element;
    element.setAttribute(layoutAttribute, anchor.token);
    const selector = `[${layoutAttribute}=${JSON.stringify(anchor.token)}]`;
    layoutStyle.textContent = `${selector}{display:none!important;}`;
    Object.assign(host.style, {
      position: 'relative', left: '', right: '', top: '', bottom: '',
      margin: '0', zIndex: '1', flex: '0 0 auto', alignSelf: 'flex-start',
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
    const container = replacing || voidTags.has(mount.tagName?.toLowerCase?.()) ? mount.parentElement : mount;
    if (!container) return false;
    if (replacing) {
      prepareReplacementMount(mount);
      if (host.parentElement !== container || host.nextSibling !== mount) container.insertBefore(host, mount);
    } else if (placement === 'left' || placement === 'top') {
      prepareContainedMount(container);
      if (host.parentElement !== container || host !== container.firstChild) container.insertBefore(host, container.firstChild);
    } else if (host.parentElement !== container) {
      prepareContainedMount(container);
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
    actions.push({ ...action, revision, queuedAt: runtime.Date.now() });
    try { runtime.__attuneNativeSmuggleActionAvailable?.(String(revision)); } catch {}
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
  const enqueueDomHover = (action: any) => {
    const previous = actions[actions.length - 1];
    if (previous?.type === 'hover') {
      previous.path = action.path;
      previous.nodeId = action.nodeId;
      previous.position = action.position;
      previous.trusted = action.trusted;
      return;
    }
    enqueueAction({ type: 'hover', ...action });
  };
  const enqueueDomWheel = (action: any) => {
    const previous = actions[actions.length - 1];
    if (previous?.type === 'wheel'
      && (previous.nodeId ? previous.nodeId === action.nodeId : JSON.stringify(previous.path) === JSON.stringify(action.path))
      && previous.altKey === action.altKey
      && previous.ctrlKey === action.ctrlKey
      && previous.metaKey === action.metaKey
      && previous.shiftKey === action.shiftKey) {
      previous.position = action.position;
      previous.nodeId = action.nodeId;
      previous.deltaX += action.deltaX;
      previous.deltaY += action.deltaY;
      previous.trusted = action.trusted;
      return;
    }
    enqueueAction({ type: 'wheel', ...action });
  };
  let visualRelayFocusGeneration = 0;
  let visualRelayArmed = false;
  let visualRelayFocusTimer: any = null;
  const visualRelayActiveAttribute = 'data-attune-smuggle-input-active';
  const visualRelayFocused = () => (
    doc.activeElement === portalHost && portalShadow.activeElement === visualInput
  );
  const releaseVisualRelay = () => {
    visualRelayArmed = false;
    visualRelayFocusGeneration += 1;
    if (visualRelayFocusTimer !== null) runtime.clearTimeout(visualRelayFocusTimer);
    visualRelayFocusTimer = null;
    doc.documentElement.removeAttribute(visualRelayActiveAttribute);
  };
  const keepVisualRelayFocus = () => {
    visualRelayFocusTimer = null;
    if (!visualRelayArmed || disposed || closing) return;
    if (!visualRelayFocused()) visualInput.focus({ preventScroll: true });
    visualRelayFocusTimer = runtime.setTimeout(keepVisualRelayFocus, 32);
  };
  const focusVisualRelay = () => {
    visualRelayArmed = true;
    doc.documentElement.setAttribute(visualRelayActiveAttribute, 'true');
    const generation = ++visualRelayFocusGeneration;
    const restore = () => {
      if (disposed || closing || !visualRelayArmed || generation !== visualRelayFocusGeneration) return;
      visualInput.focus({ preventScroll: true });
    };
    restore();
    runtime.queueMicrotask(restore);
    runtime.requestAnimationFrame(restore);
    if (visualRelayFocusTimer === null) {
      visualRelayFocusTimer = runtime.setTimeout(keepVisualRelayFocus, 0);
    }
  };
  const captureVisualRelayPointer = (event: any) => {
    const path = event.composedPath?.() || [];
    if (path.includes(visualViewport) || path.includes(visualInput)) return;
    releaseVisualRelay();
  };
  const guardVisualRelayFocus = (event: any) => {
    if (!visualRelayArmed) return;
    const path = event.composedPath?.() || [];
    if (path.includes(visualInput)) return;
    // Destination apps commonly restore their composer after pointerdown or a
    // render commit. While a remote-input session is armed, that programmatic
    // focus belongs to the smuggled surface instead of the outer application.
    event.stopImmediatePropagation?.();
    focusVisualRelay();
  };
  const captureVisualKeydown = (event: any) => {
    if (!visualRelayArmed && !visualRelayFocused()) return;
    event.stopImmediatePropagation();
    focusVisualRelay();
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
  };
  const captureVisualBeforeInput = (event: any) => {
    if (!visualRelayArmed && !visualRelayFocused()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    enqueueAction({
      type: 'visual-edit', inputType: event.inputType, data: typeof event.data === 'string' ? event.data : null,
      trusted: event.isTrusted, composing: Boolean(event.isComposing),
    });
    visualInput.value = '';
    focusVisualRelay();
  };
  runtime.addEventListener('pointerdown', captureVisualRelayPointer, true);
  runtime.addEventListener('focusin', guardVisualRelayFocus, true);
  runtime.addEventListener('keydown', captureVisualKeydown, true);
  runtime.addEventListener('beforeinput', captureVisualBeforeInput, true);
  visualInput.addEventListener('blur', () => {
    if (visualRelayArmed) runtime.queueMicrotask(focusVisualRelay);
  });
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
    event.stopImmediatePropagation();
    focusVisualRelay();
    const position = visualPosition(event);
    if (!position) return;
    enqueueAction({
      type: 'visual-click',
      trusted: event.isTrusted,
      position,
      clickCount: Math.max(1, Number(event.detail) || 1),
    });
  }, true);
  for (const eventName of ['pointerup', 'click']) visualViewport.addEventListener(eventName, (event: any) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    focusVisualRelay();
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
  const nodeIdFromEvent = (event: any) => (
    pathElementFromEvent(event)?.getAttribute?.('data-attune-smuggle-node-id') || null
  );
  const isRuntimeDecoration = (node: any) => node?.nodeType === 1 && (
    node.hasAttribute?.('data-attune-smuggle-pseudo')
    || node.hasAttribute?.('data-attune-smuggle-visual-frame')
  );
  const logicalChildren = (node: any) => [...(node?.childNodes || [])]
    .filter((child: any) => !isRuntimeDecoration(child));
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
    if ((event.composedPath?.() || []).includes(visualViewport)) return;
    if (event.type === 'pointerleave') {
      enqueueDomHover({ path: null, position: null, trusted: event.isTrusted });
      return;
    }
    const path = pathFromEvent(event);
    if (!path) return;
    const nodeId = nodeIdFromEvent(event);
    const pathKey = nodeId || path.join('.');
    const eventTarget = event.target?.nodeType === 1 ? event.target : event.target?.parentElement;
    const editableSelector = 'textarea,input:not([type="button"]):not([type="submit"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"]):not([type="color"]):not([type="reset"]):not([type="image"]):not([type="hidden"]),select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]';
    let editable = eventTarget?.closest?.(editableSelector);
    if (!editable && event.isTrusted && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
      const interactionRoot = (event.composedPath?.() || []).includes(portalSurface) ? portalSurface : surface;
      editable = [...interactionRoot.querySelectorAll(editableSelector)]
        .filter((candidate: any) => {
          const bounds = candidate.getBoundingClientRect?.();
          if (!bounds || bounds.width <= 0 || bounds.height <= 0) return false;
          return event.clientX >= bounds.left && event.clientX <= bounds.right
            && event.clientY >= bounds.top && event.clientY <= bounds.bottom;
        })
        .sort((left: any, right: any) => {
          const leftBounds = left.getBoundingClientRect();
          const rightBounds = right.getBoundingClientRect();
          return leftBounds.width * leftBounds.height - rightBounds.width * rightBounds.height;
        })[0] || null;
    }
    if (event.type === 'pointermove' || event.type === 'wheel') {
      const pathElement = pathElementFromEvent(event);
      const bounds = pathElement?.getBoundingClientRect?.();
      if (!bounds?.width || !bounds?.height) return;
      const position = {
        xRatio: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
        yRatio: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
      };
      if (event.type === 'pointermove') {
        enqueueDomHover({ path, nodeId, position, trusted: event.isTrusted });
      } else {
        event.preventDefault();
        event.stopPropagation();
        const deltaScale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? Math.max(1, bounds.height) : 1;
        enqueueDomWheel({
          path,
          nodeId,
          position,
          deltaX: Number(event.deltaX || 0) * deltaScale,
          deltaY: Number(event.deltaY || 0) * deltaScale,
          altKey: event.altKey,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
          trusted: event.isTrusted,
        });
      }
      return;
    }
    if (event.type === 'beforeinput') {
      const selectionBefore = selectionFor(editable);
      beforeInputSelections.set(pathKey, selectionBefore);
      const inputType = String(event.inputType || '');
      const insertion = inputType.startsWith('insert')
        && inputType !== 'insertCompositionText'
        && !event.isComposing
        && typeof event.data === 'string'
        && event.data.length > 0;
      const directEdit = insertion
        || inputType === 'insertParagraph'
        || inputType === 'insertLineBreak'
        || inputType === 'deleteContentBackward'
        || inputType === 'deleteContentForward';
      if (editable && event.isTrusted && directEdit) {
        // Do not wait for the cloned control's `input` event. A source patch can
        // refresh the interaction twin between beforeinput and input, leaving
        // the latter attached to a stale node and making typing appear to lose
        // focus. Forward the native edit immediately and let the source stream
        // bring the authoritative value back to the twin.
        event.preventDefault();
        event.stopPropagation();
        const editablePathAttribute = editable.getAttribute?.('data-attune-smuggle-path');
        const editablePath = editablePathAttribute === ''
          ? []
          : editablePathAttribute?.split('.').map((part: string) => Number(part));
        enqueueAction({
          type: 'input',
          path: editablePath || path,
          nodeId: editable.getAttribute?.('data-attune-smuggle-node-id') || nodeId,
          value: editable.value,
          checked: editable.checked,
          contentEditable: Boolean(editable.isContentEditable),
          html: editableHtml(editable),
          inputType,
          data: event.data,
          trusted: true,
          selectionBefore,
          selectionAfter: selectionBefore,
        });
        beforeInputSelections.delete(pathKey);
      }
      return;
    }
    if (event.type === 'click') {
      if (!editable) event.preventDefault();
      event.stopPropagation();
      if (editable?.focus) {
        editable.focus({ preventScroll: true });
        if (typeof editable.setSelectionRange === 'function' && typeof editable.value === 'string') {
          const caret = editable.value.length;
          try { editable.setSelectionRange(caret, caret); } catch {}
        }
        runtime.queueMicrotask(() => editable?.isConnected && editable.focus({ preventScroll: true }));
        runtime.requestAnimationFrame(() => editable?.isConnected && editable.focus({ preventScroll: true }));
      }
      const pathElement = pathElementFromEvent(event);
      const bounds = pathElement?.getBoundingClientRect?.();
      const hasPointerPosition = event.isTrusted && bounds?.width > 0 && bounds?.height > 0;
      enqueueAction({
        type: 'click', path, nodeId, trusted: event.isTrusted, editable: Boolean(editable),
        editablePath: editable?.getAttribute?.('data-attune-smuggle-path') === ''
          ? []
          : editable?.getAttribute?.('data-attune-smuggle-path')?.split('.')
            .map((part: string) => Number(part)),
        editableNodeId: editable?.getAttribute?.('data-attune-smuggle-node-id') || null,
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
        nodeId,
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
          type: 'shortcut', path, nodeId, key: event.key, code: event.code, trusted: event.isTrusted,
          editable: true, selectionBefore: selectionFor(editable),
          altKey: event.altKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey,
          repeat: event.repeat,
        });
      } else {
        enqueueAction({
          type: 'keydown', path, nodeId, key: event.key, code: event.code, trusted: event.isTrusted,
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
  surface.addEventListener('pointermove', captureAction, true);
  surface.addEventListener('pointerleave', captureAction, true);
  surface.addEventListener('wheel', captureAction, { capture: true, passive: false });
  portalSurface.addEventListener('click', captureAction, true);
  portalSurface.addEventListener('beforeinput', captureAction, true);
  portalSurface.addEventListener('input', captureAction, true);
  portalSurface.addEventListener('change', captureAction, true);
  portalSurface.addEventListener('keydown', captureAction, true);
  portalSurface.addEventListener('pointermove', captureAction, true);
  portalSurface.addEventListener('wheel', captureAction, { capture: true, passive: false });
  const requestClose = (trusted = false) => {
    if (closing) return false;
    closing = true;
    releaseVisualRelay();
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

  const nodeIndex = new Map<string, any>();
  const assignNodeId = (node: any, serialized: any) => {
    const nodeId = String(serialized?.nodeId || '');
    if (!nodeId || !node) return;
    node.__attuneSmuggleNodeId = nodeId;
    if (node.nodeType === 1) node.setAttribute('data-attune-smuggle-node-id', nodeId);
    nodeIndex.set(nodeId, node);
  };
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
  const createNode = (serialized: any): any => {
    if (!serialized) return null;
    if (serialized.kind === 'text') {
      const textNode = doc.createTextNode(serialized.text || '');
      assignNodeId(textNode, serialized);
      return textNode;
    }
    const element = !serialized.visualIsland && serialized.namespace === 'http://www.w3.org/2000/svg'
      ? doc.createElementNS(serialized.namespace, serialized.tag)
      : doc.createElement(serialized.visualIsland ? 'div' : serialized.tag || 'div');
    for (const [name, value] of Object.entries(serialized.attributes || {})) {
      try {
        if (name === 'xlink:href') element.setAttributeNS('http://www.w3.org/1999/xlink', name, String(value));
        else if (name === 'xml:space') element.setAttributeNS('http://www.w3.org/XML/1998/namespace', name, String(value));
        else element.setAttribute(name, String(value));
      } catch {}
    }
    element.setAttribute('data-attune-smuggle-path', (serialized.path || []).join('.'));
    assignNodeId(element, serialized);
    if (serialized.visualIsland) {
      element.setAttribute('data-attune-smuggle-visual-island', String(serialized.nodeId || ''));
      element.setAttribute('data-attune-smuggle-visual-kind', serialized.visualKind || 'visual');
    }
    for (const [property, value] of Object.entries(serialized.style || {})) {
      try { element.style.setProperty(property, String(value)); } catch {}
    }
    if (serialized.visualIsland) {
      if (element.style.position === 'static' || !element.style.position) element.style.position = 'relative';
      if (element.style.display === 'inline') element.style.display = 'inline-block';
      element.style.overflow = 'hidden';
    }
    if ((serialized.path || []).length === 0 && ['fixed', 'absolute'].includes(element.style.position)) {
      element.style.position = 'relative';
      element.style.inset = 'auto';
    }
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
      if ('scrollTop' in serialized.state) element.scrollTop = Number(serialized.state.scrollTop) || 0;
      if ('scrollLeft' in serialized.state) element.scrollLeft = Number(serialized.state.scrollLeft) || 0;
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
    currentFrame.style.opacity = currentVisualFrame ? '0' : '1';
    // A native source frame behaves like a component-sized remote desktop:
    // pixels receive raw pointer/keyboard input and the DOM twin is passive
    // metadata. DOM and hybrid modes continue using the synchronized tree.
    currentFrame.style.pointerEvents = currentVisualFrame ? 'none' : 'auto';
    visualViewport.style.pointerEvents = currentVisualFrame ? 'auto' : 'none';
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
    currentSourceSize = {
      width: Number(frame.rootWidth || frame.width) || 0,
      height: Number(frame.rootHeight || frame.height) || 0,
    };
    if (visualViewport.parentElement !== surface) surface.appendChild(visualViewport);
    if (currentFrame?.isConnected) {
      currentFrame.style.opacity = '0';
      currentFrame.style.pointerEvents = 'none';
    }
    visualViewport.style.pointerEvents = 'auto';
    const visualMimeType = String(frame.data).startsWith('/9j/')
      ? 'image/jpeg'
      : String(frame.data).startsWith('UklG') ? 'image/webp' : 'image/png';
    visualImage.style.display = 'block';
    visualImage.src = `data:${visualMimeType};base64,${frame.data}`;
    fitVisual();
    return true;
  };
  const visualIslandFrames = new Map<string, any>();
  const visualMimeType = (data: string) => String(data).startsWith('/9j/')
    ? 'image/jpeg'
    : String(data).startsWith('UklG') ? 'image/webp' : 'image/png';
  const renderVisualIsland = (frame: any) => {
    const islandId = String(frame?.islandId ?? '');
    if (!frame?.data) return false;
    const escaped = runtime.CSS?.escape ? runtime.CSS.escape(islandId) : islandId.replace(/"/g, '\\"');
    const island = surface.querySelector(`[data-attune-smuggle-visual-island="${escaped}"]`);
    if (!island) return false;
    let image = island.querySelector(':scope > [data-attune-smuggle-visual-frame]');
    if (!image) {
      image = doc.createElement('img');
      image.alt = '';
      image.draggable = false;
      image.setAttribute('aria-hidden', 'true');
      image.setAttribute('data-attune-smuggle-visual-frame', islandId);
      Object.assign(image.style, {
        position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block',
        margin: '0', border: '0', objectFit: 'fill', pointerEvents: 'none', userSelect: 'none',
      });
      island.appendChild(image);
    }
    image.src = `data:${visualMimeType(frame.data)};base64,${frame.data}`;
    return true;
  };
  const applyVisualIsland = (frame: any) => {
    if (disposed || !frame?.data || frame.islandId === undefined) return false;
    const islandId = String(frame.islandId);
    const previous = visualIslandFrames.get(islandId);
    if (previous && Number(frame.sequence) <= Number(previous.sequence)) return false;
    visualIslandFrames.set(islandId, frame);
    appendHost();
    return renderVisualIsland(frame);
  };
  const restoreVisualIslands = () => {
    for (const frame of visualIslandFrames.values()) renderVisualIsland(frame);
  };
  const captureFocus = () => {
    const active = shadow.activeElement;
    if (!active || !surface.contains(active)) return null;
    const path = active.getAttribute?.('data-attune-smuggle-path');
    if (path === null || path === undefined) return null;
    return {
      path,
      nodeId: active.getAttribute?.('data-attune-smuggle-node-id') || null,
      selection: selectionFor(active),
    };
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
    const active = (state.nodeId && nodeIndex.get(String(state.nodeId)))
      || surface.querySelector(`[data-attune-smuggle-path="${escaped}"]`);
    if (!active?.focus) return;
    active.focus({ preventScroll: true });
    restoreSelection(active, state.selection);
  };
  const unregisterTree = (node: any) => {
    if (!node) return;
    const nodeId = String(node.__attuneSmuggleNodeId || '');
    if (nodeId && nodeIndex.get(nodeId) === node) nodeIndex.delete(nodeId);
    for (const child of logicalChildren(node)) unregisterTree(child);
  };
  const updatePseudo = (element: any, pseudo: any, side: '::before' | '::after') => {
    const existing = [...element.children].find((child: any) => child.getAttribute?.('data-attune-smuggle-pseudo') === side);
    if (!pseudo) {
      existing?.remove?.();
      return;
    }
    const next = createPseudo(pseudo);
    if (!next) return;
    if (existing) existing.replaceWith(next);
    else if (side === '::before') element.insertBefore(next, element.firstChild);
    else element.appendChild(next);
  };
  const applyElementState = (element: any, serialized: any) => {
    if (!element || element.nodeType !== 1 || !serialized) return false;
    const runtimeAttributes = new Set([
      'data-attune-smuggle-node-id', 'data-attune-smuggle-path',
      'data-attune-smuggle-visual-island', 'data-attune-smuggle-visual-kind',
    ]);
    for (const name of element.getAttributeNames?.() || []) {
      if (!runtimeAttributes.has(name) && !(name in (serialized.attributes || {}))) element.removeAttribute(name);
    }
    for (const [name, value] of Object.entries(serialized.attributes || {})) {
      try {
        if (name === 'xlink:href') element.setAttributeNS('http://www.w3.org/1999/xlink', name, String(value));
        else if (name === 'xml:space') element.setAttributeNS('http://www.w3.org/XML/1998/namespace', name, String(value));
        else if (element.getAttribute(name) !== String(value)) element.setAttribute(name, String(value));
      } catch {}
    }
    element.setAttribute('data-attune-smuggle-path', (serialized.path || []).join('.'));
    assignNodeId(element, serialized);
    if (serialized.visualIsland) {
      element.setAttribute('data-attune-smuggle-visual-island', String(serialized.nodeId || ''));
      element.setAttribute('data-attune-smuggle-visual-kind', serialized.visualKind || 'visual');
    } else {
      element.removeAttribute('data-attune-smuggle-visual-island');
      element.removeAttribute('data-attune-smuggle-visual-kind');
    }
    const nextStyle = serialized.style || {};
    for (const property of [...element.style]) {
      if (!(property in nextStyle)) element.style.removeProperty(property);
    }
    for (const [property, value] of Object.entries(nextStyle)) {
      if (element.style.getPropertyValue(property) !== String(value)) {
        try { element.style.setProperty(property, String(value)); } catch {}
      }
    }
    if (serialized.visualIsland) {
      if (element.style.position === 'static' || !element.style.position) element.style.position = 'relative';
      if (element.style.display === 'inline') element.style.display = 'inline-block';
      element.style.overflow = 'hidden';
    }
    if ((serialized.path || []).length === 0 && ['fixed', 'absolute'].includes(element.style.position)) {
      element.style.position = 'relative';
      element.style.inset = 'auto';
    }
    const state = serialized.state || {};
    if ('value' in state && 'value' in element && element.value !== state.value) element.value = state.value;
    if ('checked' in state && 'checked' in element && element.checked !== state.checked) element.checked = state.checked;
    if ('selectedIndex' in state && 'selectedIndex' in element && element.selectedIndex !== state.selectedIndex) {
      element.selectedIndex = state.selectedIndex;
    }
    if ('scrollTop' in state && element.scrollTop !== Number(state.scrollTop)) element.scrollTop = Number(state.scrollTop) || 0;
    if ('scrollLeft' in state && element.scrollLeft !== Number(state.scrollLeft)) element.scrollLeft = Number(state.scrollLeft) || 0;
    updatePseudo(element, serialized.before, '::before');
    updatePseudo(element, serialized.after, '::after');
    return true;
  };
  const apply = (packets: any[]) => {
    if (disposed) return false;
    appendHost();
    for (const packet of packets || []) {
      if (!['snapshot', 'patch'].includes(packet.type) || packet.version <= lastVersion) continue;
      const acknowledgedRevision = Number(packet.acknowledgedActionRevision) || 0;
      if (acknowledgedRevision < latestActionRevision) continue;
      const focusState = captureFocus();
      if (packet.type === 'snapshot') {
        nodeIndex.clear();
        const next = createNode(packet.tree);
        if (!next) continue;
        if (!currentFrame?.isConnected) {
          const frame = doc.createElement('div');
          frame.setAttribute('data-attune-component-smuggle', 'frame');
          Object.assign(frame.style, { display: 'block', position: 'relative', transformOrigin: 'top left' });
          frame.appendChild(next);
          if (visualViewport.parentElement === surface) surface.insertBefore(frame, visualViewport);
          else surface.appendChild(frame);
          currentFrame = frame;
        } else {
          currentFrame.replaceChildren(next);
        }
        const renderedRoot = currentFrame.firstElementChild;
        currentSourceSize = {
          width: Number(packet.diagnostics?.width) || renderedRoot?.scrollWidth || 0,
          height: Number(packet.diagnostics?.height) || renderedRoot?.scrollHeight || 0,
        };
        renderSatellites(packet.satellites || []);
      } else {
        for (const operation of packet.operations || []) {
          if (operation.type === 'text') {
            const node = nodeIndex.get(String(operation.nodeId || ''));
            if (node?.nodeType === 3 && node.nodeValue !== operation.text) node.nodeValue = operation.text || '';
          } else if (operation.type === 'element') {
            applyElementState(nodeIndex.get(String(operation.node?.nodeId || '')), operation.node);
          } else if (operation.type === 'remove') {
            const node = nodeIndex.get(String(operation.nodeId || ''));
            if (node) {
              unregisterTree(node);
              node.remove?.();
              visualIslandFrames.delete(String(operation.nodeId || ''));
            }
          } else if (operation.type === 'insert') {
            const parent = nodeIndex.get(String(operation.parentId || ''));
            if (!parent) continue;
            const next = createNode(operation.node);
            if (!next) continue;
            const before = operation.beforeId ? nodeIndex.get(String(operation.beforeId)) : null;
            parent.insertBefore(next, before?.parentNode === parent ? before : null);
          } else if (operation.type === 'satellites') {
            for (const satellite of currentSatellites) unregisterTree(satellite.wrapper);
            renderSatellites(operation.satellites || []);
          } else if (operation.type === 'root-size') {
            currentSourceSize = {
              width: Number(operation.width) || currentSourceSize.width,
              height: Number(operation.height) || currentSourceSize.height,
            };
          }
        }
      }
      fitSurface();
      restoreVisualIslands();
      restoreFocus(focusState);
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
    runtime.removeEventListener('pointerdown', captureVisualRelayPointer, true);
    runtime.removeEventListener('focusin', guardVisualRelayFocus, true);
    runtime.removeEventListener('keydown', captureVisualKeydown, true);
    runtime.removeEventListener('beforeinput', captureVisualBeforeInput, true);
    releaseVisualRelay();
    host.remove();
    portalHost.remove();
    releaseContainedMount();
    layoutStyle.remove();
    fontStyle.remove();
    try { mount?.removeAttribute?.('data-attune-smuggle-anchor'); } catch {}
    if (runtime.__attuneSmuggleAnchors) delete runtime.__attuneSmuggleAnchors[anchor.token];
    delete runtime.__attuneComponentSmuggleTarget;
  };
  runtime.__attuneComponentSmuggleTarget = {
    apply,
    applyVisual,
    applyVisualIsland,
    installFontFaces,
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
      rendering: currentVisualFrame ? 'source-capture' : visualIslandFrames.size ? 'hybrid' : 'dom-twin',
      visualIslandCount: visualIslandFrames.size,
      visualSequence: currentVisualSequence,
      sourceSize: sourceSize(),
      viewSize: viewSize(),
      viewOffset: { ...customViewOffset },
      customSize: Boolean(customViewSize),
      resizing: Boolean(resizeState),
      closing,
      remoteInputActive: visualRelayArmed,
      remoteInputFocused: visualRelayFocused(),
      placement,
      placementLayout: replacing ? 'replace' : contained ? 'contained' : 'inside',
      mountTag: mount?.tagName?.toLowerCase?.() || '',
      roles: compact(mount?.getAttribute?.('data-attune-host-roles'), 300).split(/\s+/).filter(Boolean),
    }),
  };
  return { ok: true, connected: host.isConnected, placement };
}

type CdpResponse = {
  id?: number;
  method?: string;
  params?: { name?: string; payload?: string };
  result?: { result?: { value?: unknown; description?: string }; data?: string; [key: string]: unknown };
  error?: { message?: string };
};

type WebSocketLike = {
  addEventListener(type: string, listener: (event: any) => void, options?: { once?: boolean }): void;
  send(message: string): void;
  close(): void;
};

export class CdpPageClient implements ComponentSmugglePageClient {
  private static readonly actionBindingName = '__attuneNativeSmuggleActionAvailable';
  private static readonly visualDirtyBindingName = '__attuneNativeSmuggleVisualDirty';
  private socket: WebSocketLike | null = null;
  private nextId = 1;
  private actionSignalListener: (() => void) | null = null;
  private visualDirtySignalListener: (() => void) | null = null;
  private pageCaptureEnabled = false;
  private readonly pending = new Map<number, {
    resolve(value: CdpResponse['result']): void;
    reject(error: Error): void;
    timer: NodeJS.Timeout;
  }>();

  constructor(
    private readonly url: string,
    private readonly label: string,
    private readonly executionContextId?: number,
  ) {}

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
      if (message.method === 'Runtime.bindingCalled'
        && message.params?.name === CdpPageClient.actionBindingName) {
        this.actionSignalListener?.();
        return;
      }
      if (message.method === 'Runtime.bindingCalled'
        && message.params?.name === CdpPageClient.visualDirtyBindingName) {
        this.visualDirtySignalListener?.();
        return;
      }
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
      ...(this.executionContextId ? { contextId: this.executionContextId } : {}),
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

  async subscribeActionSignal(listener: () => void): Promise<() => Promise<void>> {
    this.actionSignalListener = listener;
    await this.send('Runtime.enable');
    await this.send('Runtime.addBinding', { name: CdpPageClient.actionBindingName });
    return async () => {
      this.actionSignalListener = null;
      try {
        await this.send('Runtime.removeBinding', { name: CdpPageClient.actionBindingName }, 2000);
      } catch {}
    };
  }

  async subscribeVisualDirtySignal(listener: () => void): Promise<() => Promise<void>> {
    this.visualDirtySignalListener = listener;
    await this.send('Runtime.enable');
    await this.send('Runtime.addBinding', { name: CdpPageClient.visualDirtyBindingName });
    return async () => {
      this.visualDirtySignalListener = null;
      try {
        await this.send('Runtime.removeBinding', { name: CdpPageClient.visualDirtyBindingName }, 2000);
      } catch {}
    };
  }

  async captureComponentFrame(region: ComponentSmuggleCaptureRegion): Promise<string | null> {
    if (!this.pageCaptureEnabled) {
      await this.send('Page.enable');
      this.pageCaptureEnabled = true;
    }
    const result = await this.send('Page.captureScreenshot', {
      format: 'jpeg',
      quality: 88,
      fromSurface: true,
      captureBeyondViewport: false,
      clip: {
        x: Number(region.x),
        y: Number(region.y),
        width: Number(region.width),
        height: Number(region.height),
        scale: Math.max(1, Math.min(3, Number(region.pixelRatio) || 1)),
      },
    });
    return typeof result?.data === 'string' && result.data ? result.data : null;
  }

  close(): void {
    this.actionSignalListener = null;
    this.visualDirtySignalListener = null;
    this.pageCaptureEnabled = false;
    this.socket?.close();
    this.socket = null;
  }
}

export class ComponentSmuggleBridge {
  private readonly sourceClient: ComponentSmugglePageClient;
  private readonly sourceVisualClient: ComponentSmugglePageClient;
  private readonly targetClient: ComponentSmugglePageClient;
  private readonly targetVisualClient: ComponentSmugglePageClient;
  private timer: NodeJS.Timeout | null = null;
  private pumping = false;
  private pumpRequested = false;
  private stopped = false;
  private firstSnapshotLogged = false;
  private lastSatelliteCount = -1;
  private lastRuntimeCheckAt = 0;
  private runtimeMaintenanceRunning = false;
  private visualSequence = 0;
  private visualFrameApplying = false;
  private pendingVisualFrame: { data: string; region: ComponentSmuggleCaptureRegion } | null = null;
  private visualCaptureKey = '';
  private visualCaptureGeneration = 0;
  private stopVisualFrameStream: (() => void | Promise<void>) | null = null;
  private stopActionSignal: (() => void | Promise<void>) | null = null;
  private stopVisualDirtySignal: (() => void | Promise<void>) | null = null;
  private adaptiveCaptureRunning = false;
  private adaptiveCaptureRequested = false;
  private adaptiveCaptureDisabled = false;
  private nativeStreamDisabled = false;
  private lastAdaptiveFrame = '';
  private lastAdaptiveRegionKey = '';
  private adaptiveCaptureAttempts = 0;
  private adaptiveFramesSkipped = 0;
  private visualFramesReceived = 0;
  private visualFramesApplied = 0;
  private visualBytesReceived = 0;
  private visualFramesDropped = 0;
  private visualStatsStartedAt = 0;
  private lastVisualStatsAt = 0;
  private lastVisualInteractionPosition: { xRatio?: number; yRatio?: number } | null = null;
  private readonly adaptiveCaptureEnabled: boolean;
  private renderMode: 'dom-twin' | 'hybrid' | 'visual' = 'dom-twin';
  private hybridCaptureRunning = false;
  private hybridCaptureRequested = false;
  private readonly hybridFrames = new Map<string, string>();

  constructor(
    readonly source: ComponentSmuggleEndpoint,
    readonly target: ComponentSmuggleEndpoint,
    private readonly onStop?: (reason: 'closed' | 'error', error?: Error) => void,
    private readonly forwardKeyChord?: ComponentSmuggleKeyForwarder,
    private readonly startFrameStream?: ComponentSmuggleFrameStreamStarter,
    pageClients: {
      source?: ComponentSmugglePageClient;
      sourceVisual?: ComponentSmugglePageClient;
      target?: ComponentSmugglePageClient;
      targetVisual?: ComponentSmugglePageClient;
      adaptiveCapture?: boolean;
    } = {},
  ) {
    this.adaptiveCaptureEnabled = pageClients.adaptiveCapture !== false;
    const hasVisualStream = Boolean(startFrameStream);
    this.sourceClient = pageClients.source
      ?? new CdpPageClient(source.webSocketDebuggerUrl, `${source.appName} source`);
    this.sourceVisualClient = pageClients.sourceVisual
      ?? (hasVisualStream && !pageClients.source
        ? new CdpPageClient(source.webSocketDebuggerUrl, `${source.appName} source visual`)
        : this.sourceClient);
    this.targetClient = pageClients.target
      ?? new CdpPageClient(target.webSocketDebuggerUrl, `${target.appName} target`);
    // Image payloads are large enough to head-of-line block tiny input/control
    // commands on a shared CDP socket. Production visual mode gets a dedicated
    // connection; injected test clients continue sharing unless they opt in.
    this.targetVisualClient = pageClients.targetVisual
      ?? (hasVisualStream && !pageClients.target
        ? new CdpPageClient(target.webSocketDebuggerUrl, `${target.appName} target visual`)
        : this.targetClient);
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
    await Promise.all([...new Set([
      this.sourceClient,
      this.sourceVisualClient,
      this.targetClient,
      this.targetVisualClient,
    ])].map((client) => client.connect()));
    let [sourceResult, targetResult] = await Promise.all([
      this.sourceClient.evaluate(buildComponentSmuggleSourceExpression(
        this.source.anchor,
        false,
      )),
      this.targetClient.evaluate(buildComponentSmuggleTargetExpression(this.target.anchor)),
    ]);
    if (!sourceResult?.ok) throw new Error(`Could not resolve the source component: ${sourceResult?.reason || 'unknown error'}`);
    if (!targetResult?.ok) throw new Error(`Could not resolve the destination: ${targetResult?.reason || 'unknown error'}`);
    const visualIslandCount = Math.max(0, Number(sourceResult.visualIslandCount) || 0);
    this.renderMode = this.renderModeFor(visualIslandCount);
    await this.installSourceFonts(sourceResult);
    this.log('installed', {
      sourceConnected: sourceResult.connected,
      targetConnected: targetResult.connected,
      renderMode: this.renderMode,
      visualIslandCount,
    });
    if (this.targetClient.subscribeActionSignal) {
      this.stopActionSignal = await this.targetClient.subscribeActionSignal(() => this.requestPump());
    }
    if (this.sourceClient.subscribeVisualDirtySignal) {
      this.stopVisualDirtySignal = await this.sourceClient.subscribeVisualDirtySignal(
        () => {
          this.requestVisualRefresh();
          this.requestPump();
        },
      );
    }
    try {
      await this.ensureVisualFrameStream(true);
    } catch (error) {
      if (!this.startFrameStream || this.renderMode !== 'visual') throw error;
      this.nativeStreamDisabled = true;
      this.log('visual-stream-fallback', {
        message: error instanceof Error ? error.message : String(error),
      });
      this.renderMode = this.renderModeFor(Math.max(0, Number(sourceResult.visualIslandCount) || 0));
      await this.ensureVisualFrameStream(true);
    }
    // CDP bindings wake the input relay immediately. Keep only a low-frequency
    // resilience poll when that signal is available; legacy clients retain the
    // display-speed poll and DOM-twin mode retains client guidance.
    const pumpIntervalMs = this.usesVisualCapture()
      ? this.stopActionSignal
        ? 250
        : Math.max(16, this.targetClient.recommendedPumpIntervalMs || 0)
      : Math.max(
        40,
        this.sourceClient.recommendedPumpIntervalMs || 0,
        this.targetClient.recommendedPumpIntervalMs || 0,
      );
    this.timer = setInterval(() => this.requestPump(), pumpIntervalMs);
    await this.pump();
  }

  private requestPump(): void {
    if (this.stopped) return;
    if (this.pumping) {
      this.pumpRequested = true;
      return;
    }
    void this.pump();
  }

  private requestRuntimeMaintenance(): void {
    const now = Date.now();
    if (this.stopped || this.runtimeMaintenanceRunning || now - this.lastRuntimeCheckAt < 1000) return;
    this.lastRuntimeCheckAt = now;
    this.runtimeMaintenanceRunning = true;
    void this.reinstallMissingRuntime().catch(async (error) => {
      if (this.stopped) return;
      const normalized = error instanceof Error ? error : new Error(String(error));
      this.log('maintenance-error', { message: normalized.message });
      await this.stop(true);
      this.onStop?.('error', normalized);
    }).finally(() => {
      this.runtimeMaintenanceRunning = false;
    });
  }

  private async reinstallMissingRuntime(): Promise<void> {
    let [sourceStatus, targetStatus] = await Promise.all([
      this.sourceClient.evaluate('globalThis.__attuneComponentSmuggleSource?.status?.() || null'),
      this.targetClient.evaluate('globalThis.__attuneComponentSmuggleTarget?.status?.() || null'),
    ]);
    let reinstalled = false;
    if (!sourceStatus) {
      this.log('reinstalling-source');
      sourceStatus = await this.sourceClient.evaluate(buildComponentSmuggleSourceExpression(
        this.source.anchor,
        false,
      ));
      reinstalled = true;
    }
    const nextRenderMode = this.renderModeFor(Math.max(0, Number(sourceStatus?.visualIslandCount) || 0));
    if (nextRenderMode !== this.renderMode) {
      const previousRenderMode = this.renderMode;
      this.renderMode = nextRenderMode;
      if (previousRenderMode === 'visual' && nextRenderMode !== 'visual' && this.stopVisualFrameStream) {
        await this.stopVisualFrameStream();
        this.stopVisualFrameStream = null;
        this.visualCaptureKey = '';
      }
      if (previousRenderMode === 'visual' || nextRenderMode === 'visual') {
        sourceStatus = await this.sourceClient.evaluate(buildComponentSmuggleSourceExpression(
          this.source.anchor,
          false,
        ));
      }
      this.log('render-mode-changed', {
        previous: previousRenderMode,
        next: nextRenderMode,
        visualIslandCount: Number(sourceStatus?.visualIslandCount) || 0,
      });
      reinstalled = true;
    }
    if (!targetStatus) {
      this.log('reinstalling-target');
      await this.targetClient.evaluate(buildComponentSmuggleTargetExpression(this.target.anchor));
      reinstalled = true;
    }
    if (this.usesAdaptiveComponentCapture() || this.usesHybridVisualCapture()) {
      if (reinstalled) this.requestVisualRefresh();
    } else {
      await this.ensureVisualFrameStream();
    }
  }

  private renderModeFor(visualIslandCount: number): 'dom-twin' | 'hybrid' | 'visual' {
    if (this.startFrameStream && !this.nativeStreamDisabled) return 'visual';
    if (visualIslandCount > 0 && this.sourceVisualClient.captureComponentFrame) return 'hybrid';
    return 'dom-twin';
  }

  private usesAdaptiveComponentCapture(): boolean {
    return Boolean(
      this.adaptiveCaptureEnabled
      &&
      this.renderMode === 'visual'
      &&
      !this.startFrameStream
      && !this.adaptiveCaptureDisabled
      && this.sourceVisualClient.captureComponentFrame,
    );
  }

  private async installSourceFonts(sourceResult: any): Promise<void> {
    try {
      const fontCss = await componentSmuggleEmbeddedFontCss(sourceResult?.fontFaces || []);
      if (fontCss) {
        await this.targetClient.evaluate(
          `globalThis.__attuneComponentSmuggleTarget?.installFontFaces?.(${JSON.stringify(fontCss)}) || null`,
        );
        this.log('fonts-installed', { bytes: fontCss.length, faces: sourceResult?.fontFaces?.length || 0 });
      }
    } catch (error) {
      this.log('font-install-error', { message: error instanceof Error ? error.message : String(error) });
    }
  }

  private usesVisualCapture(): boolean {
    return this.renderMode === 'visual' && Boolean(this.startFrameStream && !this.nativeStreamDisabled);
  }

  private usesHybridVisualCapture(): boolean {
    return this.renderMode === 'hybrid' && Boolean(this.sourceVisualClient.captureComponentFrame);
  }

  private requestVisualRefresh(): void {
    if (this.usesHybridVisualCapture()) this.requestHybridVisualCapture();
    else this.requestAdaptiveComponentCapture();
  }

  private requestHybridVisualCapture(): void {
    if (this.stopped || !this.usesHybridVisualCapture()) return;
    this.hybridCaptureRequested = true;
    if (!this.hybridCaptureRunning) void this.runHybridVisualCapture();
  }

  private async runHybridVisualCapture(): Promise<void> {
    if (this.hybridCaptureRunning || this.stopped || !this.usesHybridVisualCapture()) return;
    this.hybridCaptureRunning = true;
    this.hybridCaptureRequested = false;
    let continuousVisuals = false;
    try {
      const regions = await this.sourceVisualClient.evaluate(
        'globalThis.__attuneComponentSmuggleSource?.captureVisualRegions?.() || []',
      ) as ComponentSmuggleCaptureRegion[];
      const activeIslandIds = new Set<string>();
      for (const region of regions || []) {
        if (this.stopped || region.islandId === undefined) break;
        const islandId = String(region.islandId);
        activeIslandIds.add(islandId);
        continuousVisuals ||= Boolean(region.continuousVisuals);
        const data = await this.sourceVisualClient.captureComponentFrame!(region);
        if (!data) continue;
        this.adaptiveCaptureAttempts += 1;
        const frameKey = `${this.adaptiveRegionKey(region)}:${data}`;
        if (this.hybridFrames.get(islandId) === frameKey) {
          this.adaptiveFramesSkipped += 1;
          continue;
        }
        this.hybridFrames.set(islandId, frameKey);
        this.visualSequence += 1;
        await this.targetVisualClient.evaluate(
          `globalThis.__attuneComponentSmuggleTarget?.applyVisualIsland?.(${JSON.stringify({
            sequence: this.visualSequence,
            islandId,
            visualKind: region.visualKind,
            data,
            width: region.width,
            height: region.height,
          })}) || false`,
        );
      }
      for (const islandId of this.hybridFrames.keys()) {
        if (!activeIslandIds.has(islandId)) this.hybridFrames.delete(islandId);
      }
    } catch (error) {
      if (!this.stopped) {
        this.log('visual-island-capture-error', {
          message: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      this.hybridCaptureRunning = false;
      if (!this.stopped && this.usesHybridVisualCapture()) {
        if (this.hybridCaptureRequested) queueMicrotask(() => void this.runHybridVisualCapture());
        else if (continuousVisuals) setTimeout(() => this.requestHybridVisualCapture(), 16).unref?.();
      }
    }
  }

  private requestAdaptiveComponentCapture(): void {
    if (this.stopped || !this.usesAdaptiveComponentCapture()) return;
    this.adaptiveCaptureRequested = true;
    if (!this.adaptiveCaptureRunning) void this.runAdaptiveComponentCapture();
  }

  private adaptiveRegionKey(region: ComponentSmuggleCaptureRegion): string {
    return [
      region.x, region.y, region.width, region.height,
      region.rootWidth, region.rootHeight, region.offsetX, region.offsetY,
      region.pixelRatio,
    ].map((value) => Math.round(Number(value) * 2) / 2).join(':');
  }

  private async runAdaptiveComponentCapture(): Promise<void> {
    if (this.adaptiveCaptureRunning || this.stopped || !this.usesAdaptiveComponentCapture()) return;
    this.adaptiveCaptureRunning = true;
    let stableFrames = 0;
    let continuousFrames = 0;
    try {
      do {
        this.adaptiveCaptureRequested = false;
        const region = await this.sourceVisualClient.evaluate(
          'globalThis.__attuneComponentSmuggleSource?.captureRegion?.() || null',
        ) as ComponentSmuggleCaptureRegion | null;
        if (!region?.width || !region?.height) break;
        const data = await this.sourceVisualClient.captureComponentFrame!(region);
        if (!data) throw new Error('component screenshot returned no pixels');
        this.adaptiveCaptureAttempts += 1;
        const regionKey = this.adaptiveRegionKey(region);
        const changed = data !== this.lastAdaptiveFrame || regionKey !== this.lastAdaptiveRegionKey;
        if (changed) {
          stableFrames = 0;
          this.lastAdaptiveFrame = data;
          this.lastAdaptiveRegionKey = regionKey;
          this.enqueueVisualFrame(data, region);
        } else {
          stableFrames += 1;
          this.adaptiveFramesSkipped += 1;
        }
        if (region.continuousVisuals) {
          continuousFrames += 1;
          if (continuousFrames >= 1) {
            this.adaptiveCaptureRequested = true;
            break;
          }
        }
        // Page.captureScreenshot synchronizes with the compositor, so the next
        // sequential request naturally lands on the next display frame. Stop
        // after three identical component frames unless new activity arrives
        // or the component contains active media/animations.
        if (!this.adaptiveCaptureRequested && !region.continuousVisuals && stableFrames >= 3) break;
      } while (!this.stopped);
    } catch (error) {
      if (!this.stopped) {
        this.adaptiveCaptureDisabled = true;
        this.log('component-capture-error', {
          message: error instanceof Error ? error.message : String(error),
          fallback: Boolean(this.startFrameStream),
        });
        await this.ensureVisualFrameStream(true);
      }
    } finally {
      this.adaptiveCaptureRunning = false;
      if (!this.stopped && this.adaptiveCaptureRequested && this.usesAdaptiveComponentCapture()) {
        queueMicrotask(() => this.requestAdaptiveComponentCapture());
      }
    }
  }

  private async ensureVisualFrameStream(force = false): Promise<void> {
    if (this.usesHybridVisualCapture()) {
      this.hybridCaptureRequested = true;
      if (force) await this.runHybridVisualCapture();
      else this.requestHybridVisualCapture();
      return;
    }
    if (this.usesAdaptiveComponentCapture()) {
      this.adaptiveCaptureRequested = true;
      if (force) await this.runAdaptiveComponentCapture();
      else this.requestAdaptiveComponentCapture();
      return;
    }
    if (!this.usesVisualCapture()) return;
    if (this.stopped) return;
    const region = await this.sourceClient.evaluate(
      'globalThis.__attuneComponentSmuggleSource?.captureRegion?.() || null',
    ) as ComponentSmuggleCaptureRegion | null;
    if (!region?.width || !region?.height) return;
    if (!this.startFrameStream) return;
    const captureKey = [
      region.screenX, region.screenY, region.outerWidth, region.outerHeight,
      region.contentOffsetX, region.contentOffsetY,
      region.x, region.y, region.width, region.height,
    ].map((value) => Math.round(Number(value) * 2) / 2).join(':');
    if (!force && captureKey === this.visualCaptureKey && this.stopVisualFrameStream) return;
    const previousStop = this.stopVisualFrameStream;
    const nextGeneration = this.visualCaptureGeneration + 1;
    let candidateFrame = '';
    try {
      const stop = await this.startFrameStream(region, (data) => {
        if (this.visualCaptureGeneration === nextGeneration) {
          this.enqueueVisualFrame(data, region);
        } else {
          // The helper can emit its initial screenshot before its ready signal.
          // Retain only the freshest candidate until this stream is committed.
          candidateFrame = data;
        }
      });
      if (this.stopped) {
        await stop();
        return;
      }
      // Commit the replacement before retiring the old stream. Late frames
      // from the old generation are ignored, so resizing never creates a gap
      // or lets an obsolete frame overwrite the new component bounds.
      this.stopVisualFrameStream = stop;
      this.visualCaptureKey = captureKey;
      this.visualCaptureGeneration = nextGeneration;
      if (candidateFrame) this.enqueueVisualFrame(candidateFrame, region);
      if (previousStop && previousStop !== stop) await previousStop();
      this.log('visual-stream-started', {
        width: Math.round(region.width),
        height: Math.round(region.height),
      });
    } catch (error) {
      if (!previousStop) throw error;
      this.log('visual-stream-restart-error', {
        message: error instanceof Error ? error.message : String(error),
        width: Math.round(region.width),
        height: Math.round(region.height),
      });
    }
  }

  private enqueueVisualFrame(data: string, region: ComponentSmuggleCaptureRegion): void {
    if (this.stopped || !data) return;
    const now = Date.now();
    if (!this.visualStatsStartedAt) {
      this.visualStatsStartedAt = now;
      this.lastVisualStatsAt = now;
    }
    this.visualFramesReceived += 1;
    this.visualBytesReceived += Math.ceil(data.length * 0.75);
    if (this.pendingVisualFrame) this.visualFramesDropped += 1;
    this.pendingVisualFrame = { data, region };
    if (!this.visualFrameApplying) void this.flushVisualFrames();
    if (now - this.lastVisualStatsAt >= 5000) {
      const elapsedSeconds = Math.max(0.001, (now - this.visualStatsStartedAt) / 1000);
      this.log('visual-performance', {
        captureAttempts: this.adaptiveCaptureAttempts,
        identicalFramesSkipped: this.adaptiveFramesSkipped,
        receivedFps: Number((this.visualFramesReceived / elapsedSeconds).toFixed(1)),
        appliedFps: Number((this.visualFramesApplied / elapsedSeconds).toFixed(1)),
        droppedFrames: this.visualFramesDropped,
        megabitsPerSecond: Number(((this.visualBytesReceived * 8 / 1_000_000) / elapsedSeconds).toFixed(1)),
      });
      this.lastVisualStatsAt = now;
    }
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
          dispatchedAt: Date.now(),
          width: region.width,
          height: region.height,
          rootWidth: region.rootWidth,
          rootHeight: region.rootHeight,
          offsetX: region.offsetX,
          offsetY: region.offsetY,
        };
        await this.targetVisualClient.evaluate(
          `globalThis.__attuneComponentSmuggleTarget?.applyVisual?.(${JSON.stringify(frame)}) || false`,
        );
        this.visualFramesApplied += 1;
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
    if (this.stopped) return;
    if (this.pumping) {
      this.pumpRequested = true;
      return;
    }
    this.pumping = true;
    this.pumpRequested = false;
    try {
      // Runtime health checks and capture-region restarts can take hundreds of
      // milliseconds. Keep them off the input lane so a growing composer or
      // newly opened popup never stalls the next key event.
      this.requestRuntimeMaintenance();
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
        if (Object.keys(diagnosticCounts).length) {
          const oldestQueuedAt = Math.min(...actions.map((action: { queuedAt?: number }) => (
            Number(action?.queuedAt) || Date.now()
          )));
          this.log('target-actions', {
            ...diagnosticCounts,
            queueMilliseconds: Math.max(0, Date.now() - oldestQueuedAt),
          });
        }
      }
      const replayable = [];
      for (const action of actions || []) {
        const sourceReference = typeof action.nodeId === 'string' && action.nodeId
          ? action.nodeId
          : action.path;
        if (action.type === 'close') {
          await this.stop(true);
          this.onStop?.('closed');
          return;
        }
        if (action.type === 'visual-click') {
          this.lastVisualInteractionPosition = action.position || null;
          if (this.sourceClient.clickAtComponentPosition) {
            await this.sourceClient.clickAtComponentPosition(action.position || undefined);
          } else {
            const point = await this.sourceClient.evaluate(
              `globalThis.__attuneComponentSmuggleSource?.capturePoint?.(${JSON.stringify(action.position || null)}) || null`,
            );
            if (point) await this.sourceClient.click(point.x, point.y);
          }
        } else if (action.type === 'visual-hover') {
          if (this.sourceClient.moveAtComponentPosition) {
            await this.sourceClient.moveAtComponentPosition(action.position || null);
          } else {
            const point = await this.sourceClient.evaluate(
              `globalThis.__attuneComponentSmuggleSource?.hoverPoint?.(${JSON.stringify(action.position || null)}) || null`,
            );
            if (point) await this.sourceClient.move(point.x, point.y);
          }
        } else if (action.type === 'visual-wheel') {
          if (this.sourceClient.wheelAtComponentPosition) {
            await this.sourceClient.wheelAtComponentPosition(
              action.position || {}, action.deltaX, action.deltaY, action,
            );
          } else {
            const point = await this.sourceClient.evaluate(
              `globalThis.__attuneComponentSmuggleSource?.hoverPoint?.(${JSON.stringify(action.position || null)}) || null`,
            );
            if (point) await this.sourceClient.wheel(point.x, point.y, action.deltaX, action.deltaY, action);
          }
        } else if (action.type === 'hover') {
          const point = sourceReference
            ? await this.sourceClient.evaluate(
              `globalThis.__attuneComponentSmuggleSource?.clickPoint?.(${JSON.stringify(sourceReference)}, ${JSON.stringify(action.position || null)}, false) || null`,
            )
            : await this.sourceClient.evaluate(
              'globalThis.__attuneComponentSmuggleSource?.hoverPoint?.(null) || null',
            );
          if (point) await this.sourceClient.move(point.x, point.y);
        } else if (action.type === 'wheel') {
          const point = await this.sourceClient.evaluate(
            `globalThis.__attuneComponentSmuggleSource?.clickPoint?.(${JSON.stringify(sourceReference || [])}, ${JSON.stringify(action.position || null)}, false) || null`,
          );
          if (point) await this.sourceClient.wheel(point.x, point.y, action.deltaX, action.deltaY, action);
        } else if (action.type === 'visual-edit' && action.trusted) {
          const handled = await this.replayVisualEdit(action);
          if (!handled) {
            this.log('visual-edit-forward-error', {
              inputType: action.inputType,
              dataLength: typeof action.data === 'string' ? action.data.length : 0,
              position: this.lastVisualInteractionPosition,
            });
          }
        } else if (action.type === 'visual-key' && action.trusted) {
          try {
            const focused = await this.focusSourceVisualEditable();
            if (!focused?.ok) throw new Error('no editable source element is associated with the visual click');
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
            `globalThis.__attuneComponentSmuggleSource?.clickPoint?.(${JSON.stringify(sourceReference)}, ${JSON.stringify(action.position || null)}) || null`,
          );
          if (point) await this.sourceClient.click(point.x, point.y);
          if (action.editable && action.selectionAfter) {
            const editableReference = action.editableNodeId || action.editablePath || sourceReference;
            await this.sourceClient.evaluate(
              `globalThis.__attuneComponentSmuggleSource?.focusPath?.(${JSON.stringify(editableReference)}, ${JSON.stringify(action.selectionAfter)}) || null`,
            );
          }
        } else if (action.type === 'input' && action.trusted && action.inputType) {
          const handled = await this.replayNativeEdit(action);
          if (!handled) replayable.push(action);
        } else if (action.type === 'shortcut' && action.trusted && action.editable) {
          try {
            await this.sourceClient.evaluate(
              `globalThis.__attuneComponentSmuggleSource?.focusPath?.(${JSON.stringify(sourceReference)}, ${JSON.stringify(action.selectionBefore || null)}) || null`,
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
              `globalThis.__attuneComponentSmuggleSource?.focusPath?.(${JSON.stringify(sourceReference)}, ${JSON.stringify(action.selectionBefore || null)}) || null`,
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
      if (actions?.length && (this.usesAdaptiveComponentCapture() || this.usesHybridVisualCapture())) {
        this.requestVisualRefresh();
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
      // In visual mode the stream remains authoritative for pixels, while the
      // synchronized DOM twin stays invisible and supplies precise hit-testing,
      // native focus, selection, and text editing.
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
      if (packets?.length) {
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
      if (!this.stopped && this.pumpRequested) {
        this.pumpRequested = false;
        queueMicrotask(() => this.requestPump());
      }
    }
  }

  private async replayVisualEdit(action: any): Promise<boolean> {
    const inputType = String(action.inputType || '');
    const focused = await this.focusSourceVisualEditable();
    if (!focused?.ok) return false;
    if (inputType.startsWith('insert') && typeof action.data === 'string' && action.data) {
      if (this.sourceClient.insertTextInPrimaryEditable) {
        return this.sourceClient.insertTextInPrimaryEditable(action.data);
      }
      await this.sourceClient.insertText(action.data);
      return true;
    }
    if (inputType === 'insertParagraph' || inputType === 'insertLineBreak') {
      await this.sourceClient.pressKey('Enter', 'Enter');
      return true;
    }
    return false;
  }

  private async focusSourceVisualEditable(): Promise<any> {
    const position = JSON.stringify(this.lastVisualInteractionPosition);
    return this.sourceClient.evaluate(`(() => {
      const source = globalThis.__attuneComponentSmuggleSource;
      const active = source?.focusActiveEditable?.();
      if (active?.ok) return active;
      const positioned = source?.focusEditableAt?.(${position});
      return positioned?.ok ? positioned : source?.focusPrimaryEditable?.() || null;
    })()`);
  }

  private async replayNativeEdit(action: any): Promise<boolean> {
    const focused = await this.sourceClient.evaluate(
      `globalThis.__attuneComponentSmuggleSource?.focusPath?.(${JSON.stringify(action.nodeId || action.path)}, ${JSON.stringify(action.selectionBefore || null)}) || null`,
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
    const stopActionSignal = this.stopActionSignal;
    this.stopActionSignal = null;
    if (stopActionSignal) await stopActionSignal();
    const stopVisualDirtySignal = this.stopVisualDirtySignal;
    this.stopVisualDirtySignal = null;
    if (stopVisualDirtySignal) await stopVisualDirtySignal();
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
    if (this.sourceVisualClient !== this.sourceClient) this.sourceVisualClient.close();
    this.targetClient.close();
    if (this.targetVisualClient !== this.targetClient) this.targetVisualClient.close();
    this.log('stopped');
  }

  private log(event: string, details?: Record<string, unknown>): void {
    const suffix = details ? ` ${JSON.stringify(details)}` : '';
    console.info(`[attune:smuggle] ${event}${suffix}`);
  }
}
