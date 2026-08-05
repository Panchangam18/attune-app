(() => {
  window.__attuneCodexKanbanCleanup?.();

  const host = (role) => window.__attuneHost?.resolve?.(role) || null;
  const sidebarHost = () => host('codex.sidebar') || document.querySelector('aside.app-shell-left-panel');
  const sidebarThreadsHost = () => host('codex.sidebarThreads') || sidebarHost() || document;
  const primaryChatHost = () => host('codex.primaryChat')
    || document.querySelector('main[data-app-shell-main-surface], main.main-surface');

  const BOARD_ACTIVE_KEY = 'attune-codex-kanban-board-active:v2';
  const BOARD_HISTORY_KEY = 'attuneCodexKanbanBoard';
  const UNREAD_OVERRIDE_KEY = 'attune-codex-kanban-unread:v2';
  const STAGES = [
    {
      id: 'old',
      label: 'Old',
      icon: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path><path d="M12 7v5l4 2"></path>',
    },
    {
      id: 'in-progress',
      label: 'In Progress',
      icon: '<polyline points="4 17 10 11 4 5"></polyline><line x1="12" x2="20" y1="19" y2="19"></line>',
    },
    {
      id: 'waiting',
      label: 'Waiting',
      icon: '<circle cx="12" cy="12" r="10"></circle><path d="M17 12h.01"></path><path d="M12 12h.01"></path><path d="M7 12h.01"></path>',
    },
    {
      id: 'done',
      label: 'Done',
      icon: '<circle cx="12" cy="12" r="10"></circle><path d="m9 12 2 2 4-4"></path>',
    },
  ];
  const pending = new Map();
  const waitingRequestThreads = new Map();
  const deferredThreadPatches = new Map();
  const columnScrollPositions = new Map();
  const readOverrides = new Set();
  const statsLoadQueue = [];
  const statsLoadQueued = new Set();
  let requestSequence = 0;
  let threads = [];
  let refreshTimer = 0;
  let networkRefreshInFlight = false;
  let statsLoadActive = 0;
  let statsObserver = null;
  let boardMode = false;
  let syntheticThreadNavigation = false;
  let navButton = null;
  let navSlot = null;
  let disposed = false;

  const normalizeThreadId = (value) => String(value || '').replace(/^local:/, '');
  const isThreadId = (value) => /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(normalizeThreadId(value));
  const activePathThreadId = () => normalizeThreadId(location.pathname.match(/^\/local\/([^/?#]+)/)?.[1] || '');
  const activeThreadId = () => {
    // In-app navigation uses a memory router, so the selected native row is
    // more current than location.pathname after Codex has launched.
    const activeRow = document.querySelector(
      '[data-app-action-sidebar-thread-row][data-app-action-sidebar-thread-active="true"]',
    );
    const activeId = threadIdFromElement(activeRow);
    return isThreadId(activeId) ? activeId : activePathThreadId();
  };

  const readUnreadOverrides = () => {
    try {
      const parsed = JSON.parse(localStorage.getItem(UNREAD_OVERRIDE_KEY) || '[]');
      return new Set(Array.isArray(parsed) ? parsed.filter(isThreadId).map(normalizeThreadId) : []);
    } catch {
      return new Set();
    }
  };
  const unreadOverrides = readUnreadOverrides();
  const saveUnreadOverrides = () => {
    try { localStorage.setItem(UNREAD_OVERRIDE_KEY, JSON.stringify([...unreadOverrides])); } catch {}
  };

  const timeValue = (value) => {
    if (typeof value === 'number') return value < 1e12 ? value * 1000 : value;
    if (/^\d+(?:\.\d+)?$/.test(String(value || ''))) {
      const numeric = Number(value);
      return numeric < 1e12 ? numeric * 1000 : numeric;
    }
    return new Date(value || 0).getTime();
  };

  const relativeTime = (value) => {
    const time = timeValue(value);
    if (!Number.isFinite(time) || time <= 0) return '';
    const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
    if (seconds < 60) return 'now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`;
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(time));
  };

  const projectName = (thread) => {
    const cwd = String(thread.cwd || '');
    return cwd.split('/').filter(Boolean).at(-1) || 'Codex';
  };

  const diffStats = (diffs, paths = []) => {
    let additions = 0;
    let deletions = 0;
    const files = new Set(paths.filter(Boolean));
    for (const diffValue of diffs) {
      const diff = String(diffValue || '');
      for (const line of diff.split('\n')) {
        if (line.startsWith('diff --git ')) {
          const path = line.match(/^diff --git a\/(.+?) b\/(.+)$/)?.[2];
          if (path) files.add(path);
        } else if (line.startsWith('+') && !line.startsWith('+++')) {
          additions += 1;
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          deletions += 1;
        }
      }
    }
    return { additions, deletions, filesChanged: files.size };
  };

  const threadStats = (thread) => {
    const changes = (thread?.turns || [])
      .flatMap((turn) => Array.isArray(turn?.items) ? turn.items : [])
      .filter((item) => item?.type === 'fileChange')
      .flatMap((item) => Array.isArray(item.changes) ? item.changes : []);
    return diffStats(
      changes.map((change) => change?.diff),
      changes.map((change) => change?.path),
    );
  };

  const statusType = (value) => String(
    typeof value === 'string' ? value : (value?.type || value?.status || ''),
  ).toLowerCase();

  const isRunningStatus = (value) => [
    'active', 'inprogress', 'in_progress', 'running', 'started', 'working',
  ].includes(statusType(value).replace(/\s+/g, ''));

  const isWaitingStatus = (value) => Array.isArray(value?.activeFlags)
    && value.activeFlags.some((flag) => [
      'waitingonapproval', 'waitingonuserinput',
    ].includes(String(flag).replace(/[\s_-]+/g, '').toLowerCase()));

  const stageFor = (thread) => {
    // Waiting must win over running because Codex keeps a blocked turn active
    // while it waits for an approval or an answer from the user.
    if (thread.waiting === true || isWaitingStatus(thread.status)) return 'waiting';
    if (isRunningStatus(thread.status)) return 'in-progress';
    if (readOverrides.has(thread.id)) return 'old';
    if (thread.hasUnreadTurn === true || unreadOverrides.has(thread.id)) return 'done';
    return 'old';
  };

  const normalizeThread = (thread) => {
    const id = normalizeThreadId(thread?.id || thread?.threadId || thread?.conversationId);
    if (!isThreadId(id)) return null;
    const unreadValue = thread.hasUnreadTurn ?? thread.has_unread_turn;
    return {
      id,
      title: String(thread.name || thread.title || 'Untitled chat').trim() || 'Untitled chat',
      cwd: thread.cwd || thread.workingDirectory || thread.workspaceRoot || '',
      updatedAt: thread.recencyAt || thread.recency_at || thread.updatedAt || thread.updated_at
        || thread.createdAt || thread.created_at || '',
      status: thread.threadRuntimeStatus || thread.status || '',
      ...(unreadValue == null ? {} : { hasUnreadTurn: Boolean(unreadValue) }),
    };
  };

  const updateThread = (threadId, patch) => {
    const id = normalizeThreadId(threadId);
    if (!isThreadId(id)) return;
    const index = threads.findIndex((thread) => thread.id === id);
    if (index < 0) {
      // Live notifications can arrive before the paginated thread list. Keep
      // their state so the later list response cannot erase it.
      deferredThreadPatches.set(id, { ...deferredThreadPatches.get(id), ...patch });
      scheduleRefresh(true);
      return;
    } else {
      threads = threads.map((thread, threadIndex) => threadIndex === index ? { ...thread, ...patch } : thread);
    }
    if (boardMode) render();
  };

  const request = (method, params, timeoutMs = 12000) => {
    if (!window.electronBridge?.sendMessageFromView) return Promise.reject(new Error('Codex bridge unavailable.'));
    const id = `attune-kanban-${Date.now()}-${++requestSequence}`;
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method} timed out.`));
      }, timeoutMs);
      pending.set(id, {
        resolve: (value) => { window.clearTimeout(timeout); resolve(value); },
        reject: (error) => { window.clearTimeout(timeout); reject(error); },
      });
      Promise.resolve(window.electronBridge.sendMessageFromView({
        type: 'mcp-request',
        hostId: 'local',
        request: { id, method, params },
      })).catch((error) => {
        window.clearTimeout(timeout);
        pending.delete(id);
        reject(error);
      });
    });
  };

  const drainStatsQueue = () => {
    // Reading turns is substantially heavier than listing threads. Bound the
    // concurrency so opening a large Old column does not flood Codex's bridge.
    while (!disposed && statsLoadActive < 4 && statsLoadQueue.length) {
      const threadId = statsLoadQueue.shift();
      statsLoadActive += 1;
      request('thread/read', { threadId, includeTurns: true })
        .then((response) => {
          if (!response?.thread) return;
          updateThread(threadId, { ...threadStats(response.thread), statsLoaded: true });
        })
        .catch(() => {})
        .finally(() => {
          statsLoadActive -= 1;
          statsLoadQueued.delete(threadId);
          drainStatsQueue();
        });
    }
  };

  const queueThreadStats = (threadId) => {
    const id = normalizeThreadId(threadId);
    const thread = threads.find((candidate) => candidate.id === id);
    if (!thread || thread.statsLoaded === true || statsLoadQueued.has(id)) return;
    statsLoadQueued.add(id);
    statsLoadQueue.push(id);
    drainStatsQueue();
  };

  const resolveWaitingRequest = (requestId, fallbackThreadId = '') => {
    const id = String(requestId || '');
    const threadId = normalizeThreadId(waitingRequestThreads.get(id) || fallbackThreadId);
    if (id) waitingRequestThreads.delete(id);
    if (!isThreadId(threadId)) return;
    const stillWaiting = [...waitingRequestThreads.values()].some((candidate) => candidate === threadId);
    if (!stillWaiting) updateThread(threadId, { waiting: false });
  };

  const onMessage = (event) => {
    // The board is event-driven: bridge notifications update only the affected
    // thread, so live stage changes never depend on a polling interval.
    const message = event.data;
    if (!message) return;

    if (message.type === 'thread-read-state-changed') {
      const params = message.params || message;
      const threadId = normalizeThreadId(params.conversationId || params.threadId);
      if ((params.hostId == null || params.hostId === 'local') && isThreadId(threadId)) {
        if (params.hasUnreadTurn === true) {
          readOverrides.delete(threadId);
          unreadOverrides.add(threadId);
        } else {
          readOverrides.add(threadId);
          unreadOverrides.delete(threadId);
        }
        saveUnreadOverrides();
        updateThread(threadId, { hasUnreadTurn: params.hasUnreadTurn === true });
      }
      return;
    }

    if (message.hostId !== 'local') return;

    if (message.type === 'mcp-response') {
      const waiter = pending.get(message.message?.id);
      if (!waiter) return;
      pending.delete(message.message.id);
      if (message.message.error) waiter.reject(new Error(message.message.error.message || 'Codex request failed.'));
      else waiter.resolve(message.message.result);
      return;
    }

    if (message.type === 'mcp-request') {
      const method = String(message.request?.method || '').toLowerCase();
      const params = message.request?.params || {};
      const threadId = normalizeThreadId(params.threadId || params.conversationId || params.turn?.threadId);
      if (isThreadId(threadId) && (
        /approval|permission|requestuserinput|requestoptionpicker|requestsetupcodex/.test(method)
        || method === 'mcpserver/elicitation/request'
      )) {
        const requestId = String(message.request?.id || `${threadId}:${Date.now()}`);
        waitingRequestThreads.set(requestId, threadId);
        updateThread(threadId, { waiting: true, status: { type: 'active' } });
      }
      return;
    }

    if (message.type !== 'mcp-notification') return;
    const params = message.params || {};
    const threadId = normalizeThreadId(
      params.threadId || params.conversationId || params.thread?.id || params.turn?.threadId,
    );

    switch (message.method) {
      case 'thread/status/changed':
        if (isThreadId(threadId)) updateThread(threadId, { status: params.status || '' });
        break;
      case 'turn/started':
        if (isThreadId(threadId)) updateThread(threadId, { status: { type: 'active' }, waiting: false });
        break;
      case 'turn/completed':
        if (isThreadId(threadId)) {
          const wasRead = !boardMode && activeThreadId() === threadId && document.hasFocus();
          if (!wasRead) {
            readOverrides.delete(threadId);
            unreadOverrides.add(threadId);
            saveUnreadOverrides();
          } else {
            readOverrides.add(threadId);
          }
          updateThread(threadId, {
            status: { type: 'idle' },
            waiting: false,
            hasUnreadTurn: !wasRead,
            statsLoaded: false,
          });
        }
        break;
      case 'turn/diff/updated':
        if (isThreadId(threadId)) {
          updateThread(threadId, { ...diffStats([params.diff]), statsLoaded: true });
        }
        break;
      case 'serverRequest/resolved':
        resolveWaitingRequest(params.requestId || params.id, threadId);
        break;
      case 'thread/name/updated':
        if (isThreadId(threadId) && params.name) updateThread(threadId, { title: params.name });
        break;
      case 'thread/read-state/changed':
      case 'thread/unread/changed':
        if (isThreadId(threadId)) {
          const hasUnreadTurn = params.hasUnreadTurn === true || params.unread === true;
          if (hasUnreadTurn) {
            readOverrides.delete(threadId);
            unreadOverrides.add(threadId);
          } else {
            readOverrides.add(threadId);
            unreadOverrides.delete(threadId);
          }
          saveUnreadOverrides();
          updateThread(threadId, { hasUnreadTurn });
        }
        break;
    }
  };

  const threadIdFromElement = (element) => {
    if (!(element instanceof Element)) return '';
    const direct = element.getAttribute('data-app-action-sidebar-thread-id')
      || element.dataset?.appActionSidebarThreadId;
    if (isThreadId(direct)) return normalizeThreadId(direct);
    const child = element.querySelector?.('[data-app-action-sidebar-thread-id]');
    const childId = child?.getAttribute('data-app-action-sidebar-thread-id')
      || child?.dataset?.appActionSidebarThreadId;
    if (isThreadId(childId)) return normalizeThreadId(childId);
    const href = element.closest?.('a[href]')?.getAttribute('href')
      || element.querySelector?.('a[href*="/local/"]')?.getAttribute('href')
      || '';
    return normalizeThreadId(href.match(/\/local\/([0-9a-f-]{36})(?:[/?#]|$)/i)?.[1] || '');
  };

  const sidebarSignals = (row) => {
    const labels = [row.textContent, ...[...row.querySelectorAll('[aria-label], [title]')].flatMap((element) => [
      element.getAttribute('aria-label'), element.getAttribute('title'),
    ])].filter(Boolean).join(' ').replace(/\s+/g, ' ');
    const hasNativeUnreadMarker = [...row.querySelectorAll('[style]')].some((element) => {
      const background = element.style?.backgroundColor || '';
      return background.includes('vscode-textLink-foreground')
        && element.matches('span, i')
        && element.classList.contains('rounded-full');
    });
    return {
      waiting: /waiting for (?:approval|permission)|needs (?:approval|permission)|permission required/i.test(labels),
      running: /\bworking\b|\brunning\b|in progress/i.test(labels),
      unread: hasNativeUnreadMarker || /\bunread\b|new response/i.test(labels),
    };
  };

  const threadsFromSidebar = () => {
    // The sidebar is virtualized, but its mounted rows provide the fastest
    // source for native running/unread signals; thread/list fills in the rest.
    const root = sidebarThreadsHost();
    if (!root) return [];
    const rows = root.querySelectorAll([
      '[data-app-action-sidebar-thread-row]',
      '[data-app-action-sidebar-thread-id]',
      'a[href*="/local/"]',
    ].join(','));
    const found = new Map();
    for (const row of rows) {
      const id = threadIdFromElement(row);
      if (!isThreadId(id) || found.has(id)) continue;
      const titled = row.matches?.('[data-app-action-sidebar-thread-title]')
        ? row
        : row.querySelector?.('[data-app-action-sidebar-thread-title]');
      const title = titled?.dataset?.appActionSidebarThreadTitle
        || row.dataset?.appActionSidebarThreadTitle
        || row.textContent?.replace(/\s+/g, ' ').trim()
        || 'Untitled chat';
      const signals = sidebarSignals(row);
      const hasUnreadTurn = readOverrides.has(id) ? false : signals.unread;
      if (!signals.unread) readOverrides.delete(id);
      found.set(id, {
        id,
        title,
        hasUnreadTurn,
        ...(signals.waiting ? { waiting: true, status: { type: 'active' } } : {}),
        ...(!signals.waiting && signals.running ? { status: { type: 'active' } } : {}),
      });
    }
    return [...found.values()];
  };

  const fetchThreads = async () => {
    const all = [];
    let cursor = null;
    for (let page = 0; page < 5; page += 1) {
      const result = await request('thread/list', {
        limit: 100,
        sortKey: 'updated_at',
        ...(cursor ? { cursor } : {}),
      });
      const pageThreads = result?.data || result?.threads || result?.items || [];
      if (!Array.isArray(pageThreads)) break;
      all.push(...pageThreads);
      cursor = result?.nextCursor || result?.next_cursor || null;
      if (!cursor) break;
    }
    return all.map(normalizeThread).filter(Boolean);
  };

  const board = document.createElement('section');
  board.id = 'attune-codex-kanban';
  board.hidden = true;
  board.setAttribute('aria-label', 'Codex chat kanban');
  board.innerHTML = `
    <div class="attune-kanban-board-scroll">
      <div class="attune-kanban-board"></div>
    </div>
  `;
  const boardGrid = board.querySelector('.attune-kanban-board');
  const boardScroll = board.querySelector('.attune-kanban-board-scroll');
  const platform = navigator.userAgentData?.platform || navigator.platform || '';
  const isMacOS = /mac/i.test(platform);
  const syncTrafficLightInset = () => {
    const main = primaryChatHost();
    const left = main?.getBoundingClientRect().left;
    board.dataset.trafficLightInset = String(isMacOS && Number.isFinite(left) && left < 88);
  };
  const boardResizeObserver = new ResizeObserver(syncTrafficLightInset);
  boardResizeObserver.observe(board);
  window.addEventListener('resize', syncTrafficLightInset);

  const makeRunningSpinner = (threadId) => {
    const indicator = document.createElement('span');
    indicator.className = 'attune-kanban-running-indicator';
    indicator.setAttribute('aria-label', 'Running');
    const nativeRow = [...document.querySelectorAll('[data-app-action-sidebar-thread-row]')]
      .find((row) => normalizeThreadId(row.dataset.appActionSidebarThreadId) === threadId);
    const nativeSpinner = nativeRow?.querySelector('[class*="animate-spin"]');
    if (nativeSpinner) {
      const clone = nativeSpinner.cloneNode(true);
      clone.classList.add('attune-kanban-native-spinner');
      indicator.append(clone);
      return indicator;
    }
    indicator.innerHTML = `
      <span class="attune-kanban-spinner" style="animation-delay: -${Date.now() % 1000}ms">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path opacity=".3" d="M18 12C18 8.68629 15.3137 6 12 6C8.68629 6 6 8.68629 6 12C6 15.3137 8.68629 18 12 18C15.3137 18 18 15.3137 18 12ZM20 12C20 16.4183 16.4183 20 12 20C7.58172 20 4 16.4183 4 12C4 7.58172 7.58172 4 12 4C16.4183 4 20 7.58172 20 12Z"></path>
          <path d="M12 4C16.4183 4 20 7.58172 20 12C20 16.4183 16.4183 20 12 20C7.58172 20 4 16.4183 4 12H6C6 15.3137 8.68629 18 12 18C15.3137 18 18 15.3137 18 12C18 8.68629 15.3137 6 12 6V4Z"></path>
        </svg>
      </span>
    `;
    return indicator;
  };

  const observeCardStats = (card, thread) => {
    // Diff totals require full turn history, so load them only when a card is
    // near the viewport instead of reading hundreds of threads up front.
    if (thread.statsLoaded === true) return;
    if (!statsObserver) {
      statsObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          statsObserver.unobserve(entry.target);
          queueThreadStats(entry.target.dataset.threadId);
        }
      }, { root: boardScroll, rootMargin: '160px' });
    }
    statsObserver.observe(card);
  };

  const render = () => {
    if (disposed) return;
    statsObserver?.disconnect();
    boardGrid.replaceChildren();

    for (const stage of STAGES) {
      const column = document.createElement('section');
      column.className = 'attune-kanban-column';
      column.dataset.stage = stage.id;
      const cards = threads.filter((thread) => stageFor(thread) === stage.id);
      column.innerHTML = `
        <header class="attune-kanban-column-header">
          <svg class="attune-kanban-status-icon" viewBox="0 0 24 24" aria-hidden="true">${stage.icon}</svg>
          <h2>${stage.label}</h2>
          <span class="attune-kanban-count">${cards.length}</span>
        </header>
        <div class="attune-kanban-column-body"></div>
      `;
      const body = column.querySelector('.attune-kanban-column-body');
      if (!cards.length) {
        const empty = document.createElement('div');
        empty.className = 'attune-kanban-empty';
        empty.textContent = 'No chats';
        body.append(empty);
      }

      for (const thread of cards) {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'attune-kanban-card';
        card.dataset.threadId = thread.id;
        card.setAttribute('aria-label', `Open ${thread.title}`);
        const title = document.createElement('span');
        title.className = 'attune-kanban-card-title';
        title.textContent = thread.title;
        const heading = document.createElement('span');
        heading.className = 'attune-kanban-card-heading';
        if (stage.id === 'in-progress') heading.append(makeRunningSpinner(thread.id));
        heading.append(title);
        const meta = document.createElement('span');
        meta.className = 'attune-kanban-card-meta';
        const project = document.createElement('span');
        project.className = 'attune-kanban-project';
        project.textContent = projectName(thread);
        const time = document.createElement('span');
        time.className = 'attune-kanban-card-time';
        time.textContent = relativeTime(thread.updatedAt);
        meta.append(project, time);
        card.append(heading, meta);
        const filesChanged = Number(thread.filesChanged || 0);
        const additions = Number(thread.additions || 0);
        const deletions = Number(thread.deletions || 0);
        if (thread.statsLoaded === true && (filesChanged || additions || deletions)) {
          const stats = document.createElement('span');
          stats.className = 'attune-kanban-card-stats';
          if (filesChanged) {
            const files = document.createElement('span');
            files.className = 'attune-kanban-files';
            files.textContent = `${filesChanged.toLocaleString()} ${filesChanged === 1 ? 'file' : 'files'}`;
            stats.append(files);
          }
          const added = document.createElement('span');
          added.className = 'attune-kanban-additions';
          added.textContent = `+${additions.toLocaleString()}`;
          const deleted = document.createElement('span');
          deleted.className = 'attune-kanban-deletions';
          deleted.textContent = `−${deletions.toLocaleString()}`;
          stats.append(added, deleted);
          card.append(stats);
          card.setAttribute(
            'aria-label',
            `Open ${thread.title}, ${filesChanged} files changed, ${additions} lines added, ${deletions} deleted`,
          );
        }
        card.addEventListener('click', () => openThread(thread.id));
        body.append(card);
        observeCardStats(card, thread);
      }
      boardGrid.append(column);
      const savedScrollTop = columnScrollPositions.get(stage.id) || 0;
      body.scrollTop = Math.min(savedScrollTop, Math.max(0, body.scrollHeight - body.clientHeight));
      body.addEventListener('scroll', () => {
        columnScrollPositions.set(stage.id, body.scrollTop);
      }, { passive: true });
    }

    if (!threads.length) {
      const empty = document.createElement('div');
      empty.className = 'attune-kanban-empty-board';
      empty.innerHTML = '<div><strong>No chats found</strong><br><span>Refresh after Codex has loaded your chats.</span></div>';
      boardGrid.replaceChildren(empty);
    }
  };

  const mergeThreads = (incoming) => {
    // Merge rather than replace: sidebar snapshots are intentionally sparse,
    // while network results and live patches carry complementary fields.
    const merged = new Map(threads.map((thread) => [thread.id, thread]));
    for (const incomingThread of incoming) {
      const previous = merged.get(incomingThread.id);
      if (!previous) {
        const deferred = deferredThreadPatches.get(incomingThread.id) || {};
        deferredThreadPatches.delete(incomingThread.id);
        const confirmed = { ...incomingThread, ...deferred };
        merged.set(incomingThread.id, readOverrides.has(incomingThread.id)
          ? { ...confirmed, hasUnreadTurn: false }
          : confirmed);
        continue;
      }
      const useful = Object.fromEntries(Object.entries(incomingThread).filter(([, value]) => (
        value !== undefined && value !== null && value !== ''
      )));
      const next = { ...previous, ...useful };
      if (readOverrides.has(incomingThread.id)) next.hasUnreadTurn = false;
      merged.set(incomingThread.id, next);
    }
    threads = [...merged.values()].sort((left, right) => timeValue(right.updatedAt) - timeValue(left.updatedAt));
  };

  const refresh = async (network = true) => {
    const sidebarThreads = threadsFromSidebar();
    if (sidebarThreads.length) mergeThreads(sidebarThreads);
    render();
    if (!network || networkRefreshInFlight) return;
    networkRefreshInFlight = true;
    try {
      const listed = await fetchThreads();
      if (listed.length) mergeThreads(listed);
    } catch {
      // Sidebar discovery keeps the board usable if thread/list is unavailable.
    } finally {
      networkRefreshInFlight = false;
      if (!disposed) {
        render();
      }
    }
  };

  const setNavSelected = (selected) => {
    if (!navButton) return;
    navButton.dataset.selected = String(selected);
    navButton.classList.toggle('bg-token-list-hover-background', selected);
    const content = navButton.firstElementChild;
    content?.classList.toggle('text-token-foreground', !selected);
    content?.classList.toggle('text-token-list-active-selection-foreground', selected);
    navButton.querySelector('.attune-kanban-nav-icon')?.classList.toggle(
      'text-token-list-active-selection-icon-foreground',
      selected,
    );
    if (selected) navButton.setAttribute('aria-current', 'page');
    else navButton.removeAttribute('aria-current');
  };

  const ensureBoardHost = () => {
    const main = primaryChatHost();
    if (!main) return false;
    if (board.parentElement !== main) main.append(board);
    syncTrafficLightInset();
    return true;
  };

  const controlLabel = (control) => [
    control.getAttribute('aria-label'), control.getAttribute('title'), control.textContent,
  ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();

  const isControlVisible = (control) => {
    const rect = control.getBoundingClientRect();
    const style = getComputedStyle(control);
    return rect.width > 0 && rect.height > 0
      && rect.right > 0 && rect.bottom > 0
      && rect.left < innerWidth && rect.top < innerHeight
      && style.display !== 'none' && style.visibility !== 'hidden';
  };

  const findNewChatControl = () => {
    const candidates = [...document.querySelectorAll('button, a, [role="button"]')].filter((control) => (
      !control.closest('#attune-codex-kanban, #attune-codex-kanban-nav, #attune-codex-kanban-nav-slot')
      && !control.closest('[data-app-action-sidebar-thread-row]')
      && /^(?:start\s+)?new\s+(?:chat|thread)\b/i.test(controlLabel(control))
    ));
    return candidates.find(isControlVisible) || candidates[0] || null;
  };

  const findPullRequestsControl = () => {
    const candidates = [...document.querySelectorAll('button, a, [role="button"]')].filter((control) => (
      !control.closest('#attune-codex-kanban, #attune-codex-kanban-nav, #attune-codex-kanban-nav-slot')
      && !control.closest('[data-app-action-sidebar-thread-row]')
      && /^pull requests?\b/i.test(controlLabel(control))
    ));
    return candidates.find(isControlVisible) || candidates[0] || null;
  };

  const nativeNavPlacement = (control) => {
    if (!control) return null;
    let child = control;
    let parent = control.parentElement;
    while (parent && parent !== document.body) {
      if (parent.classList.contains('flex')
        && parent.classList.contains('flex-col')
        && parent.classList.contains('gap-px')) {
        return { stack: parent, slot: child };
      }
      child = parent;
      parent = parent.parentElement;
    }
    return null;
  };

  const replaceNavText = (element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let replaced = false;
    while (walker.nextNode()) {
      const text = walker.currentNode.nodeValue || '';
      if (!/(?:new\s+(?:chat|thread)|pull requests?)/i.test(text)) continue;
      walker.currentNode.nodeValue = text.replace(
        /(?:new\s+(?:chat|thread)|pull requests?)/i,
        'Kanban',
      );
      replaced = true;
    }
    return replaced;
  };

  const makeNavIcon = () => {
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('class', 'attune-kanban-nav-icon icon-xs');
    icon.setAttribute('aria-hidden', 'true');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('fill', 'none');
    icon.setAttribute('stroke', 'currentColor');
    icon.setAttribute('stroke-width', '2');
    icon.setAttribute('stroke-linecap', 'round');
    icon.setAttribute('stroke-linejoin', 'round');
    icon.innerHTML = `
      <rect x="3" y="3" width="18" height="18" rx="2"></rect>
      <path d="M9 3v18"></path>
      <path d="M15 3v18"></path>
    `;
    return icon;
  };

  const ensureNavButton = () => {
    const newChat = findNewChatControl();
    if (!newChat) return false;
    const pullRequests = findPullRequestsControl();
    if (!navButton?.isConnected) {
      navButton = (pullRequests || newChat).cloneNode(true);
      navButton.id = 'attune-codex-kanban-nav';
      navButton.classList.add('attune-kanban-nav');
      for (const element of [navButton, ...navButton.querySelectorAll('*')]) {
        for (const attribute of [...element.attributes]) {
          if (attribute.name.startsWith('data-app-action-')) element.removeAttribute(attribute.name);
        }
      }
      navButton.removeAttribute('data-app-action-sidebar-thread-active');
      navButton.removeAttribute('data-app-action-sidebar-thread-id');
      navButton.removeAttribute('href');
      navButton.removeAttribute('target');
      navButton.querySelectorAll('[id]').forEach((element) => element.removeAttribute('id'));
      navButton.querySelectorAll('kbd, [data-slot="shortcut"]').forEach((element) => element.remove());
      if (!replaceNavText(navButton)) navButton.textContent = 'Kanban';
      const nativeIcon = navButton.querySelector('svg');
      if (nativeIcon) nativeIcon.replaceWith(makeNavIcon());
      else navButton.prepend(makeNavIcon());
      navButton.setAttribute('aria-label', 'Kanban');
      navButton.setAttribute('title', 'Kanban (⌘⇧K)');
      if (navButton.tagName === 'A') {
        navButton.setAttribute('role', 'button');
        navButton.tabIndex = 0;
        navButton.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          showBoard();
        });
      }
      navButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        showBoard();
      });
    }
    const currentPullRequests = findPullRequestsControl();
    if (currentPullRequests) {
      const placement = nativeNavPlacement(currentPullRequests);
      if (placement) {
        if (!navSlot?.isConnected || (navSlot !== navButton && !navSlot.contains(navButton))) {
          navSlot = placement.slot === currentPullRequests
            ? navButton
            : placement.slot.cloneNode(false);
          if (navSlot !== navButton) {
            navSlot.id = 'attune-codex-kanban-nav-slot';
            navSlot.removeAttribute('aria-label');
            navSlot.removeAttribute('title');
            navSlot.append(navButton);
          }
        }
        if (navSlot.parentElement !== placement.stack || navSlot.nextElementSibling !== placement.slot) {
          placement.stack.insertBefore(navSlot, placement.slot);
        }
      } else if (navButton.nextElementSibling !== currentPullRequests) {
        currentPullRequests.insertAdjacentElement('beforebegin', navButton);
        navSlot = navButton;
      }
    } else {
      const newChatToolbar = newChat.parentElement;
      if (!newChatToolbar?.parentElement) return false;
      if (newChatToolbar.nextElementSibling !== navButton) {
        newChatToolbar.insertAdjacentElement('afterend', navButton);
        navSlot = navButton;
      }
    }
    setNavSelected(boardMode);
    return true;
  };

  const showBoard = (pushHistory = true) => {
    if (!ensureBoardHost()) return;
    if (pushHistory && history.state?.[BOARD_HISTORY_KEY] !== true) {
      history.pushState({ ...history.state, [BOARD_HISTORY_KEY]: true }, '', location.href);
    }
    boardMode = true;
    board.hidden = false;
    document.body.classList.add('attune-codex-kanban-board-active');
    setNavSelected(true);
    try { sessionStorage.setItem(BOARD_ACTIVE_KEY, 'true'); } catch {}
    void refresh(true);
  };

  const hideBoard = () => {
    boardMode = false;
    board.hidden = true;
    document.body.classList.remove('attune-codex-kanban-board-active');
    setNavSelected(false);
    statsObserver?.disconnect();
    try { sessionStorage.removeItem(BOARD_ACTIVE_KEY); } catch {}
  };

  const navigateToThread = (threadId) => {
    if (!isThreadId(threadId)) return;
    const id = normalizeThreadId(threadId);
    const path = `/local/${id}`;
    const row = [...document.querySelectorAll('[data-app-action-sidebar-thread-row]')]
      .find((candidate) => threadIdFromElement(candidate) === id);
    if (row) {
      syntheticThreadNavigation = true;
      try { row.click(); } finally { syntheticThreadNavigation = false; }
    } else {
      window.postMessage({ type: 'navigate-to-route', path }, '*');
    }
    // Codex uses an in-memory router after launch, so location.pathname remains
    // the startup route and cannot confirm in-app navigation. Both native row
    // clicks and navigate-to-route dispatch synchronously to that router.
    markThreadRead(id);
    hideBoard();
  };

  const markThreadRead = (threadId) => {
    readOverrides.add(threadId);
    unreadOverrides.delete(threadId);
    saveUnreadOverrides();
    updateThread(threadId, { hasUnreadTurn: false });
  };

  const openThread = (threadId) => {
    const id = normalizeThreadId(threadId);
    if (!isThreadId(id)) return;
    navigateToThread(id);
  };

  const scheduleRefresh = (network = false) => {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => void refresh(network), 120);
  };

  const onSidebarNavigationClick = (event) => {
    if (syntheticThreadNavigation) return;
    const sidebar = sidebarHost();
    const target = event.target instanceof Element ? event.target : event.target?.parentElement;
    if (!sidebar?.contains(target) || target?.closest('#attune-codex-kanban-nav')) return;
    const threadRow = target?.closest('[data-app-action-sidebar-thread-row], [data-app-action-sidebar-thread-id], a[href*="/local/"]');
    const threadId = threadIdFromElement(threadRow);
    if (isThreadId(threadId)) markThreadRead(threadId);
    if (boardMode) hideBoard();
  };

  const onPopState = (event) => {
    if (event.state?.[BOARD_HISTORY_KEY] === true) showBoard(false);
    else if (boardMode) hideBoard();
  };
  const onKanbanShortcut = (event) => {
    if (event.defaultPrevented || event.isComposing || event.repeat) return;
    if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.altKey) return;
    if (String(event.key).toLowerCase() !== 'k') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    showBoard();
  };
  window.addEventListener('click', onSidebarNavigationClick, true);
  window.addEventListener('keydown', onKanbanShortcut, true);
  window.addEventListener('popstate', onPopState);
  window.addEventListener('message', onMessage);

  document.body.classList.add('attune-codex-kanban-enabled');
  ensureBoardHost();
  ensureNavButton();

  const observer = new MutationObserver((records) => {
    // Codex remounts sidebar and main-surface nodes during navigation. Ignore
    // our own rendering mutations to avoid a refresh feedback loop.
    const hostChanged = records.some((record) => {
      const target = record.target instanceof Element ? record.target : record.target?.parentElement;
      return target && !target.closest(
        '#attune-codex-kanban, #attune-codex-kanban-nav, #attune-codex-kanban-nav-slot',
      );
    });
    if (!hostChanged) return;
    ensureBoardHost();
    ensureNavButton();
    if (boardMode) setNavSelected(true);
    scheduleRefresh(false);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  try {
    if (history.state?.[BOARD_HISTORY_KEY] === true
      || sessionStorage.getItem(BOARD_ACTIVE_KEY) === 'true') showBoard(false);
  } catch {}
  void refresh(false);

  window.__attuneCodexKanbanCleanup = () => {
    if (disposed) return;
    disposed = true;
    window.clearTimeout(refreshTimer);
    observer.disconnect();
    boardResizeObserver.disconnect();
    statsObserver?.disconnect();
    window.removeEventListener('resize', syncTrafficLightInset);
    window.removeEventListener('click', onSidebarNavigationClick, true);
    window.removeEventListener('keydown', onKanbanShortcut, true);
    window.removeEventListener('popstate', onPopState);
    window.removeEventListener('message', onMessage);
    document.body.classList.remove('attune-codex-kanban-enabled', 'attune-codex-kanban-board-active');
    for (const waiter of pending.values()) waiter.reject(new Error('Chat Kanban closed.'));
    pending.clear();
    statsLoadQueue.length = 0;
    statsLoadQueued.clear();
    deferredThreadPatches.clear();
    columnScrollPositions.clear();
    board.remove();
    navSlot?.remove();
    if (navSlot !== navButton) navButton?.remove();
    delete window.__attuneCodexKanbanCleanup;
  };
})();
