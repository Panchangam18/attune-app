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
      </style></head><body>
        <section data-attune-host-roles="fixture.source" data-attune-smuggle-anchor="source-token">
          <strong>Live card <span role="textbox" contenteditable="true" aria-label="Editor">Draft</span></strong><button aria-label="Increment"><svg viewBox="0 0 16 16"><path fill-rule="evenodd" d="M2 7h12v2H2z"/></svg>Count 0</button>
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
          const wire = (root) => root.querySelector('button').addEventListener('click', () => {
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
          <main style="width:300px;height:80px;flex:0 0 auto" data-attune-host-roles="fixture.target" data-attune-smuggle-anchor="target-token">
            <div data-fixture-target-content style="width:120px;height:40px">Target content</div>
          </main>
        </div>
        <script>
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
    return packets.length;
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
        };
      })(),
    };
  })()`);
  if (!initial.connected || !initial.text.includes('Live card') || !initial.text.includes('Ready') || !initial.buttonPath
    || !initial.layout.fullSize || !initial.layout.namedGridPlacement || initial.layout.viewBox !== '0 0 16 16') {
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
  await pump();
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

  const visualState = await targetWindow.webContents.executeJavaScript(`(() => {
    const api = window.__attuneComponentSmuggleTarget;
    api.applyVisual({ sequence: 1, data: ${JSON.stringify('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XwWSJwAAAABJRU5ErkJggg==')}, width: 800, height: 120, rootWidth: 800, rootHeight: 120, offsetX: 0, offsetY: 0 });
    const shadow = document.querySelector('attune-component-smuggle').shadowRoot;
    const viewport = shadow.querySelector('[data-attune-component-smuggle="visual-viewport"]');
    const relay = shadow.querySelector('[data-attune-component-smuggle="input-relay"]');
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
      fullSize: Math.round(viewport.getBoundingClientRect().width) === 800
        && Math.round(viewport.getBoundingClientRect().height) === 120
        && !viewport.style.transform.includes('scale'),
      relayPreserved: shadow.querySelector('[data-attune-component-smuggle="input-relay"]')?.__attuneIdentity === 'preserved',
      destinationWheelAllowed,
      actions: api.drainActions(),
    };
  })()`);
  const visualActionTypes = visualState.actions.map((action) => action.type).join(',');
  const visualWheel = visualState.actions.find((action) => action.type === 'visual-wheel');
  if (visualState.rendering !== 'source-capture' || !visualState.image || !visualState.fullSize || !visualState.relayPreserved
    || visualState.destinationWheelAllowed
    || visualActionTypes !== 'visual-hover,visual-click,visual-wheel,visual-key,visual-edit,visual-hover'
    || visualWheel?.deltaX !== 32 || visualWheel?.deltaY !== 48
    || !(visualState.actions[0]?.position?.xRatio > 0) || visualState.actions.at(-1)?.position !== null) {
    throw new Error(`Source-rendered capture did not preserve its input relay: ${JSON.stringify(visualState)}`);
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
