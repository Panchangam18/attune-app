import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow } from 'electron';

const fail = (error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  app.exit(1);
};
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);

const stylesheetPath = fileURLToPath(new URL(
  '../../../attunements/attunements/chatgpt-claude-models/apps/chatgpt-claude-models.css',
  import.meta.url,
));
const stylesheet = readFileSync(stylesheetPath, 'utf8');
const scriptPath = fileURLToPath(new URL(
  '../../../attunements/attunements/chatgpt-claude-models/apps/chatgpt-claude-models.js',
  import.meta.url,
));
const script = readFileSync(scriptPath, 'utf8');
const fixturePage = fileURLToPath(new URL(
  './external-model-menu.html',
  import.meta.url,
));

await app.whenReady();
const watchdog = setTimeout(() => {
  fail(new Error('External model interaction fixture timed out.'));
}, 15_000);
const window = new BrowserWindow({
  show: false,
  webPreferences: {
    contextIsolation: false,
    nodeIntegration: false,
  },
});

await window.loadFile(fixturePage);
await window.webContents.insertCSS(stylesheet);

const result = await window.webContents.executeJavaScript(`
  (async () => {
    const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
    window.__requests = [];
    window.__nativeClicks = [];
    const modelData = [
      {
        id: 'cursor-agent',
        model: 'cursor-agent',
        attuneSupportsPendingNewThreadSelection: true,
        attuneNestedModels: [
          { id: 'cursor-agent', model: 'cursor-agent', displayName: 'Auto' },
          {
            id: 'cursor-agent::gpt-5.4',
            model: 'cursor-agent::gpt-5.4',
            displayName: 'GPT-5.4',
          },
          {
            id: 'cursor-agent::cursor-small',
            model: 'cursor-agent::cursor-small',
            displayName: 'Cursor Small',
            attuneSelectable: false,
            attuneUnavailableReason: 'Requires a paid Cursor plan.',
          },
          {
            id: 'cursor-agent::cursor-fast',
            model: 'cursor-agent::cursor-fast',
            displayName: 'Cursor Fast',
          },
        ],
      },
      {
        id: 'copilot-agent',
        model: 'copilot-agent',
        attuneSupportsPendingNewThreadSelection: true,
        attuneNestedModels: [
          { id: 'copilot-agent', model: 'copilot-agent', displayName: 'Auto' },
          {
            id: 'copilot-agent::claude-sonnet-4.6',
            model: 'copilot-agent::claude-sonnet-4.6',
            displayName: 'Claude Sonnet 4.6',
            defaultReasoningEffort: 'medium',
          },
        ],
      },
    ];
    window.__threadAuthorities = new Map([
      ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null],
    ]);
    window.__pendingAuthority = null;
    const authorityState = (threadId, selection) => {
      const model = selection?.model || null;
      const providerId = model?.startsWith('cursor-agent')
        ? 'cursor-agent'
        : model?.startsWith('copilot-agent')
          ? 'copilot-agent'
          : null;
      const option = modelData
        .flatMap((provider) => provider.attuneNestedModels)
        .find((candidate) => candidate.model === model);
      return {
        threadId,
        model,
        providerId,
        displayName: option?.displayName || null,
        effort: selection?.effort || null,
        serviceTier: selection?.serviceTier || null,
      };
    };
    window.electronBridge = {
      sendMessageFromView(payload) {
        const request = payload.request;
        window.__requests.push(request);
        let result = {};
        if (request.method === 'model/list') {
          result = { data: modelData };
        } else if (request.method === 'thread/settings/update') {
          const selection = {
            model: request.params.model,
            effort: request.params.effort,
            serviceTier: request.params.serviceTier,
          };
          if (request.params.threadId === '00000000-0000-4000-8000-000000000001') {
            window.__pendingAuthority = selection;
          } else {
            window.__threadAuthorities.set(request.params.threadId, selection);
          }
        } else if (request.method === 'attune/external-model/state') {
          const threadId = request.params.threadId;
          if (
            threadId
            && !window.__threadAuthorities.has(threadId)
            && window.__pendingAuthority
          ) {
            window.__threadAuthorities.set(threadId, window.__pendingAuthority);
            window.__pendingAuthority = null;
          }
          const selection = threadId
            ? window.__threadAuthorities.get(threadId)
            : window.__pendingAuthority;
          result = authorityState(threadId, selection);
        }
        queueMicrotask(() => {
          window.dispatchEvent(new MessageEvent('message', {
            data: {
              hostId: 'local',
              type: 'mcp-response',
              message: { id: request.id, result },
            },
          }));
        });
        return Promise.resolve();
      },
    };
    const cursor = document.querySelector('#cursor');
    cursor.addEventListener('click', () => {
      window.__nativeClicks.push('cursor-agent');
      const replacement = document.createElement('div');
      replacement.id = 'cursor-selected';
      replacement.setAttribute('role', 'menuitem');
      const label = document.createElement('div');
      const nativeLabel = document.createElement('span');
      nativeLabel.textContent = 'Cursor GPT-5.4';
      label.append(nativeLabel);
      replacement.append(label);
      cursor.replaceWith(replacement);
      const activeLabel = document.querySelector('#active-label');
      activeLabel.replaceChildren(document.createTextNode('Custom'));
    });
    const copilot = document.querySelector('#copilot');
    copilot.addEventListener('click', () => {
      window.__nativeClicks.push('copilot-agent');
      const replacement = document.createElement('div');
      replacement.id = 'copilot-selected';
      replacement.setAttribute('role', 'menuitem');
      const label = document.createElement('div');
      const nativeLabel = document.createElement('span');
      nativeLabel.textContent = 'Copilot Claude Sonnet 4.6';
      label.append(nativeLabel);
      replacement.append(label);
      copilot.replaceWith(replacement);
      // ChatGPT can retain the existing outer text node during a direct
      // provider-to-provider switch. Attune must transfer ownership itself.
    });
    const codex = document.querySelector('#codex');
    codex.addEventListener('click', () => {
      const conversationId = document.querySelector(
        '[data-above-composer-conversation-id]',
      )?.getAttribute('data-above-composer-conversation-id');
      const activeRows = [...document.querySelectorAll(
        '[data-app-action-sidebar-thread-row][data-app-action-sidebar-thread-active="true"]',
      )];
      const threadId = conversationId || activeRows
        .find((row) => row.getClientRects().length > 0)
        ?.dataset.appActionSidebarThreadId?.replace(/^local:/, '');
      if (threadId) window.__threadAuthorities.set(threadId, null);
    });

    localStorage.setItem(
      'attune-active-external-provider:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'copilot-agent',
    );
    localStorage.setItem(
      'attune-external-model-selection:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:copilot-agent',
      JSON.stringify({
        model: 'copilot-agent::claude-sonnet-4.6',
        displayName: 'Claude Sonnet 4.6',
        effort: 'medium',
      }),
    );

    ${script}
    await wait(80);

    if (
      cursor.textContent.trim() !== 'Cursor'
      || document.querySelector('#copilot').textContent.trim() !== 'Copilot'
    ) {
      throw new Error('Provider rows did not normalize to Cursor and Copilot.');
    }
    if (
      [...Object.keys(localStorage)].some((key) => (
        key.startsWith('attune-active-external-provider:')
        || key.startsWith('attune-external-model-selection:')
      ))
    ) {
      throw new Error('Legacy browser-owned model state was not removed.');
    }
    cursor.dispatchEvent(new PointerEvent('pointerenter'));
    await wait(80);
    const submenu = document.querySelector('.attune-provider-model-menu');
    if (!submenu) throw new Error('Hover did not open the Cursor submenu.');
    if (submenu.textContent.includes('Cursor Agent')) {
      throw new Error('Provider heading leaked into the nested submenu.');
    }
    const cursorNamedModels = [...submenu.querySelectorAll(
      '.attune-provider-model-option',
    )].filter((option) => option.textContent.startsWith('Cursor '));
    if (
      cursorNamedModels.map((option) => option.textContent.trim()).join('|')
        !== 'Cursor Small|Cursor Fast'
      || cursorNamedModels.some((option) => (
        option.matches('[data-attune-provider-model-row="true"]')
      ))
    ) {
      throw new Error('Cursor-named submodels were mistaken for provider dropdowns.');
    }
    if (cursor.getAttribute('aria-expanded') !== 'true') {
      throw new Error('The provider row did not retain its highlighted/open state.');
    }
    const unavailableCursorModel = cursorNamedModels.find((option) => (
      option.textContent.trim() === 'Cursor Small'
    ));
    if (
      !unavailableCursorModel?.disabled
      || unavailableCursorModel.getAttribute('aria-disabled') !== 'true'
      || unavailableCursorModel.title !== 'Requires a paid Cursor plan.'
      || getComputedStyle(unavailableCursorModel).cursor !== 'not-allowed'
    ) {
      throw new Error('An unavailable Cursor model was not visibly disabled.');
    }
    const requestsBeforeDisabledClick = window.__requests.length;
    unavailableCursorModel.click();
    await wait(20);
    if (window.__requests.length !== requestsBeforeDisabledClick) {
      throw new Error('An unavailable Cursor model was selectable.');
    }
    const pseudoContent = getComputedStyle(cursor, '::after').content;
    if (pseudoContent !== '""') {
      throw new Error('The CSS chevron is not present before selection.');
    }

    const nestedModel = [...submenu.querySelectorAll('.attune-provider-model-option')]
      .find((option) => option.textContent.includes('GPT-5.4'));
    if (!nestedModel) throw new Error('The expected Cursor submodel is missing.');
    nestedModel.click();
    await wait(140);

    const update = window.__requests.find((request) => (
      request.method === 'thread/settings/update'
      && request.params.model === 'cursor-agent::gpt-5.4'
      && request.params.attuneExternalSelection === true
    ));
    if (!update) throw new Error('Nested selection did not become authoritative immediately.');
    if (window.__nativeClicks.length !== 1) {
      throw new Error('Nested selection did not execute exactly one native provider selection.');
    }
    if (
      window.__threadAuthorities.get(
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      )?.model !== 'cursor-agent::gpt-5.4'
    ) {
      throw new Error('The proxy did not retain Cursor as the sole authority.');
    }
    const selectedCursor = document.querySelector('#cursor-selected');
    if (!selectedCursor?.matches('[data-attune-provider-model-row="true"]')) {
      throw new Error('The fully replaced provider row was not recovered.');
    }
    if (!selectedCursor.querySelector('.attune-provider-model-selection')) {
      throw new Error('The active submodel name is missing from the provider row.');
    }
    if (!selectedCursor.querySelector('.attune-provider-model-parent-check')) {
      throw new Error('The active provider checkmark is missing.');
    }
    if (
      selectedCursor.firstElementChild?.firstElementChild?.textContent !== 'Cursor'
      || selectedCursor.querySelector('.attune-provider-model-selection')?.textContent !== 'GPT-5.4'
    ) {
      throw new Error(\`The recovered provider row is malformed: \${selectedCursor.textContent}\`);
    }
    if (selectedCursor.textContent.includes('Cursor GPT-5.4GPT-5.4')) {
      throw new Error('The native hidden-model label was duplicated in the provider row.');
    }
    if (selectedCursor.querySelector('.attune-provider-model-chevron')) {
      throw new Error('A removable DOM chevron was reintroduced.');
    }
    if (getComputedStyle(selectedCursor, '::after').content !== '""') {
      throw new Error('The CSS chevron disappeared after React replaced the entire row.');
    }
    if (document.querySelector('#active-label').textContent.trim() !== 'Cursor GPT-5.4 Medium') {
      throw new Error(
        \`The outer model label was not updated: \${document.querySelector('#active-label').textContent}\`,
      );
    }
    if (
      getComputedStyle(document.querySelector('#stale-native-check')).display
        !== 'none'
    ) {
      throw new Error('A stale native model check remained beside the authoritative provider.');
    }

    selectedCursor.dispatchEvent(new PointerEvent('pointerenter'));
    await wait(80);
    const reopenedMenu = document.querySelector('.attune-provider-model-menu');
    const checkedNestedModel = [...reopenedMenu.querySelectorAll(
      '.attune-provider-model-option',
    )].find((option) => (
      option.textContent.includes('GPT-5.4')
      && option.querySelector('.attune-provider-model-option-check')
    ));
    if (!checkedNestedModel) {
      throw new Error('The selected nested model did not retain its checkmark after reopening.');
    }

    copilot.dispatchEvent(new PointerEvent('pointerenter'));
    await wait(80);
    const copilotMenu = document.querySelector('.attune-provider-model-menu');
    const copilotModel = [...copilotMenu.querySelectorAll(
      '.attune-provider-model-option',
    )].find((option) => option.textContent.trim() === 'Auto');
    if (!copilotModel) throw new Error('Copilot Auto is missing.');
    copilotModel.click();
    await wait(140);
    const copilotUpdate = window.__requests.find((request) => (
      request.method === 'thread/settings/update'
      && request.params.model === 'copilot-agent'
      && request.params.attuneExternalSelection === true
    ));
    if (!copilotUpdate) {
      throw new Error('Direct Cursor-to-Copilot Auto selection was not authoritative.');
    }
    if (
      document.querySelector('#active-label').textContent.trim()
        !== 'Copilot Auto Medium'
    ) {
      throw new Error(
        \`The outer label did not transfer providers: \${document.querySelector(
          '#active-label',
        ).textContent}\`,
      );
    }

    codex.click();
    await wait(30);
    if (
      window.__threadAuthorities.get(
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      ) !== null
    ) {
      throw new Error('Selecting Codex did not clear the proxy authority.');
    }
    if (selectedCursor.querySelector('.attune-provider-model-selection')) {
      throw new Error('The external model label remained after selecting Codex.');
    }
    if (document.querySelector('#active-label').textContent.trim() !== 'Codex 5.6 Medium') {
      throw new Error(
        \`The native outer label was not restored: \${document.querySelector(
          '#active-label',
        ).textContent}\`,
      );
    }
    if (
      getComputedStyle(document.querySelector('#stale-native-check')).display
        === 'none'
    ) {
      throw new Error('The native model check was not restored after leaving the provider.');
    }

    const activeThreadRow = document.querySelector(
      '[data-app-action-sidebar-thread-row]'
      + '[data-app-action-sidebar-thread-id^="client-new-thread:"]',
    );
    document.querySelector('#conversation-marker').removeAttribute(
      'data-above-composer-conversation-id',
    );
    activeThreadRow.dataset.appActionSidebarThreadId =
      'client-new-thread:eebf6d0b-8af6-4b46-b7ea-f649cec44398';
    selectedCursor.dispatchEvent(new PointerEvent('pointerenter'));
    await wait(80);
    const newTaskMenu = document.querySelector('.attune-provider-model-menu');
    const newTaskModel = [...newTaskMenu.querySelectorAll(
      '.attune-provider-model-option',
    )].find((option) => option.textContent.includes('Cursor Fast'));
    if (!newTaskModel) throw new Error('Cursor Fast is missing in a new task.');
    newTaskModel.click();
    await wait(100);
    const pendingNewTaskRequest = window.__requests.find((request) => (
      request.method === 'thread/settings/update'
      && request.params.threadId === '00000000-0000-4000-8000-000000000001'
      && request.params.model === 'cursor-agent::cursor-fast'
      && request.params.effort === 'medium'
      && request.params.attuneExternalSelection === true
    ));
    if (!pendingNewTaskRequest) {
      throw new Error('The pending new-task model was not sent through a valid request.');
    }
    if (window.__pendingAuthority?.model !== 'cursor-agent::cursor-fast') {
      throw new Error('The proxy did not retain the pending new-task selection.');
    }

    activeThreadRow.dataset.appActionSidebarThreadId =
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    document.querySelector('#conversation-marker').dataset.aboveComposerConversationId =
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    activeThreadRow.dataset.appActionSidebarThreadActive = 'true';
    activeThreadRow.append(document.createTextNode('created'));
    await wait(50);
    if (
      window.__threadAuthorities.get(
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      )?.model !== 'cursor-agent::cursor-fast'
    ) {
      throw new Error('The proxy authority did not migrate to the created task.');
    }
    return {
      nativeClicks: window.__nativeClicks,
      pendingNewTaskModel: pendingNewTaskRequest.params.model,
      selectedModels: [update.params.model, copilotUpdate.params.model],
    };
  })()
`);

if (
  result.selectedModels.join('|')
    !== 'cursor-agent::gpt-5.4|copilot-agent'
  || result.nativeClicks.join('|') !== 'cursor-agent|copilot-agent'
  || result.pendingNewTaskModel !== 'cursor-agent::cursor-fast'
) {
  throw new Error(`Unexpected interaction result: ${JSON.stringify(result)}`);
}

clearTimeout(watchdog);
window.destroy();
app.exit(0);
