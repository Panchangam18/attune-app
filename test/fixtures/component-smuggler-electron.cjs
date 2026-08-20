const { app, BrowserWindow } = require('electron');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function selection({ intent, roles, selector, tag, label, text, attributes, ancestor, placement = 'inside' }) {
  return {
    status: 'selected',
    intent,
    pageTitle: 'Fixture',
    roles,
    selector,
    selectorStability: roles.length ? 'semantic' : 'high',
    placement,
    fingerprint: {
      tag,
      domRole: '',
      label,
      text,
      attributes,
      classes: [],
      ancestor,
    },
    bounds: { x: 0, y: 0, width: 300, height: 80 },
    styles: {
      display: 'block', position: 'relative', color: 'rgb(255, 255, 255)',
      backgroundColor: 'rgb(30, 30, 30)', fontSize: '14px', fontFamily: 'sans-serif', borderRadius: '8px',
    },
  };
}

async function run() {
  const moduleUrl = pathToFileURL(join(__dirname, '..', '..', 'dist-electron', 'component-smuggler.js')).href;
  const {
    buildComponentSmuggleSourceExpression,
    buildComponentSmuggleTargetExpression,
    componentSmuggleAnchor,
  } = await import(moduleUrl);
  const pickerModuleUrl = pathToFileURL(join(__dirname, '..', '..', 'dist-electron', 'element-picker.js')).href;
  const { buildElementPickerExpression } = await import(pickerModuleUrl);

  const sourceWindow = new BrowserWindow({
    show: false,
    width: 600,
    height: 400,
    webPreferences: { backgroundThrottling: false },
  });
  const targetWindow = new BrowserWindow({
    show: false,
    width: 600,
    height: 400,
    webPreferences: { backgroundThrottling: false },
  });
  await Promise.all([
    sourceWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
      <!doctype html><html><head><style>
        body { margin: 0; font: 14px sans-serif; }
        [data-attune-host-roles~="fixture.source"] {
          width: 800px; padding: 12px; color: white; background: rgb(35,36,40); border-radius: 10px;
          display: grid; position: relative; grid-template-areas: "action title"; grid-template-columns: 120px 1fr;
        }
        strong { grid-area: title; }
        button { padding: 6px 10px; color: white; background: rgb(70,80,110); border: 0; border-radius: 6px; }
        button { grid-area: action; }
        [role="toolbar"] { display: none; gap: 4px; grid-area: title; justify-self: start; margin-left: 180px; }
        [role="toolbar"] button { grid-area: auto; }
        [role="toolbar"] button[aria-pressed="true"] { background: rgb(40, 140, 90); }
        button::after { content: " Ready"; color: rgb(210, 220, 255); }
        svg { width: 12px; height: 12px; }
        [data-fixture-covered-editor] { position: relative; grid-column: 1 / 3; width: 180px; height: 32px; }
        [data-fixture-covered-editor] textarea { position: absolute; inset: 0; width: 180px; height: 32px; }
        [data-fixture-editor-cover] { position: absolute; inset: 0; z-index: 2; background: transparent; }
      </style></head><body><aside id="outside-source-component">Unrelated activity</aside>
        <section data-attune-host-roles="fixture.source" data-attune-smuggle-anchor="source-token">
          <strong>Live card <span role="textbox" contenteditable="true" aria-label="Editor">Draft</span></strong><button aria-label="Increment"><svg viewBox="0 0 16 16"><path fill-rule="evenodd" d="M2 7h12v2H2z"/></svg>Count 0</button>
          <div data-fixture-covered-editor><textarea aria-label="Covered editor">Seed</textarea><div data-fixture-editor-cover></div></div>
          <table data-fixture-table><thead><tr><th colspan="3" scope="colgroup">August</th><th colspan="2" scope="colgroup">September</th></tr></thead><tbody><tr><td>A</td><td>B</td><td>C</td><td>D</td><td>E</td></tr></tbody></table>
          <canvas data-fixture-canvas width="80" height="24" style="width:80px;height:24px"></canvas>
          <div role="toolbar" aria-label="Formatting"><button aria-label="Bold" aria-pressed="false">B</button><button aria-label="Italic" aria-pressed="false">I</button></div>
          <button aria-label="Show formatting toolbar" style="position:absolute;left:450px;top:12px">Aa</button>
        </section>
        <script>
          window.sourceClicks = 0;
          window.sourceInputEvents = 0;
          window.sourceShortcutKeydowns = 0;
          window.portalClicks = 0;
          window.sourceHoverEvents = { enter: 0, move: 0, leave: 0 };
          const incrementButton = document.querySelector('[aria-label="Increment"]');
          incrementButton.addEventListener('mouseenter', () => { window.sourceHoverEvents.enter += 1; });
          incrementButton.addEventListener('mousemove', () => { window.sourceHoverEvents.move += 1; });
          incrementButton.addEventListener('mouseleave', () => { window.sourceHoverEvents.leave += 1; });
          document.querySelector('[aria-label="Editor"]').addEventListener('input', () => { window.sourceInputEvents += 1; });
          document.querySelector('[aria-label="Editor"]').addEventListener('keydown', (event) => {
            if (!(event.metaKey || event.ctrlKey)) return;
            window.sourceShortcutKeydowns += 1;
            const control = event.code === 'KeyB'
              ? document.querySelector('[aria-label="Bold"]')
              : event.code === 'KeyI'
                ? document.querySelector('[aria-label="Italic"]')
                : null;
            control?.click();
          });
          for (const button of document.querySelectorAll('[role="toolbar"] button')) {
            button.addEventListener('click', () => {
            button.setAttribute('aria-pressed', button.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
            });
          }
          document.querySelector('[aria-label="Show formatting toolbar"]').addEventListener('click', (event) => {
            document.querySelector('[role="toolbar"]').style.display = 'flex';
            event.currentTarget.setAttribute('aria-label', 'Hide formatting toolbar');
          });
          const wire = (root) => {
            root.querySelector('[data-fixture-editor-cover]').addEventListener('click', () => {
              root.querySelector('[aria-label="Covered editor"]').focus({ preventScroll: true });
            });
            root.querySelector('button').addEventListener('click', () => {
              window.sourceClicks += 1;
              root.querySelector('button').textContent = 'Count ' + window.sourceClicks;
              if (!document.querySelector('[role="menu"]')) {
                const menu = document.createElement('div');
                menu.setAttribute('role', 'menu');
                menu.style.cssText = 'position:fixed;left:20px;top:100px;width:180px;height:40px;background:white;z-index:1000';
                menu.innerHTML = '<button aria-label="Portal action">Portal action</button>';
                menu.querySelector('button').addEventListener('click', () => { window.portalClicks += 1; menu.remove(); });
                document.body.appendChild(menu);
              }
            });
          };
          wire(document.querySelector('[data-attune-host-roles~="fixture.source"]'));
          window.replaceSource = () => {
            const previous = document.querySelector('[data-attune-host-roles~="fixture.source"]');
            const replacement = previous.cloneNode(true);
            replacement.removeAttribute('data-attune-smuggle-anchor');
            replacement.querySelector('strong').textContent = 'Rebound card';
            previous.replaceWith(replacement);
            wire(replacement);
          };
        </script>
      </body></html>
    `)}`),
    targetWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
      <!doctype html><html><body>
        <div id="target-row" style="display:flex;align-items:flex-start">
          <main contenteditable="true" style="width:300px;height:80px;flex:0 0 auto" data-attune-host-roles="fixture.target" data-attune-smuggle-anchor="target-token">
            <div data-fixture-target-content style="width:120px;height:40px">Target content</div>
          </main>
        </div>
        <script>
          document.addEventListener('pointerdown', (event) => {
            if (event.composedPath().some((item) => item?.tagName === 'ATTUNE-COMPONENT-SMUGGLE')) {
              setTimeout(() => document.querySelector('main')?.focus(), 25);
            }
          }, true);
          window.replaceTarget = () => {
            const previous = document.querySelector('[data-attune-host-roles~="fixture.target"]');
            const replacement = previous.cloneNode(false);
            replacement.removeAttribute('data-attune-smuggle-anchor');
            replacement.innerHTML = '<div data-fixture-target-content style="width:120px;height:40px">Target content</div>';
            previous.replaceWith(replacement);
          };
        </script>
      </body></html>
    `)}`),
  ]);

  const sourceSelection = selection({
    intent: 'smuggle-source',
    roles: ['fixture.source'],
    selector: '[data-attune-host-roles~="fixture.source"]',
    tag: 'section', label: '', text: 'Live card Count 0',
    attributes: {}, ancestor: { tag: 'body', domRole: '', label: '' },
  });
  const targetSelection = selection({
    intent: 'smuggle-target',
    roles: ['fixture.target'],
    selector: '[data-attune-host-roles~="fixture.target"]',
    tag: 'main', label: '', text: '',
    attributes: {}, ancestor: { tag: 'body', domRole: '', label: '' },
  });
  const sourceAnchor = componentSmuggleAnchor(sourceSelection, 'source-token');
  const targetAnchor = componentSmuggleAnchor(targetSelection, 'target-token');
  const sourceInstall = await sourceWindow.webContents.executeJavaScript(
    buildComponentSmuggleSourceExpression(sourceAnchor),
  );
  const targetInstall = await targetWindow.webContents.executeJavaScript(
    buildComponentSmuggleTargetExpression(targetAnchor),
  );
  if (!sourceInstall.ok || !targetInstall.ok) {
    throw new Error(`Install failed: ${JSON.stringify({ sourceInstall, targetInstall })}`);
  }

  const pump = async () => {
    const packets = await sourceWindow.webContents.executeJavaScript(
      'window.__attuneComponentSmuggleSource.drain()',
    );
    if (packets.length) {
      await targetWindow.webContents.executeJavaScript(
        `window.__attuneComponentSmuggleTarget.apply(${JSON.stringify(packets)})`,
      );
    }
    return packets;
  };
  const settle = async (actions) => {
    const revision = actions.reduce((latest, action) => Math.max(latest, Number(action.revision) || 0), 0);
    if (revision) {
      await sourceWindow.webContents.executeJavaScript(
        `window.__attuneComponentSmuggleSource.settleActions(${revision})`,
      );
    }
  };
  await pump();
  await sourceWindow.webContents.executeJavaScript(
    `document.querySelector('#outside-source-component').setAttribute('data-unrelated-update', String(Date.now()))`,
  );
  await wait(25);
  const unrelatedPackets = await pump();
  if (unrelatedPackets.length) {
    throw new Error(`Unrelated source activity refreshed the smuggled component: ${JSON.stringify(unrelatedPackets.map((packet) => packet.type))}`);
  }
  const initial = await targetWindow.webContents.executeJavaScript(`(() => {
    const host = document.querySelector('attune-component-smuggle');
    return {
      connected: host?.isConnected,
      text: host?.shadowRoot?.querySelector('[data-attune-component-smuggle="surface"]')?.textContent,
      buttonPath: host?.shadowRoot?.querySelector('[aria-label="Increment"]')?.getAttribute('data-attune-smuggle-path'),
      layout: (() => {
        const root = host?.shadowRoot?.querySelector('[data-attune-component-smuggle="surface"]')?.firstElementChild?.firstElementChild;
        const button = root?.querySelector('[aria-label="Increment"]');
        const strong = root?.querySelector('strong');
        const rootRect = root?.getBoundingClientRect();
        const hostRect = host?.getBoundingClientRect();
        const buttonRect = button?.getBoundingClientRect();
        const strongRect = strong?.getBoundingClientRect();
        return {
          fullSize: Boolean(rootRect && hostRect && rootRect.width > 800 && hostRect.width >= rootRect.width - 1),
          namedGridPlacement: Boolean(buttonRect && strongRect && buttonRect.x < strongRect.x),
          viewBox: root?.querySelector('svg')?.getAttribute('viewBox') || '',
          tableStructure: (() => {
            const headers = [...(root?.querySelectorAll('[data-fixture-table] thead th') || [])];
            return headers.map((header) => ({
              colSpan: header.colSpan,
              colspan: header.getAttribute('colspan'),
              scope: header.getAttribute('scope'),
            }));
          })(),
          visualIsland: root?.querySelector('[data-attune-smuggle-visual-island]')?.getAttribute('data-attune-smuggle-visual-kind') || '',
        };
      })(),
    };
  })()`);
  if (!initial.connected || !initial.text.includes('Live card') || !initial.text.includes('Ready') || !initial.buttonPath
    || !initial.layout.fullSize || !initial.layout.namedGridPlacement || initial.layout.viewBox !== '0 0 16 16'
    || JSON.stringify(initial.layout.tableStructure) !== JSON.stringify([
      { colSpan: 3, colspan: '3', scope: 'colgroup' },
      { colSpan: 2, colspan: '2', scope: 'colgroup' },
    ]) || initial.layout.visualIsland !== 'canvas') {
    throw new Error(`Initial twin was not rendered: ${JSON.stringify(initial)}`);
  }

  const hoverBounds = await sourceWindow.webContents.executeJavaScript(`(() => {
    const bounds = document.querySelector('[aria-label="Increment"]').getBoundingClientRect();
    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  })()`);
  const scrollBounds = await sourceWindow.webContents.executeJavaScript(`(() => {
    const scroller = document.createElement('div');
    scroller.id = 'fixture-native-wheel';
    scroller.style.cssText = 'position:fixed;left:300px;top:100px;width:100px;height:60px;overflow:auto;z-index:2147483647';
    scroller.innerHTML = '<div style="height:400px">Scrollable modal</div>';
    scroller.addEventListener('wheel', () => { window.sourceWheelEvents = (window.sourceWheelEvents || 0) + 1; });
    document.documentElement.appendChild(scroller);
    const bounds = scroller.getBoundingClientRect();
    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  })()`);
  sourceWindow.webContents.debugger.attach('1.3');
  let nativeHoverState;
  try {
    await sourceWindow.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: hoverBounds.x, y: hoverBounds.y, button: 'none', buttons: 0, pointerType: 'mouse',
    });
    await wait(20);
    const entered = await sourceWindow.webContents.executeJavaScript(`({
      hovered: document.querySelector('[aria-label="Increment"]').matches(':hover'),
      events: { ...window.sourceHoverEvents },
    })`);
    await sourceWindow.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: 590, y: 390, button: 'none', buttons: 0, pointerType: 'mouse',
    });
    await wait(20);
    const left = await sourceWindow.webContents.executeJavaScript(`({
      hovered: document.querySelector('[aria-label="Increment"]').matches(':hover'),
      events: { ...window.sourceHoverEvents },
    })`);
    await sourceWindow.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseWheel', x: scrollBounds.x, y: scrollBounds.y, deltaX: 0, deltaY: 80,
      button: 'none', buttons: 0, pointerType: 'mouse',
    });
    await wait(40);
    const scrolled = await sourceWindow.webContents.executeJavaScript(`({
      scrollTop: document.getElementById('fixture-native-wheel')?.scrollTop || 0,
      events: window.sourceWheelEvents || 0,
    })`);
    nativeHoverState = { entered, left, scrolled };
  } finally {
    await sourceWindow.webContents.executeJavaScript(`document.getElementById('fixture-native-wheel')?.remove()`);
    sourceWindow.webContents.debugger.detach();
  }
  if (!nativeHoverState.entered.hovered || nativeHoverState.entered.events.enter !== 1
    || nativeHoverState.entered.events.move < 1 || nativeHoverState.left.hovered
    || nativeHoverState.left.events.leave !== 1 || nativeHoverState.scrolled.scrollTop <= 0
    || nativeHoverState.scrolled.events !== 1) {
    throw new Error(`Native pointer input did not round-trip through Chromium: ${JSON.stringify(nativeHoverState)}`);
  }

  const streamedInteractionReady = await targetWindow.webContents.executeJavaScript(`(() => {
    const api = window.__attuneComponentSmuggleTarget;
    api.applyVisual({
      sequence: 1,
      data: ${JSON.stringify('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XwWSJwAAAABJRU5ErkJggg==')},
      width: 800, height: 120, rootWidth: 800, rootHeight: 120, offsetX: 0, offsetY: 0,
    });
    const shadow = document.querySelector('attune-component-smuggle').shadowRoot;
    const frame = shadow.querySelector('[data-attune-component-smuggle="frame"]');
    const viewport = shadow.querySelector('[data-attune-component-smuggle="visual-viewport"]');
    return Boolean(frame && frame.style.opacity === '0' && frame.style.pointerEvents === 'none'
      && viewport.style.pointerEvents === 'auto');
  })()`);
  if (!streamedInteractionReady) throw new Error('The streamed pixels did not take ownership from the passive DOM twin.');

  await targetWindow.webContents.executeJavaScript(`(() => {
    const shadow = document.querySelector('attune-component-smuggle').shadowRoot;
    const editor = shadow.querySelector('[aria-label="Editor"]');
    editor.__attuneIdentity = 'optimistic';
    editor.focus();
    const selection = shadow.getSelection();
    selection.setBaseAndExtent(editor.firstChild, 5, editor.firstChild, 5);
    for (const character of '123') {
      const offset = selection.anchorOffset;
      editor.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true, composed: true, inputType: 'insertText', data: character, cancelable: true,
      }));
      editor.firstChild.nodeValue += character;
      selection.setBaseAndExtent(editor.firstChild, offset + 1, editor.firstChild, offset + 1);
      editor.dispatchEvent(new InputEvent('input', {
        bubbles: true, composed: true, inputType: 'insertText', data: character,
      }));
    }
  })()`);
  const optimisticActions = await targetWindow.webContents.executeJavaScript(
    'window.__attuneComponentSmuggleTarget.drainActions()',
  );
  if (optimisticActions.filter((action) => action.type === 'input').length !== 3) {
    throw new Error(`Optimistic input actions were not captured: ${JSON.stringify(optimisticActions)}`);
  }
  await sourceWindow.webContents.executeJavaScript(`(() => {
    document.querySelector('[data-attune-host-roles~="fixture.source"]').setAttribute('data-stale-pass', '1');
  })()`);
  await wait(20);
  await pump();
  const optimisticGuard = await targetWindow.webContents.executeJavaScript(`(() => {
    const runtime = window.__attuneComponentSmuggleTarget;
    const shadow = document.querySelector('attune-component-smuggle').shadowRoot;
    const editor = shadow.querySelector('[aria-label="Editor"]');
    const status = runtime.status();
    return {
      textPreserved: editor.textContent === 'Draft123',
      caret: shadow.getSelection()?.anchorOffset ?? -1,
      identityPreserved: editor.__attuneIdentity === 'optimistic',
      staleWasRejected: status.acknowledgedActionRevision < status.latestActionRevision,
    };
  })()`);
  if (!optimisticGuard.textPreserved || optimisticGuard.caret !== 8
    || !optimisticGuard.identityPreserved || !optimisticGuard.staleWasRejected) {
    throw new Error(`A stale snapshot touched optimistic input: ${JSON.stringify(optimisticGuard)}`);
  }
  await targetWindow.webContents.executeJavaScript('window.__attuneComponentSmuggleTarget.cleanup()');
  for (const placement of ['top', 'bottom', 'left', 'right']) {
    const containedAnchor = { ...targetAnchor, token: `target-${placement}`, placement };
    const containedInstall = await targetWindow.webContents.executeJavaScript(
      buildComponentSmuggleTargetExpression(containedAnchor),
    );
    await targetWindow.webContents.executeJavaScript(`window.__attuneComponentSmuggleTarget.applyVisual({
      sequence: 1,
      data: ${JSON.stringify('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XwWSJwAAAABJRU5ErkJggg==')},
      width: 120, height: 50, rootWidth: 120, rootHeight: 50, offsetX: 0, offsetY: 0,
    })`);
    await wait(20);
    const containedState = await targetWindow.webContents.executeJavaScript(`(() => {
      const mount = document.querySelector('[data-attune-host-roles~="fixture.target"]');
      const host = mount.querySelector('attune-component-smuggle');
      const content = mount.querySelector('[data-fixture-target-content]');
      const mountBounds = mount.getBoundingClientRect();
      const hostBounds = host.getBoundingClientRect();
      const contentBounds = content.getBoundingClientRect();
      const verticallyReachable = hostBounds.bottom <= mountBounds.bottom + 1
        || mount.scrollHeight > mount.clientHeight + 1;
      return {
        placement: window.__attuneComponentSmuggleTarget.status().placement,
        placementLayout: window.__attuneComponentSmuggleTarget.status().placementLayout,
        insideMount: host.parentElement === mount,
        outerWidthPreserved: Math.abs(mountBounds.width - 300) < 1,
        hostContained: hostBounds.left >= mountBounds.left - 1 && hostBounds.right <= mountBounds.right + 1
          && hostBounds.top >= mountBounds.top - 1 && verticallyReachable,
        contentReserved: ${JSON.stringify(placement)} === 'top'
          ? contentBounds.top >= hostBounds.bottom + 7
          : ${JSON.stringify(placement)} === 'bottom'
            ? contentBounds.bottom <= hostBounds.top - 7
          : ${JSON.stringify(placement)} === 'left'
            ? contentBounds.left >= hostBounds.right + 7
            : contentBounds.right <= hostBounds.left - 7,
      };
    })()`);
    await targetWindow.webContents.executeJavaScript('window.replaceTarget()');
    await wait(40);
    const reboundContained = await targetWindow.webContents.executeJavaScript(`(() => {
      const mount = document.querySelector('[data-attune-host-roles~="fixture.target"]');
      const host = mount.querySelector('attune-component-smuggle');
      return host?.parentElement === mount
        && window.__attuneComponentSmuggleTarget.status().placementLayout === 'contained';
    })()`);
    if (!containedInstall.ok || containedState.placement !== placement || containedState.placementLayout !== 'contained'
      || !containedState.insideMount || !containedState.outerWidthPreserved || !containedState.hostContained
      || !containedState.contentReserved || !reboundContained) {
      throw new Error(`Contained ${placement} placement failed: ${JSON.stringify({ containedInstall, containedState })}`);
    }
    await targetWindow.webContents.executeJavaScript('window.__attuneComponentSmuggleTarget.cleanup()');
    const restored = await targetWindow.webContents.executeJavaScript(`(() => {
      const mount = document.querySelector('[data-attune-host-roles~="fixture.target"]');
      return !mount.hasAttribute('data-attune-component-smuggle-layout')
        && Math.abs(mount.getBoundingClientRect().width - 300) < 1
        && Math.abs(mount.getBoundingClientRect().height - 80) < 1;
    })()`);
    if (!restored) throw new Error(`Contained ${placement} placement did not restore the destination bounds.`);
  }
  const replaceAnchor = { ...targetAnchor, token: 'target-replace', placement: 'replace' };
  const replaceInstall = await targetWindow.webContents.executeJavaScript(
    buildComponentSmuggleTargetExpression(replaceAnchor),
  );
  await targetWindow.webContents.executeJavaScript(`window.__attuneComponentSmuggleTarget.applyVisual({
    sequence: 1,
    data: ${JSON.stringify('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XwWSJwAAAABJRU5ErkJggg==')},
    width: 120, height: 50, rootWidth: 120, rootHeight: 50, offsetX: 0, offsetY: 0,
  })`);
  await wait(20);
  const replacementState = await targetWindow.webContents.executeJavaScript(`(() => {
    const mount = document.querySelector('[data-attune-host-roles~="fixture.target"]');
    const host = document.querySelector('attune-component-smuggle');
    const status = window.__attuneComponentSmuggleTarget.status();
    return {
      placement: status.placement,
      placementLayout: status.placementLayout,
      hidden: getComputedStyle(mount).display === 'none',
      substituted: host?.nextSibling === mount && host?.parentElement === mount.parentElement,
    };
  })()`);
  await targetWindow.webContents.executeJavaScript('window.replaceTarget()');
  await wait(40);
  const reboundReplacement = await targetWindow.webContents.executeJavaScript(`(() => {
    const mount = document.querySelector('[data-attune-host-roles~="fixture.target"]');
    const host = document.querySelector('attune-component-smuggle');
    return getComputedStyle(mount).display === 'none'
      && host?.nextSibling === mount
      && window.__attuneComponentSmuggleTarget.status().placementLayout === 'replace';
  })()`);
  if (!replaceInstall.ok || replacementState.placement !== 'replace'
    || replacementState.placementLayout !== 'replace' || !replacementState.hidden
    || !replacementState.substituted || !reboundReplacement) {
    throw new Error(`Replace placement failed: ${JSON.stringify({ replaceInstall, replacementState, reboundReplacement })}`);
  }
  await targetWindow.webContents.executeJavaScript('window.__attuneComponentSmuggleTarget.cleanup()');
  const replacementRestored = await targetWindow.webContents.executeJavaScript(`(() => {
    const mount = document.querySelector('[data-attune-host-roles~="fixture.target"]');
    return getComputedStyle(mount).display !== 'none'
      && !mount.hasAttribute('data-attune-component-smuggle-layout')
      && !document.querySelector('attune-component-smuggle');
  })()`);
  if (!replacementRestored) throw new Error('Replace placement did not restore the destination component.');
  await sourceWindow.webContents.executeJavaScript('window.__attuneComponentSmuggleSource.cleanup()');
  const cleanSourceInstall = await sourceWindow.webContents.executeJavaScript(
    buildComponentSmuggleSourceExpression(sourceAnchor),
  );
  const cleanTargetInstall = await targetWindow.webContents.executeJavaScript(
    buildComponentSmuggleTargetExpression(targetAnchor),
  );
  if (!cleanSourceInstall.ok || !cleanTargetInstall.ok) throw new Error('Clean reinstall after optimistic input failed.');
  await pump();

  await targetWindow.webContents.executeJavaScript(`(() => {
    const host = document.querySelector('attune-component-smuggle');
    host.shadowRoot.querySelector('[aria-label="Increment"]').click();
  })()`);
  const actions = await targetWindow.webContents.executeJavaScript(
    'window.__attuneComponentSmuggleTarget.drainActions()',
  );
  const clickAction = actions.find((action) => action.type === 'click');
  if (!clickAction) throw new Error(`Mirror click was not captured: ${JSON.stringify(actions)}`);
  const point = await sourceWindow.webContents.executeJavaScript(
    `window.__attuneComponentSmuggleSource.clickPoint(${JSON.stringify(clickAction.path)})`,
  );
  await sourceWindow.webContents.executeJavaScript(
    `document.elementFromPoint(${point.x}, ${point.y}).click()`,
  );
  await settle(actions);
  await wait(50);
  const clickPackets = await pump();
  if (!clickPackets.some((packet) => packet.type === 'patch')
    || clickPackets.some((packet) => packet.type === 'snapshot')) {
    throw new Error(`Ordinary interaction rebuilt the complete DOM: ${JSON.stringify(clickPackets.map((packet) => packet.type))}`);
  }
  const clicked = await Promise.all([
    sourceWindow.webContents.executeJavaScript('window.sourceClicks'),
    targetWindow.webContents.executeJavaScript(`document.querySelector('attune-component-smuggle').shadowRoot.textContent`),
  ]);
  if (clicked[0] !== 1 || !clicked[1].includes('Count 1')) {
    throw new Error(`Click did not round-trip: ${JSON.stringify(clicked)}`);
  }

  const portal = await targetWindow.webContents.executeJavaScript(`(() => {
    const host = document.querySelector('attune-component-smuggle-portals');
    const action = host?.shadowRoot?.querySelector('[aria-label="Portal action"]');
    return { connected: Boolean(host?.isConnected), actionPath: action?.getAttribute('data-attune-smuggle-path') || '' };
  })()`);
  if (!portal.connected || !portal.actionPath.startsWith('-1.')) {
    throw new Error(`Owned portal was not smuggled: ${JSON.stringify(portal)}`);
  }
  await targetWindow.webContents.executeJavaScript(`
    document.querySelector('attune-component-smuggle-portals').shadowRoot.querySelector('[aria-label="Portal action"]').click()
  `);
  const portalActions = await targetWindow.webContents.executeJavaScript(
    'window.__attuneComponentSmuggleTarget.drainActions()',
  );
  const portalClick = portalActions.find((action) => action.type === 'click');
  const portalPoint = await sourceWindow.webContents.executeJavaScript(
    `window.__attuneComponentSmuggleSource.clickPoint(${JSON.stringify(portalClick.path)})`,
  );
  await sourceWindow.webContents.executeJavaScript(
    `document.elementFromPoint(${portalPoint.x}, ${portalPoint.y}).click()`,
  );
  await settle(portalActions);
  if (await sourceWindow.webContents.executeJavaScript('window.portalClicks') !== 1) {
    throw new Error('Portal interaction did not round-trip.');
  }

  await targetWindow.webContents.executeJavaScript(`(() => {
    const shadow = document.querySelector('attune-component-smuggle').shadowRoot;
    const editor = shadow.querySelector('[aria-label="Editor"]');
    window.fixtureShadow = shadow;
    window.fixtureEditor = editor;
    editor.__attuneIdentity = 'preserved';
    editor.focus();
    const selection = shadow.getSelection();
    selection.setBaseAndExtent(editor.firstChild, 2, editor.firstChild, 2);
    editor.dispatchEvent(new InputEvent('beforeinput', {
      bubbles: true, composed: true, inputType: 'insertText', data: 'x', cancelable: true,
    }));
    editor.firstChild.nodeValue = 'Drxaft';
    selection.setBaseAndExtent(editor.firstChild, 3, editor.firstChild, 3);
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: 'x' }));
  })()`);
  const editActions = await targetWindow.webContents.executeJavaScript(
    'window.__attuneComponentSmuggleTarget.drainActions()',
  );
  await sourceWindow.webContents.executeJavaScript(
    `window.__attuneComponentSmuggleSource.applyActions(${JSON.stringify(editActions)})`,
  );
  await settle(editActions);
  await wait(50);
  await pump();
  const editState = await Promise.all([
    sourceWindow.webContents.executeJavaScript(`(() => {
      const editor = document.querySelector('[aria-label="Editor"]');
      const selection = document.getSelection();
      return { text: editor.textContent, events: window.sourceInputEvents, caret: selection.anchorOffset };
    })()`),
    targetWindow.webContents.executeJavaScript(`(() => {
      const shadow = document.querySelector('attune-component-smuggle').shadowRoot;
      const editor = shadow.querySelector('[aria-label="Editor"]');
      const selection = shadow.getSelection();
      return {
        text: editor.textContent,
        focused: shadow.activeElement?.getAttribute('aria-label'),
        caret: selection.anchorOffset,
        identity: editor.__attuneIdentity,
      };
    })()`),
  ]);
  if (editState[0].text !== 'Drxaft' || editState[0].events !== 1 || editState[0].caret !== 3
    || editState[1].text !== 'Drxaft' || editState[1].focused !== 'Editor'
    || editState[1].caret !== 3 || editState[1].identity !== 'preserved') {
    throw new Error(`Editable state did not round-trip: ${JSON.stringify(editState)}`);
  }

  const formattingPrevented = await targetWindow.webContents.executeJavaScript(`(() => {
    const shadow = document.querySelector('attune-component-smuggle').shadowRoot;
    const editor = shadow.querySelector('[aria-label="Editor"]');
    editor.focus();
    const boldResult = editor.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'b', code: 'KeyB', metaKey: true, bubbles: true, composed: true, cancelable: true,
    }));
    const italicResult = editor.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'i', code: 'KeyI', metaKey: true, bubbles: true, composed: true, cancelable: true,
    }));
    return { boldResult, italicResult };
  })()`);
  const formattingActions = await targetWindow.webContents.executeJavaScript(
    'window.__attuneComponentSmuggleTarget.drainActions()',
  );
  if (formattingPrevented.boldResult || formattingPrevented.italicResult
    || formattingActions.filter((action) => action.type === 'shortcut').length !== 2
    || formattingActions.map((action) => action.code).join(',') !== 'KeyB,KeyI') {
    throw new Error(`App shortcuts were not captured generically: ${JSON.stringify({ formattingPrevented, formattingActions })}`);
  }
  for (const action of formattingActions) {
    await sourceWindow.webContents.executeJavaScript(
      `window.__attuneComponentSmuggleSource.focusPath(${JSON.stringify(action.path)}, ${JSON.stringify(action.selectionBefore)})`,
    );
    await sourceWindow.webContents.executeJavaScript(
      `document.querySelector('[aria-label="Editor"]').dispatchEvent(new KeyboardEvent('keydown', ${JSON.stringify({
        key: action.key,
        code: action.code,
        altKey: action.altKey,
        ctrlKey: action.ctrlKey,
        metaKey: action.metaKey,
        shiftKey: action.shiftKey,
        bubbles: true,
        composed: true,
      })}))`,
    );
  }
  await settle(formattingActions);
  await pump();
  const formattingState = await Promise.all([
    sourceWindow.webContents.executeJavaScript(`({
      bold: document.querySelector('[aria-label="Bold"]')?.getAttribute('aria-pressed') === 'true',
      italic: document.querySelector('[aria-label="Italic"]')?.getAttribute('aria-pressed') === 'true',
      keydowns: window.sourceShortcutKeydowns,
    })`),
    targetWindow.webContents.executeJavaScript(`(() => {
      const shadow = document.querySelector('attune-component-smuggle').shadowRoot;
      return {
        bold: shadow.querySelector('[aria-label="Bold"]')?.getAttribute('aria-pressed') === 'true',
        italic: shadow.querySelector('[aria-label="Italic"]')?.getAttribute('aria-pressed') === 'true',
        focused: shadow.activeElement?.getAttribute('aria-label') === 'Editor',
        identity: shadow.querySelector('[aria-label="Editor"]')?.__attuneIdentity === 'preserved',
      };
    })()`),
  ]);
  if (!formattingState[0].bold || !formattingState[0].italic || formattingState[0].keydowns !== 2
    || !formattingState[1].bold || !formattingState[1].italic
    || !formattingState[1].focused || !formattingState[1].identity) {
    throw new Error(`Formatting state did not reconcile: ${JSON.stringify(formattingState)}`);
  }

  await targetWindow.webContents.executeJavaScript(`(() => {
    const shadow = document.querySelector('attune-component-smuggle').shadowRoot;
    const editor = shadow.querySelector('[aria-label="Editor"]');
    editor.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'b', code: 'KeyB', metaKey: true, bubbles: true, composed: true, cancelable: true,
    }));
    editor.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'b', code: 'KeyB', metaKey: true, bubbles: true, composed: true, cancelable: true,
    }));
  })()`);
  const repeatedFormattingActions = await targetWindow.webContents.executeJavaScript(
    'window.__attuneComponentSmuggleTarget.drainActions()',
  );
  if (repeatedFormattingActions.length !== 2
    || repeatedFormattingActions.some((action) => action.type !== 'shortcut' || action.code !== 'KeyB')) {
    throw new Error(`Repeated formatting was not captured semantically: ${JSON.stringify(repeatedFormattingActions)}`);
  }
  for (const action of repeatedFormattingActions) {
    await sourceWindow.webContents.executeJavaScript(
      `document.querySelector('[aria-label="Editor"]').dispatchEvent(new KeyboardEvent('keydown', ${JSON.stringify({
        key: action.key,
        code: action.code,
        altKey: action.altKey,
        ctrlKey: action.ctrlKey,
        metaKey: action.metaKey,
        shiftKey: action.shiftKey,
        bubbles: true,
        composed: true,
      })}))`,
    );
  }
  await settle(repeatedFormattingActions);
  await pump();
  const repeatedFormattingState = await Promise.all([
    sourceWindow.webContents.executeJavaScript(`({
      bold: document.querySelector('[aria-label="Bold"]')?.getAttribute('aria-pressed') === 'true',
      italic: document.querySelector('[aria-label="Italic"]')?.getAttribute('aria-pressed') === 'true',
      keydowns: window.sourceShortcutKeydowns,
    })`),
    targetWindow.webContents.executeJavaScript(`(() => {
      const shadow = document.querySelector('attune-component-smuggle').shadowRoot;
      return {
        bold: shadow.querySelector('[aria-label="Bold"]')?.getAttribute('aria-pressed') === 'true',
        italic: shadow.querySelector('[aria-label="Italic"]')?.getAttribute('aria-pressed') === 'true',
      };
    })()`),
  ]);
  if (!repeatedFormattingState[0].bold || !repeatedFormattingState[0].italic
    || repeatedFormattingState[0].keydowns !== 4
    || !repeatedFormattingState[1].bold || !repeatedFormattingState[1].italic) {
    throw new Error(`Repeated formatting state diverged: ${JSON.stringify(repeatedFormattingState)}`);
  }

  await sourceWindow.webContents.executeJavaScript('window.replaceSource()');
  await targetWindow.webContents.executeJavaScript('window.replaceTarget()');
  await wait(80);
  await pump();
  const rebound = await targetWindow.webContents.executeJavaScript(`(() => {
    const mount = document.querySelector('[data-attune-host-roles~="fixture.target"]');
    const host = mount.querySelector('attune-component-smuggle');
    return { hostReattached: Boolean(host), text: host?.shadowRoot?.textContent || '' };
  })()`);
  if (!rebound.hostReattached || !rebound.text.includes('Rebound card')) {
    throw new Error(`Semantic re-resolution failed: ${JSON.stringify(rebound)}`);
  }

  const captureSourceState = await sourceWindow.webContents.executeJavaScript(`({
    region: window.__attuneComponentSmuggleSource.captureRegion(),
    point: window.__attuneComponentSmuggleSource.capturePoint({ xRatio: 0.25, yRatio: 0.75 }),
    hoverPoint: window.__attuneComponentSmuggleSource.hoverPoint({ xRatio: 0.25, yRatio: 0.75 }),
    hoverLeavePoint: window.__attuneComponentSmuggleSource.hoverPoint(null),
  })`);
  if (!(captureSourceState.region?.width > 0) || !(captureSourceState.region?.height > 0)
    || !Number.isFinite(captureSourceState.point?.x) || !Number.isFinite(captureSourceState.hoverPoint?.x)
    || !Number.isFinite(captureSourceState.hoverLeavePoint?.x)) {
    throw new Error(`Source capture controls were unavailable: ${JSON.stringify(captureSourceState)}`);
  }

  await sourceWindow.webContents.executeJavaScript(`(() => {
    const unrelated = document.createElement('div');
    unrelated.setAttribute('data-fixture-unrelated-editor-line', 'true');
    unrelated.style.cssText = 'position:absolute;left:420px;top:120px;width:160px;height:18px;z-index:100';
    document.body.appendChild(unrelated);
  })()`);
  await wait(30);
  await pump();
  const unrelatedSatelliteLeaked = await targetWindow.webContents.executeJavaScript(`Boolean(
    document.querySelector('attune-component-smuggle-portals').shadowRoot
      .querySelector('[data-fixture-unrelated-editor-line]')
  )`);
  await sourceWindow.webContents.executeJavaScript(`document.querySelector('[data-fixture-unrelated-editor-line]')?.remove()`);
  if (unrelatedSatelliteLeaked) throw new Error('Unrelated absolute source content leaked into the smuggled satellites.');

  const visualState = await targetWindow.webContents.executeJavaScript(`(() => {
    const api = window.__attuneComponentSmuggleTarget;
    api.applyVisual({ sequence: 1, data: ${JSON.stringify('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XwWSJwAAAABJRU5ErkJggg==')}, width: 800, height: 120, rootWidth: 800, rootHeight: 120, offsetX: 0, offsetY: 0 });
    const shadow = document.querySelector('attune-component-smuggle').shadowRoot;
    const portalShadow = document.querySelector('attune-component-smuggle-portals').shadowRoot;
    const viewport = shadow.querySelector('[data-attune-component-smuggle="visual-viewport"]');
    const relay = portalShadow.querySelector('[data-attune-component-smuggle="input-relay"]');
    relay.__attuneIdentity = 'preserved';
    viewport.dispatchEvent(new PointerEvent('pointermove', { clientX: 200, clientY: 40, bubbles: true, composed: true }));
    viewport.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 20, clientY: 20, bubbles: true, composed: true, cancelable: true }));
    const destinationWheelAllowed = viewport.dispatchEvent(new WheelEvent('wheel', {
      clientX: 200, clientY: 40, deltaX: 2, deltaY: 3, deltaMode: WheelEvent.DOM_DELTA_LINE,
      bubbles: true, composed: true, cancelable: true,
    }));
    relay.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', code: 'KeyB', metaKey: true, bubbles: true, composed: true, cancelable: true }));
    relay.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: 'x', bubbles: true, composed: true, cancelable: true }));
    viewport.dispatchEvent(new PointerEvent('pointerleave', { clientX: 900, clientY: 40, composed: true }));
    api.applyVisual({ sequence: 2, data: ${JSON.stringify('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XwWSJwAAAABJRU5ErkJggg==')}, width: 800, height: 120, rootWidth: 800, rootHeight: 120, offsetX: 0, offsetY: 0 });
    return {
      rendering: api.status().rendering,
      image: shadow.querySelector('[data-attune-component-smuggle="visual-frame"]')?.src.startsWith('data:image/png;base64,'),
      interactionTwin: Boolean(shadow.querySelector('[data-attune-component-smuggle="frame"]')),
      interactionTwinInvisible: shadow.querySelector('[data-attune-component-smuggle="frame"]')?.style.opacity === '0',
      interactionTwinPassive: shadow.querySelector('[data-attune-component-smuggle="frame"]')?.style.pointerEvents === 'none',
      pixelsReceivePointers: viewport.style.pointerEvents === 'auto',
      fullSize: Math.round(viewport.getBoundingClientRect().width) === 800
        && Math.round(viewport.getBoundingClientRect().height) === 120
        && !viewport.style.transform.includes('scale'),
      relayPreserved: portalShadow.querySelector('[data-attune-component-smuggle="input-relay"]')?.__attuneIdentity === 'preserved',
      destinationWheelAllowed,
      actions: api.drainActions(),
    };
  })()`);
  const visualActionTypes = visualState.actions.map((action) => action.type).join(',');
  const visualWheel = visualState.actions.find((action) => action.type === 'visual-wheel');
  if (visualState.rendering !== 'source-capture' || !visualState.image || !visualState.fullSize || !visualState.relayPreserved
    || !visualState.interactionTwin || !visualState.interactionTwinInvisible || !visualState.interactionTwinPassive
    || !visualState.pixelsReceivePointers
    || visualState.destinationWheelAllowed
    || visualActionTypes !== 'visual-hover,visual-click,visual-wheel,visual-key,visual-edit,visual-hover'
    || visualWheel?.deltaX !== 32 || visualWheel?.deltaY !== 48
    || !(visualState.actions[0]?.position?.xRatio > 0) || visualState.actions.at(-1)?.position !== null) {
    throw new Error(`Source-rendered capture did not preserve its input relay: ${JSON.stringify(visualState)}`);
  }

  await wait(45);
  const retainedRelayState = await targetWindow.webContents.executeJavaScript(`(() => {
    const portals = document.querySelector('attune-component-smuggle-portals');
    const relay = portals.shadowRoot.querySelector('[data-attune-component-smuggle="input-relay"]');
    const status = window.__attuneComponentSmuggleTarget.status();
    return {
      relayFocused: document.activeElement === portals && portals.shadowRoot.activeElement === relay,
      documentActive: document.activeElement?.tagName,
      portalActive: portals.shadowRoot.activeElement?.tagName,
      remoteInputActive: status.remoteInputActive,
      remoteInputFocused: status.remoteInputFocused,
      marker: document.documentElement.getAttribute('data-attune-smuggle-input-active'),
    };
  })()`);
  if (!retainedRelayState.relayFocused || !retainedRelayState.remoteInputActive
    || !retainedRelayState.remoteInputFocused || retainedRelayState.marker !== 'true') {
    throw new Error(`The destination app stole focus back from the visual input relay: ${JSON.stringify(retainedRelayState)}`);
  }

  targetWindow.webContents.debugger.attach('1.3');
  let rawRemoteActions;
  let rawRemoteRelayFocused;
  let interactionTwinFocused;
  let coveredEditorValue;
  try {
    const coveredEditorPoint = await targetWindow.webContents.executeJavaScript(`(() => {
      const cover = document.querySelector('attune-component-smuggle').shadowRoot.querySelector('[data-fixture-editor-cover]');
      const bounds = cover.getBoundingClientRect();
      return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    })()`);
    await targetWindow.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: coveredEditorPoint.x, y: coveredEditorPoint.y,
      button: 'left', buttons: 1, clickCount: 1, pointerType: 'mouse',
    });
    await targetWindow.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: coveredEditorPoint.x, y: coveredEditorPoint.y,
      button: 'left', buttons: 0, clickCount: 1, pointerType: 'mouse',
    });
    await wait(45);
    const rawRemoteFocus = await targetWindow.webContents.executeJavaScript(`(() => {
      const shadow = document.querySelector('attune-component-smuggle').shadowRoot;
      const portals = document.querySelector('attune-component-smuggle-portals');
      return {
        relay: document.activeElement === portals
          && portals.shadowRoot.activeElement?.getAttribute('data-attune-component-smuggle') === 'input-relay',
        twin: shadow.activeElement?.getAttribute('aria-label') === 'Covered editor',
      };
    })()`);
    rawRemoteRelayFocused = rawRemoteFocus.relay;
    interactionTwinFocused = rawRemoteFocus.twin;
    await targetWindow.webContents.debugger.sendCommand('Input.insertText', { text: 'z' });
    await wait(20);
    coveredEditorValue = await targetWindow.webContents.executeJavaScript(`(() => {
      const shadow = document.querySelector('attune-component-smuggle').shadowRoot;
      return shadow.querySelector('[aria-label="Covered editor"]')?.value;
    })()`);
    rawRemoteActions = await targetWindow.webContents.executeJavaScript(
      'window.__attuneComponentSmuggleTarget.drainActions()',
    );
  } finally {
    targetWindow.webContents.debugger.detach();
  }
  const rawRemoteClick = rawRemoteActions.find((action) => action.type === 'visual-click');
  const rawRemoteInput = rawRemoteActions.find((action) => action.type === 'visual-edit');
  if (!rawRemoteRelayFocused || interactionTwinFocused || !rawRemoteClick?.trusted
    || !rawRemoteInput?.trusted || rawRemoteInput.data !== 'z' || coveredEditorValue !== 'Seed'
    || rawRemoteActions.some((action) => action.type === 'click' || action.type === 'input')) {
    throw new Error(`Source-rendered input used the DOM twin instead of raw remote input: ${JSON.stringify({ rawRemoteRelayFocused, interactionTwinFocused, coveredEditorValue, rawRemoteActions })}`);
  }

  sourceWindow.webContents.debugger.attach('1.3');
  let rawSourceResult;
  let editContextResult;
  let nestedEditContextResult;
  try {
    const sourcePoint = await sourceWindow.webContents.executeJavaScript(
      `window.__attuneComponentSmuggleSource.capturePoint(${JSON.stringify(rawRemoteClick.position)})`,
    );
    await sourceWindow.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: sourcePoint.x, y: sourcePoint.y,
      button: 'left', buttons: 1, clickCount: 1, pointerType: 'mouse',
    });
    await sourceWindow.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: sourcePoint.x, y: sourcePoint.y,
      button: 'left', buttons: 0, clickCount: 1, pointerType: 'mouse',
    });
    await sourceWindow.webContents.debugger.sendCommand('Input.insertText', { text: rawRemoteInput.data });
    rawSourceResult = await sourceWindow.webContents.executeJavaScript(`(() => {
      const editor = document.querySelector('[aria-label="Covered editor"]');
      const root = document.querySelector('[data-attune-host-roles~="fixture.source"]')?.getBoundingClientRect();
      const cover = document.querySelector('[data-fixture-editor-cover]')?.getBoundingClientRect();
      return {
        focused: document.activeElement === editor,
        value: editor.value,
        sourcePoint: ${JSON.stringify(sourcePoint)},
        remotePosition: ${JSON.stringify(rawRemoteClick.position)},
        hit: document.elementFromPoint(${JSON.stringify(sourcePoint.x)}, ${JSON.stringify(sourcePoint.y)})?.getAttribute?.('data-fixture-editor-cover') !== null,
        root: root && { x: root.x, y: root.y, width: root.width, height: root.height },
        cover: cover && { x: cover.x, y: cover.y, width: cover.width, height: cover.height },
      };
    })()`);
    const editContextSetup = await sourceWindow.webContents.executeJavaScript(`(() => {
      const host = document.createElement('div');
      host.id = 'fixture-edit-context';
      host.tabIndex = 0;
      host.setAttribute('role', 'textbox');
      host.editContext = new EditContext({ text: 'Seed', selectionStart: 4, selectionEnd: 4 });
      document.querySelector('[data-attune-host-roles~="fixture.source"]').append(host);
      host.focus({ preventScroll: true });
      return window.__attuneComponentSmuggleSource.focusActiveEditable();
    })()`);
    await sourceWindow.webContents.debugger.sendCommand('Input.insertText', { text: 'x' });
    editContextResult = await sourceWindow.webContents.executeJavaScript(`(() => {
      const host = document.getElementById('fixture-edit-context');
      return {
        recognized: ${JSON.stringify(editContextSetup)},
        focused: document.activeElement === host,
        text: host.editContext.text,
      };
    })()`);
    const nestedEditContextSetup = await sourceWindow.webContents.executeJavaScript(`(() => {
      const frame = document.createElement('iframe');
      frame.id = 'fixture-nested-edit-context-frame';
      frame.style.cssText = 'position:absolute;left:0;top:-10000px;width:625px;height:1px';
      document.body.append(frame);
      const host = frame.contentDocument.createElement('div');
      host.tabIndex = 0;
      host.setAttribute('role', 'textbox');
      host.setAttribute('contenteditable', 'true');
      host.editContext = new EditContext({ text: 'Nested', selectionStart: 6, selectionEnd: 6 });
      frame.contentDocument.body.append(host);
      host.focus({ preventScroll: true });
      return {
        topActiveIsFrame: document.activeElement === frame,
        focused: window.__attuneComponentSmuggleSource.focusActiveEditable(),
      };
    })()`);
    await sourceWindow.webContents.debugger.sendCommand('Input.insertText', { text: 'y' });
    nestedEditContextResult = await sourceWindow.webContents.executeJavaScript(`(() => {
      const frame = document.getElementById('fixture-nested-edit-context-frame');
      const host = frame.contentDocument.activeElement;
      return {
        setup: ${JSON.stringify(nestedEditContextSetup)},
        innerFocused: host?.getAttribute('role') === 'textbox',
        text: host?.editContext?.text,
      };
    })()`);
  } finally {
    await sourceWindow.webContents.executeJavaScript(`(() => {
      document.getElementById('fixture-edit-context')?.remove();
      document.getElementById('fixture-nested-edit-context-frame')?.remove();
      document.querySelector('[aria-label="Covered editor"]').value = 'Seed';
      window.__attuneComponentSmuggleSource.drain();
    })()`);
    sourceWindow.webContents.debugger.detach();
  }
  if (!rawSourceResult.focused || rawSourceResult.value !== 'zSeed') {
    throw new Error(`Raw input did not reach the source's actual focused control: ${JSON.stringify(rawSourceResult)}`);
  }
  if (!editContextResult.recognized?.ok || !editContextResult.recognized?.editContext
    || !editContextResult.focused || editContextResult.text !== 'Seedx') {
    throw new Error(`Raw input did not recognize a Chromium EditContext host: ${JSON.stringify(editContextResult)}`);
  }
  if (!nestedEditContextResult.setup?.topActiveIsFrame || !nestedEditContextResult.setup?.focused?.ok
    || !nestedEditContextResult.setup?.focused?.nestedDocument
    || !nestedEditContextResult.setup?.focused?.editContext || !nestedEditContextResult.innerFocused
    || nestedEditContextResult.text !== 'Nestedy') {
    throw new Error(`Raw input did not reach an editable inside a focused iframe: ${JSON.stringify(nestedEditContextResult)}`);
  }

  targetWindow.webContents.debugger.attach('1.3');
  let trustedTypingActions;
  try {
    await targetWindow.webContents.executeJavaScript(`(() => {
      const relay = document.querySelector('attune-component-smuggle-portals').shadowRoot
        .querySelector('[data-attune-component-smuggle="input-relay"]');
      relay.focus();
      return relay === document.querySelector('attune-component-smuggle-portals').shadowRoot.activeElement;
    })()`);
    await targetWindow.webContents.debugger.sendCommand('Input.insertText', { text: 'z' });
    await wait(20);
    trustedTypingActions = await targetWindow.webContents.executeJavaScript(
      'window.__attuneComponentSmuggleTarget.drainActions()',
    );
  } finally {
    targetWindow.webContents.debugger.detach();
  }
  const trustedTyping = trustedTypingActions.find((action) => action.type === 'visual-edit');
  if (!trustedTyping?.trusted || trustedTyping.data !== 'z' || trustedTyping.inputType !== 'insertText') {
    throw new Error(`Trusted text input did not reach the visual relay: ${JSON.stringify(trustedTypingActions)}`);
  }

  const resizePickerResultPromise = targetWindow.webContents.executeJavaScript(
    buildElementPickerExpression(
      'Fixture target',
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XwWSJwAAAABJRU5ErkJggg==',
    ),
  );
  await wait(180);
  const resizeSetup = await targetWindow.webContents.executeJavaScript(`(() => {
    const api = window.__attuneComponentSmuggleTarget;
    const portal = document.querySelector('attune-component-smuggle-portals').shadowRoot;
    const controls = portal.querySelector('[data-attune-component-smuggle="resize-controls"]');
    const handles = [...portal.querySelectorAll('[data-attune-smuggle-resize-handle]')];
    const northwest = portal.querySelector('[data-attune-smuggle-resize-handle="nw"]');
    const hostBounds = document.querySelector('attune-component-smuggle').getBoundingClientRect();
    return {
      before: api.status(),
      handleCount: handles.length,
      controlsVisible: getComputedStyle(controls).visibility === 'visible'
        && getComputedStyle(northwest).pointerEvents === 'auto',
      point: { x: hostBounds.left, y: hostBounds.top },
    };
  })()`);
  targetWindow.webContents.debugger.attach('1.3');
  try {
    await targetWindow.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: resizeSetup.point.x, y: resizeSetup.point.y,
      button: 'left', buttons: 1, clickCount: 1, pointerType: 'mouse',
    });
    await targetWindow.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: resizeSetup.point.x + 160, y: resizeSetup.point.y + 60,
      button: 'left', buttons: 1, pointerType: 'mouse',
    });
    await targetWindow.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: resizeSetup.point.x + 160, y: resizeSetup.point.y + 60,
      button: 'left', buttons: 0, clickCount: 1, pointerType: 'mouse',
    });
  } finally {
    targetWindow.webContents.debugger.detach();
  }
  const resizedState = await targetWindow.webContents.executeJavaScript(`(() => {
    const api = window.__attuneComponentSmuggleTarget;
    const viewport = document.querySelector('attune-component-smuggle').shadowRoot
      .querySelector('[data-attune-component-smuggle="visual-viewport"]');
    const resizedBounds = viewport.getBoundingClientRect();
    viewport.dispatchEvent(new PointerEvent('pointermove', {
      clientX: resizedBounds.left + resizedBounds.width * 0.25,
      clientY: resizedBounds.top + resizedBounds.height * 0.75,
      bubbles: true, composed: true,
    }));
    const after = api.status();
    const hover = api.drainActions().find((action) => action.type === 'visual-hover');
    return {
      after,
      viewport: { width: resizedBounds.width, height: resizedBounds.height },
      image: (() => {
        const bounds = viewport.querySelector('[data-attune-component-smuggle="visual-frame"]').getBoundingClientRect();
        return { width: bounds.width, height: bounds.height };
      })(),
      hover,
      pickerFrameHidden: getComputedStyle(document.querySelector('[data-attune-element-picker="freeze"]')).display === 'none',
    };
  })()`);
  if (resizeSetup.handleCount !== 8 || !resizeSetup.controlsVisible || !resizedState.pickerFrameHidden
    || resizeSetup.before.sourceSize.width !== 800 || resizeSetup.before.sourceSize.height !== 120
    || Math.round(resizedState.after.viewSize.width) !== 640 || Math.round(resizedState.after.viewSize.height) !== 60
    || resizedState.after.sourceSize.width !== 800 || resizedState.after.sourceSize.height !== 120
    || !resizedState.after.customSize || resizedState.after.resizing
    || Math.round(resizedState.after.viewOffset.x) !== 160 || Math.round(resizedState.after.viewOffset.y) !== 60
    || Math.round(resizedState.viewport.width) !== 640 || Math.round(resizedState.viewport.height) !== 60
    || Math.round(resizedState.image.width) !== 640 || Math.round(resizedState.image.height) !== 60
    || Math.abs(resizedState.hover?.position?.xRatio - 0.25) > 0.001
    || Math.abs(resizedState.hover?.position?.yRatio - 0.75) > 0.001) {
    throw new Error(`Select-mode custom resize failed: ${JSON.stringify(resizedState)}`);
  }
  await targetWindow.webContents.executeJavaScript(`window.__attuneElementPickerCleanup('fixture-resize')`);
  const resizePickerResult = JSON.parse(await resizePickerResultPromise);
  await wait(160);
  const resetResizeState = await targetWindow.webContents.executeJavaScript(`(() => {
    const api = window.__attuneComponentSmuggleTarget;
    const reset = api.resetSize();
    const portal = document.querySelector('attune-component-smuggle-portals').shadowRoot;
    const controls = portal.querySelector('[data-attune-component-smuggle="resize-controls"]');
    const handle = portal.querySelector('[data-attune-smuggle-resize-handle="se"]');
    return {
      reset,
      status: api.status(),
      controlsVisibility: getComputedStyle(controls).visibility,
      handlePointerEvents: getComputedStyle(handle).pointerEvents,
    };
  })()`);
  if (resizePickerResult.status !== 'cancelled'
    || Math.round(resetResizeState.reset.width) !== 800 || Math.round(resetResizeState.reset.height) !== 120
    || resetResizeState.status.customSize || resetResizeState.status.viewOffset.x !== 0 || resetResizeState.status.viewOffset.y !== 0
    || resetResizeState.controlsVisibility !== 'hidden' || resetResizeState.handlePointerEvents !== 'none') {
    throw new Error(`Custom resize did not reset cleanly: ${JSON.stringify({ resizePickerResult, resetResizeState })}`);
  }

  const normalCloseState = await targetWindow.webContents.executeJavaScript(`(() => {
    const close = document.querySelector('attune-component-smuggle').shadowRoot.querySelector('[aria-label="Stop component smuggling"]');
    const styles = getComputedStyle(close);
    return { visibility: styles.visibility, opacity: styles.opacity, pointerEvents: styles.pointerEvents, tabIndex: close.tabIndex };
  })()`);
  if (normalCloseState.visibility !== 'hidden' || normalCloseState.opacity !== '0'
    || normalCloseState.pointerEvents !== 'none' || normalCloseState.tabIndex !== -1) {
    throw new Error(`Close control was distracting outside picker mode: ${JSON.stringify(normalCloseState)}`);
  }
  const closePickerResultPromise = targetWindow.webContents.executeJavaScript(
    buildElementPickerExpression('Fixture target'),
  );
  await wait(180);
  const pickerCloseState = await targetWindow.webContents.executeJavaScript(`(() => {
    const close = document.querySelector('attune-component-smuggle').shadowRoot.querySelector('[aria-label="Stop component smuggling"]');
    const styles = getComputedStyle(close);
    return { visibility: styles.visibility, opacity: styles.opacity, pointerEvents: styles.pointerEvents, tabIndex: close.tabIndex };
  })()`);
  if (pickerCloseState.visibility !== 'visible' || pickerCloseState.opacity !== '1'
    || pickerCloseState.pointerEvents !== 'auto' || pickerCloseState.tabIndex !== 0) {
    throw new Error(`Close control did not appear in picker mode: ${JSON.stringify(pickerCloseState)}`);
  }
  await targetWindow.webContents.executeJavaScript(`
    document.querySelector('attune-component-smuggle').shadowRoot.querySelector('[aria-label="Stop component smuggling"]').click()
  `);
  const closePickerResult = JSON.parse(await closePickerResultPromise);
  await wait(20);
  const closed = await targetWindow.webContents.executeJavaScript(`({
    hostConnected: Boolean(document.querySelector('attune-component-smuggle')),
    actions: window.__attuneComponentSmuggleTarget.drainActions(),
  })`);
  if (closePickerResult.status !== 'cancelled' || closed.hostConnected
    || !closed.actions.some((action) => action.type === 'close')) {
    throw new Error(`Close control did not stay closed: ${JSON.stringify(closed)}`);
  }

  await Promise.all([
    sourceWindow.webContents.executeJavaScript('window.__attuneComponentSmuggleSource.cleanup()'),
    targetWindow.webContents.executeJavaScript('window.__attuneComponentSmuggleTarget.cleanup()'),
  ]);
  sourceWindow.destroy();
  targetWindow.destroy();
}

app.whenReady().then(async () => {
  try {
    await run();
    console.log('component-smuggler-ok');
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
