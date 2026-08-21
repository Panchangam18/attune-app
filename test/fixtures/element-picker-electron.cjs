const { app, BrowserWindow } = require('electron');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

async function run() {
  const pickerModuleUrl = pathToFileURL(join(__dirname, '..', '..', 'dist-electron', 'element-picker.js')).href;
  const { buildElementPickerExpression } = await import(pickerModuleUrl);
  const window = new BrowserWindow({
    show: false,
    width: 720,
    height: 480,
    webPreferences: { backgroundThrottling: false },
  });
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
    <!doctype html>
    <html>
      <head>
        <style>
          body { margin: 0; font: 16px sans-serif; }
          body > div { display: none; }
          header { padding: 30px; }
          @keyframes pulse { from { opacity: .8; } to { opacity: 1; } }
          button { width: 180px; height: 48px; color: rgb(250, 250, 250); background: rgb(40, 40, 40); border-radius: 8px; animation: pulse 2s infinite alternate; }
        </style>
      </head>
      <body>
        <header aria-label="Chat header">
          <button aria-label="Toggle sidebar" data-attune-host-roles="codex.sidebarToggle"><span>Toggle</span></button>
        </header>
        <script>
          window.hostClicks = 0;
          window.hostPointerMoves = 0;
          window.hostKeys = 0;
          window.hostWheels = 0;
          document.querySelector('button').addEventListener('click', () => { window.hostClicks += 1; });
          document.querySelector('button').addEventListener('pointermove', () => { window.hostPointerMoves += 1; });
          document.addEventListener('keydown', () => { window.hostKeys += 1; });
          document.addEventListener('wheel', () => { window.hostWheels += 1; });
        </script>
      </body>
    </html>
  `)}`);

  const frozenFrame = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X4f6WQAAAABJRU5ErkJggg==';
  const pickerResult = window.webContents.executeJavaScript(buildElementPickerExpression('Codex', frozenFrame));
  await new Promise((resolve) => setTimeout(resolve, 80));
  const pickerVisible = await window.webContents.executeJavaScript(
    `Boolean(document.querySelector('[data-attune-element-picker="outline"]'))
      && Boolean(document.querySelector('[data-attune-element-picker="freeze"]'))
      && document.documentElement.getAttribute('data-attune-element-picker-active') === 'true'
      && getComputedStyle(document.querySelector('[data-attune-element-picker="outline"]')).display === 'block'
      && getComputedStyle(document.querySelector('[data-attune-element-picker="label"]')).display === 'block'
      && getComputedStyle(document.querySelector('button')).animationPlayState === 'paused'`,
  );
  if (!pickerVisible) throw new Error('The picker overlay was not installed.');

  const hierarchyNavigation = await window.webContents.executeJavaScript(`(() => {
    const span = document.querySelector('button span');
    const bounds = span.getBoundingClientRect();
    span.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true,
      composed: true,
      clientX: bounds.x + bounds.width / 2,
      clientY: bounds.y + bounds.height / 2,
    }));
    const label = document.querySelector('[data-attune-element-picker="label"]');
    const before = label.textContent;
    const movedUp = window.__attuneElementPickerCommand?.('up');
    const afterUp = label.textContent;
    const movedDown = window.__attuneElementPickerCommand?.('down');
    const afterDown = label.textContent;
    return { before, movedUp, afterUp, movedDown, afterDown };
  })()`);
  if (!hierarchyNavigation.movedUp || !hierarchyNavigation.afterUp.includes('<header>')) {
    throw new Error(`Picker did not navigate to the parent: ${JSON.stringify(hierarchyNavigation)}`);
  }
  if (!hierarchyNavigation.movedDown || !hierarchyNavigation.afterDown.includes('<button>')) {
    throw new Error(`Picker did not navigate back to the child: ${JSON.stringify(hierarchyNavigation)}`);
  }

  await window.webContents.executeJavaScript(`(() => {
    const span = document.querySelector('button span');
    const bounds = span.getBoundingClientRect();
    span.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true,
      composed: true,
      clientX: bounds.x + bounds.width / 2,
      clientY: bounds.y + bounds.height / 2,
    }));
    span.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true, cancelable: true }));
    document.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }));
    span.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      composed: true,
      cancelable: true,
      clientX: bounds.x + bounds.width / 2,
      clientY: bounds.y + bounds.height / 2,
    }));
  })()`);
  const result = JSON.parse(await pickerResult);
  if (result.status !== 'selected') throw new Error(`Unexpected picker result: ${JSON.stringify(result)}`);
  if (result.intent !== 'reference') throw new Error(`Unexpected picker intent: ${JSON.stringify(result)}`);
  if (result.roles[0] !== 'codex.sidebarToggle') throw new Error(`The semantic button was not preferred: ${JSON.stringify(result.roles)}`);
  if (result.selector !== '[data-attune-host-roles~="codex.sidebarToggle"]') throw new Error(`Unexpected selector: ${result.selector}`);
  if (result.fingerprint.label !== 'Toggle sidebar') throw new Error(`Unexpected fingerprint: ${JSON.stringify(result.fingerprint)}`);
  const hostEvents = await window.webContents.executeJavaScript(`({
    clicks: window.hostClicks,
    pointerMoves: window.hostPointerMoves,
    keys: window.hostKeys,
    wheels: window.hostWheels,
  })`);
  if (Object.values(hostEvents).some((count) => count !== 0)) {
    throw new Error(`Picker mode leaked host input: ${JSON.stringify(hostEvents)}`);
  }

  await window.webContents.executeJavaScript(`window.__attuneElementPickerComplete?.()`);
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  const remainingPickerNodes = await window.webContents.executeJavaScript(
    `({
      nodes: document.querySelectorAll('[data-attune-element-picker]').length,
      active: document.documentElement.hasAttribute('data-attune-element-picker-active'),
      animation: getComputedStyle(document.querySelector('button')).animationPlayState,
    })`,
  );
  if (remainingPickerNodes.nodes !== 0 || remainingPickerNodes.active || remainingPickerNodes.animation !== 'running') {
    throw new Error(`Picker cleanup did not restore the app: ${JSON.stringify(remainingPickerNodes)}`);
  }

  const sourceToken = 'fixture-smuggle-source';
  const smuggleResultPromise = window.webContents.executeJavaScript(
    buildElementPickerExpression('Codex', null, { anchorToken: sourceToken }),
  );
  await new Promise((resolve) => setTimeout(resolve, 80));
  await window.webContents.executeJavaScript(`(() => {
    const span = document.querySelector('button span');
    const bounds = span.getBoundingClientRect();
    span.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true,
      composed: true,
      clientX: bounds.x + bounds.width / 2,
      clientY: bounds.y + bounds.height / 2,
    }));
    span.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      composed: true,
      cancelable: true,
      altKey: true,
      clientX: bounds.x + bounds.width / 2,
      clientY: bounds.y + bounds.height / 2,
    }));
  })()`);
  const smuggleResult = JSON.parse(await smuggleResultPromise);
  if (smuggleResult.intent !== 'smuggle-source' || smuggleResult.fingerprint.tag !== 'button') {
    throw new Error(`Option-click did not choose the highlighted component: ${JSON.stringify(smuggleResult)}`);
  }
  const sourceAnchored = await window.webContents.executeJavaScript(`
    window.__attuneSmuggleAnchors?.[${JSON.stringify(sourceToken)}] === document.querySelector('button')
      && document.querySelector('button').getAttribute('data-attune-smuggle-anchor') === ${JSON.stringify(sourceToken)}
  `);
  if (!sourceAnchored) throw new Error('Option-click did not retain the live source anchor.');
  await window.webContents.executeJavaScript(`(() => {
    window.__attuneElementPickerCleanup?.('fixture');
    document.querySelector('button').removeAttribute('data-attune-smuggle-anchor');
    delete window.__attuneSmuggleAnchors[${JSON.stringify(sourceToken)}];
  })()`);

  const targetToken = 'fixture-smuggle-target';
  const targetResultPromise = window.webContents.executeJavaScript(
    buildElementPickerExpression('Codex', null, { mode: 'smuggle-target', anchorToken: targetToken }),
  );
  await new Promise((resolve) => setTimeout(resolve, 80));
  await window.webContents.executeJavaScript(`(() => {
    const button = document.querySelector('button');
    const bounds = button.getBoundingClientRect();
    const x = bounds.x + bounds.width / 2;
    const y = bounds.y + bounds.height / 2;
    button.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, composed: true, clientX: x, clientY: y }));
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'd', code: 'KeyD', bubbles: true, cancelable: true,
    }));
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true, clientX: x, clientY: y }));
  })()`);
  const targetResult = JSON.parse(await targetResultPromise);
  if (targetResult.intent !== 'smuggle-target' || targetResult.placement !== 'right') {
    throw new Error(`D did not select right placement: ${JSON.stringify(targetResult)}`);
  }
  const targetAnchored = await window.webContents.executeJavaScript(`
    window.__attuneSmuggleAnchors?.[${JSON.stringify(targetToken)}] === document.querySelector('button')
  `);
  if (!targetAnchored) throw new Error('Destination placement did not retain the target anchor.');
  await window.webContents.executeJavaScript(`(() => {
    window.__attuneElementPickerCleanup?.('fixture');
    document.querySelector('button').removeAttribute('data-attune-smuggle-anchor');
    delete window.__attuneSmuggleAnchors[${JSON.stringify(targetToken)}];
  })()`);

  const topTargetToken = 'fixture-smuggle-target-top';
  const topTargetResultPromise = window.webContents.executeJavaScript(
    buildElementPickerExpression('Codex', null, { mode: 'smuggle-target', anchorToken: topTargetToken }),
  );
  await new Promise((resolve) => setTimeout(resolve, 80));
  await window.webContents.executeJavaScript(`(() => {
    const button = document.querySelector('button');
    const bounds = button.getBoundingClientRect();
    const x = bounds.x + bounds.width / 2;
    const y = bounds.y + bounds.height / 2;
    button.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, composed: true, clientX: x, clientY: y }));
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'w', code: 'KeyW', bubbles: true, cancelable: true,
    }));
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true, clientX: x, clientY: y }));
  })()`);
  const topTargetResult = JSON.parse(await topTargetResultPromise);
  if (topTargetResult.intent !== 'smuggle-target' || topTargetResult.placement !== 'top') {
    throw new Error(`W did not select top placement: ${JSON.stringify(topTargetResult)}`);
  }
  const topTargetAnchored = await window.webContents.executeJavaScript(`
    window.__attuneSmuggleAnchors?.[${JSON.stringify(topTargetToken)}] === document.querySelector('button')
  `);
  if (!topTargetAnchored) throw new Error('Top destination placement did not retain the target anchor.');
  await window.webContents.executeJavaScript(`(() => {
    window.__attuneElementPickerCleanup?.('fixture');
    document.querySelector('button').removeAttribute('data-attune-smuggle-anchor');
    delete window.__attuneSmuggleAnchors[${JSON.stringify(topTargetToken)}];
  })()`);

  const bottomTargetToken = 'fixture-smuggle-target-bottom';
  const bottomTargetResultPromise = window.webContents.executeJavaScript(
    buildElementPickerExpression('Codex', null, { mode: 'smuggle-target', anchorToken: bottomTargetToken }),
  );
  await new Promise((resolve) => setTimeout(resolve, 80));
  await window.webContents.executeJavaScript(`(() => {
    const button = document.querySelector('button');
    const bounds = button.getBoundingClientRect();
    const x = bounds.x + bounds.width / 2;
    const y = bounds.y + bounds.height / 2;
    button.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, composed: true, clientX: x, clientY: y }));
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 's', code: 'KeyS', bubbles: true, cancelable: true,
    }));
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true, clientX: x, clientY: y }));
  })()`);
  const bottomTargetResult = JSON.parse(await bottomTargetResultPromise);
  if (bottomTargetResult.intent !== 'smuggle-target' || bottomTargetResult.placement !== 'bottom') {
    throw new Error(`S did not select bottom placement: ${JSON.stringify(bottomTargetResult)}`);
  }
  const bottomTargetAnchored = await window.webContents.executeJavaScript(`
    window.__attuneSmuggleAnchors?.[${JSON.stringify(bottomTargetToken)}] === document.querySelector('button')
  `);
  if (!bottomTargetAnchored) throw new Error('Bottom destination placement did not retain the target anchor.');
  await window.webContents.executeJavaScript(`(() => {
    window.__attuneElementPickerCleanup?.('fixture');
    document.querySelector('button').removeAttribute('data-attune-smuggle-anchor');
    delete window.__attuneSmuggleAnchors[${JSON.stringify(bottomTargetToken)}];
  })()`);

  const replaceTargetToken = 'fixture-smuggle-target-replace';
  const replaceTargetResultPromise = window.webContents.executeJavaScript(
    buildElementPickerExpression('Codex', null, { mode: 'smuggle-target', anchorToken: replaceTargetToken }),
  );
  await new Promise((resolve) => setTimeout(resolve, 80));
  await window.webContents.executeJavaScript(`(() => {
    const button = document.querySelector('button');
    const bounds = button.getBoundingClientRect();
    const x = bounds.x + bounds.width / 2;
    const y = bounds.y + bounds.height / 2;
    button.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, composed: true, clientX: x, clientY: y,
    }));
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'a', code: 'KeyA', bubbles: true, cancelable: true,
    }));
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'a', code: 'KeyA', bubbles: true, cancelable: true,
    }));
    button.dispatchEvent(new MouseEvent('click', {
      bubbles: true, composed: true, cancelable: true, clientX: x, clientY: y,
    }));
  })()`);
  const replaceTargetResult = JSON.parse(await replaceTargetResultPromise);
  if (replaceTargetResult.intent !== 'smuggle-target' || replaceTargetResult.placement !== 'replace') {
    throw new Error(`Pressing the same side key twice did not return to replace: ${JSON.stringify(replaceTargetResult)}`);
  }
  await window.webContents.executeJavaScript(`(() => {
    window.__attuneElementPickerCleanup?.('fixture');
    document.querySelector('button').removeAttribute('data-attune-smuggle-anchor');
    delete window.__attuneSmuggleAnchors[${JSON.stringify(replaceTargetToken)}];
  })()`);

  const insideTargetToken = 'fixture-smuggle-target-inside';
  const insideTargetResultPromise = window.webContents.executeJavaScript(
    buildElementPickerExpression('Codex', null, { mode: 'smuggle-target', anchorToken: insideTargetToken }),
  );
  await new Promise((resolve) => setTimeout(resolve, 80));
  await window.webContents.executeJavaScript(`(() => {
    const button = document.querySelector('button');
    const bounds = button.getBoundingClientRect();
    const x = bounds.x + bounds.width / 2;
    const y = bounds.y + bounds.height / 2;
    button.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, composed: true, altKey: true, clientX: x, clientY: y,
    }));
    button.dispatchEvent(new MouseEvent('click', {
      bubbles: true, composed: true, cancelable: true, altKey: true, clientX: x, clientY: y,
    }));
  })()`);
  const insideTargetResult = JSON.parse(await insideTargetResultPromise);
  if (insideTargetResult.intent !== 'smuggle-target' || insideTargetResult.placement !== 'inside') {
    throw new Error(`Option-click did not select inside placement: ${JSON.stringify(insideTargetResult)}`);
  }
  await window.webContents.executeJavaScript(`(() => {
    window.__attuneElementPickerCleanup?.('fixture');
    document.querySelector('button').removeAttribute('data-attune-smuggle-anchor');
    delete window.__attuneSmuggleAnchors[${JSON.stringify(insideTargetToken)}];
  })()`);

  const deleteSmuggleResultPromise = window.webContents.executeJavaScript(
    buildElementPickerExpression('Codex'),
  );
  await new Promise((resolve) => setTimeout(resolve, 80));
  const deleteSmuggleState = await window.webContents.executeJavaScript(`(() => {
    const smuggle = document.createElement('attune-component-smuggle');
    smuggle.setAttribute('data-attune-component-smuggle', 'host');
    smuggle.setAttribute('data-attune-component-smuggle-token', 'fixture-delete-token');
    smuggle.style.cssText = 'display:block;width:220px;height:90px';
    document.body.append(smuggle);
    window.smuggleCloseRequests = 0;
    window.wrongSmuggleCloseRequests = 0;
    window.__attuneComponentSmuggleTargets = {
      'fixture-delete-token': {
        requestClose() {
          window.smuggleCloseRequests += 1;
          smuggle.remove();
          return true;
        },
        isManipulating() { return false; },
      },
    };
    window.__attuneComponentSmuggleTarget = {
      requestClose() {
        window.wrongSmuggleCloseRequests += 1;
        return true;
      },
      isManipulating() { return false; },
    };
    const interactive = document.createElement('textarea');
    interactive.setAttribute('data-attune-component-smuggle', 'input-relay');
    smuggle.appendChild(interactive);
    window.smugglePointerDowns = 0;
    window.smuggleKeyDowns = 0;
    window.smuggleBeforeInputs = 0;
    interactive.addEventListener('pointerdown', () => { window.smugglePointerDowns += 1; });
    interactive.addEventListener('keydown', () => { window.smuggleKeyDowns += 1; });
    interactive.addEventListener('beforeinput', () => { window.smuggleBeforeInputs += 1; });
    const bounds = smuggle.getBoundingClientRect();
    smuggle.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, composed: true,
      clientX: bounds.left + bounds.width / 2,
      clientY: bounds.top + bounds.height / 2,
    }));
    interactive.focus();
    interactive.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, composed: true, cancelable: true,
      clientX: bounds.left + 10, clientY: bounds.top + 10,
    }));
    interactive.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'x', code: 'KeyX', bubbles: true, composed: true, cancelable: true,
    }));
    interactive.dispatchEvent(new InputEvent('beforeinput', {
      inputType: 'insertText', data: 'x', bubbles: true, composed: true, cancelable: true,
    }));
    const label = document.querySelector('[data-attune-element-picker="label"]').textContent;
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Backspace', code: 'Backspace', bubbles: true, cancelable: true,
    }));
    return {
      label,
      closeRequests: window.smuggleCloseRequests,
      wrongCloseRequests: window.wrongSmuggleCloseRequests,
      connected: smuggle.isConnected,
      pointerDowns: window.smugglePointerDowns,
      keyDowns: window.smuggleKeyDowns,
      beforeInputs: window.smuggleBeforeInputs,
    };
  })()`);
  const deleteSmuggleResult = JSON.parse(await deleteSmuggleResultPromise);
  if (deleteSmuggleResult.status !== 'cancelled'
    || deleteSmuggleState.closeRequests !== 1 || deleteSmuggleState.wrongCloseRequests !== 0
    || deleteSmuggleState.connected
    || deleteSmuggleState.pointerDowns !== 1
    || deleteSmuggleState.keyDowns !== 1
    || deleteSmuggleState.beforeInputs !== 1
    || !deleteSmuggleState.label.includes('Backspace/Delete: REMOVE')) {
    throw new Error(`Backspace did not remove the highlighted smuggle: ${JSON.stringify({ deleteSmuggleResult, deleteSmuggleState })}`);
  }

  const removeAllResultPromise = window.webContents.executeJavaScript(
    buildElementPickerExpression('Codex'),
  );
  await new Promise((resolve) => setTimeout(resolve, 80));
  const removeAllState = await window.webContents.executeJavaScript(`(() => {
    const hosts = ['fixture-remove-all-one', 'fixture-remove-all-two'].map((token) => {
      const host = document.createElement('attune-component-smuggle');
      host.setAttribute('data-attune-component-smuggle', 'host');
      host.setAttribute('data-attune-component-smuggle-token', token);
      document.body.append(host);
      return host;
    });
    window.removeAllCloseRequests = 0;
    window.__attuneComponentSmuggleTargets = Object.fromEntries(hosts.map((host) => {
      const token = host.getAttribute('data-attune-component-smuggle-token');
      return [token, {
        requestClose() {
          window.removeAllCloseRequests += 1;
          host.remove();
          return true;
        },
        isManipulating() { return false; },
      }];
    }));
    window.__attuneComponentSmuggleTarget = window.__attuneComponentSmuggleTargets['fixture-remove-all-two'];
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Backspace', code: 'Backspace', metaKey: true, bubbles: true, cancelable: true,
    }));
    return {
      closeRequests: window.removeAllCloseRequests,
      connected: hosts.filter((host) => host.isConnected).length,
    };
  })()`);
  const removeAllResult = JSON.parse(await removeAllResultPromise);
  if (removeAllResult.status !== 'remove-all'
    || removeAllState.closeRequests !== 2
    || removeAllState.connected !== 0) {
    throw new Error(`Command-Backspace did not remove every smuggle: ${JSON.stringify({ removeAllResult, removeAllState })}`);
  }
  window.destroy();
}

app.whenReady().then(async () => {
  try {
    await run();
    console.log('element-picker-ok');
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
