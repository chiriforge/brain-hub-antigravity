const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const vm = require('vm');
const Module = require('module');

let currentConfig = {
  machineName: 'TestPC',
  autoSyncOnStartup: false,
  autoSyncIntervalMinutes: 0,
  filterWorkspaceByDefault: false,
  hideEmptySessions: true,
  autoReloadOnLiveChat: true,
  brainPath: '',
  messageOrder: 'newestFirst',
  sessionSortBy: 'lastModified',
  defaultToolsState: 'collapsed',
  defaultAiStepsState: 'collapsed',
  defaultHeaderState: 'expanded'
};

const mockGlobalState = new Map();
const updatedSettings = [];

const mockVscode = {
  StatusBarAlignment: { Left: 1, Right: 2 },
  ThemeColor: class ThemeColor { constructor(id) { this.id = id; } },
  ThemeIcon: class ThemeIcon { constructor(id, color) { this.id = id; this.color = color; } },
  MarkdownString: class MarkdownString {
    constructor(v = '') { this.value = v; }
    appendMarkdown(s) { this.value += s; return this; }
  },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  TreeItem: class TreeItem { constructor(label, cs) { this.label = label; this.collapsibleState = cs; } },
  EventEmitter: class EventEmitter { constructor() { this.event = () => ({ dispose: () => {} }); } fire() {} },
  Uri: {
    file: (p) => ({ fsPath: p, scheme: 'file', toString: () => `file://${p}` }),
    parse: (s) => ({ fsPath: s.replace(/^file:\/+/, ''), scheme: 'file' }),
    joinPath: (b, ...segs) => ({ fsPath: path.join(b.fsPath || '', ...segs) })
  },
  ViewColumn: { One: 1, Two: 2, Beside: -2 },
  ConfigurationTarget: { Global: 1, Workspace: 2 },
  workspace: {
    workspaceFolders: [],
    getConfiguration: () => ({
      get: (key, def) => (currentConfig[key] !== undefined ? currentConfig[key] : def),
      inspect: () => undefined,
      update: async (key, val) => {
        currentConfig[key] = val;
        updatedSettings.push({ key, val });
      }
    }),
    onDidChangeConfiguration: () => ({ dispose: () => {} }),
    onDidChangeWorkspaceFolders: () => ({ dispose: () => {} })
  },
  window: {
    createStatusBarItem: () => ({
      text: '', tooltip: undefined, command: undefined, backgroundColor: undefined,
      show() {}, hide() {}, dispose() {}
    }),
    createWebviewPanel: () => ({
      webview: {
        html: '',
        cspSource: 'vscode-webview://test',
        asWebviewUri: (u) => u,
        postMessage: async () => true,
        onDidReceiveMessage: () => ({ dispose: () => {} })
      },
      onDidDispose: () => ({ dispose: () => {} }),
      reveal() {},
      dispose() {}
    }),
    showInformationMessage: async () => undefined,
    showWarningMessage: async () => undefined,
    showErrorMessage: async () => undefined
  },
  commands: { executeCommand: async () => undefined },
  env: { openExternal: async () => true, clipboard: { writeText: async () => {} } }
};

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') return mockVscode;
  return origLoad.apply(this, arguments);
};

const { DashboardWebviewPanel } = require('../out/views/DashboardWebviewPanel');
const { ChatWebviewPanel } = require('../out/views/ChatWebviewPanel');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-hub-header-test-'));

try {
  const sessionDir = path.join(tmpDir, 'c1a33fc1-1111-2222-3333-444455556666');
  fs.mkdirSync(sessionDir, { recursive: true });
  const planFile = path.join(sessionDir, 'implementation_plan.md');
  fs.writeFileSync(planFile, '# Plan\n', 'utf8');

  const sampleSession = {
    id: 'c1a33fc1-1111-2222-3333-444455556666',
    title: 'Very Long Session Title That Should Be Clamped To A Single Line At 13px Font Size',
    firstPrompt: 'Optimize header',
    lastModified: new Date('2026-11-21T16:24:47Z'),
    createdAt: new Date('2026-11-21T15:55:19Z'),
    path: sessionDir,
    messageCount: 4,
    userPromptCount: 4,
    workspaceName: 'brain-hub-antigravity',
    workspacePath: 'd:\\chiriforge\\brain-hub-antigravity',
    machineName: 'hunglepc',
    hasArtifacts: true,
    artifactCount: 2,
    planPath: planFile,
    artifacts: [{
      name: 'implementation_plan.md',
      filePath: planFile,
      category: 'document',
      source: 'plan',
      sizeBytes: 100,
      mtime: new Date('2026-11-21T16:24:47Z')
    }],
    messages: [],
    tokenUsage: {
      plannerStepCount: 119,
      latestStepIndex: 517,
      latestInputTokens: 2500,
      latestCacheReadTokens: 419300,
      latestOutputTokens: 169,
      latestContextTokens: 421800,
      latestCacheHitRatio: 99.3,
      peakContextTokens: 421800,
      peakStepIndex: 517,
      baselineContextTokens: 25000,
      totalInputTokens: 712800,
      totalCacheReadTokens: 28110000,
      totalOutputTokens: 168700,
      cumulativeTokens: 28991500,
      overallCacheHitRatio: 97.5,
      cacheMissCount: 0,
      hasCacheMissAtTail: false,
      primaryModel: 'gemini-4-hydrogen-high',
      stepMetrics: [
        {
          stepIndex: 517,
          inputTokens: 2500,
          cacheReadTokens: 419300,
          outputTokens: 169,
          totalContextTokens: 421800,
          cacheHitRatio: 99.3,
          isCacheMiss: false,
          model: 'gemini-4-hydrogen-high'
        }
      ]
    }
  };

  const sampleMessages = [
    {
      index: 1,
      userIndex: 1,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      content: 'Optimize header',
      cleanContent: 'Optimize header',
      createdAt: '2026-11-21T15:55:19Z'
    },
    {
      index: 517,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      content: 'Done',
      cleanContent: 'Done',
      inputTokens: 2500,
      cacheReadTokens: 419300,
      outputTokens: 169,
      totalContextTokens: 421800,
      cacheHitRatio: 99.3,
      model: 'gemini-4-hydrogen-high',
      createdAt: '2026-11-21T16:24:47Z'
    }
  ];

  DashboardWebviewPanel.setGlobalContext({
    extensionUri: mockVscode.Uri.file(tmpDir),
    globalState: {
      get: (k, d) => (mockGlobalState.has(k) ? mockGlobalState.get(k) : d),
      update: async (k, v) => mockGlobalState.set(k, v)
    }
  });

  const dashboard = Object.create(DashboardWebviewPanel.prototype);
  dashboard.isDisposed = false;
  dashboard.isShowingCombinedThread = false;
  dashboard.selectedSessionId = sampleSession.id;
  dashboard.extensionUri = mockVscode.Uri.file(tmpDir);
  dashboard.panel = {
    webview: {
      asWebviewUri: (u) => u,
      cspSource: 'vscode-webview://test',
      postMessage: async () => true
    }
  };

  const cfgState = {
    machineName: 'TestPC',
    autoSyncOnStartup: false,
    autoSyncIntervalMinutes: 0,
    filterWorkspaceByDefault: false,
    hideEmptySessions: true,
    autoReloadOnLiveChat: true,
    brainPath: '',
    defaultBrainDir: '',
    messageOrder: 'newestFirst',
    sessionSortBy: 'lastModified',
    defaultToolsState: 'collapsed',
    defaultAiStepsState: 'collapsed',
    defaultHeaderState: 'expanded'
  };

  console.log('1. Checking Dashboard compact header, naked styles, and >> overflow (AC-1, AC-2)...');
  const fullDashHtml = dashboard.generateDashboardHtml([sampleSession], sampleSession, sampleMessages, [sampleSession], cfgState, false);
  const readerHtml = dashboard.generateReaderHtml(sampleSession, sampleMessages, [sampleSession], cfgState, false);

  assert(!fullDashHtml.includes('class="app-title-icon"'), 'Dashboard header must omit Brain Hub SVG icon');
  assert(!fullDashHtml.includes('class="branding-badge"'), 'Dashboard header must omit convo count badge');
  assert(!fullDashHtml.includes('<span class="app-version-text"'), 'Dashboard header must move version into tooltip instead of inline span');
  assert(fullDashHtml.includes('id="dashboardTopActionsOverflowBtn"'), 'Dashboard top actions must have overflow button');
  assert(!fullDashHtml.includes('>&gt;&gt;</button>'), 'Overflow buttons must not render raw >> text');
  assert(fullDashHtml.includes('padding: 6px 12px;'), 'Dashboard header must use compact 6px 12px padding');
  assert(fullDashHtml.includes('cfgDefaultHeaderState'), 'Settings modal must expose defaultHeaderState select');

  assert(!readerHtml.includes('class="artifacts-bar"'), 'Reader must omit separate .artifacts-bar');
  assert(!readerHtml.includes('>Live</span>'), 'Pills row must omit text "Live"');
  assert(!readerHtml.includes('Single Chat'), 'Pills row must omit text "Single Chat"');
  assert(!readerHtml.includes('Artifacts</span>'), 'Pills row must omit word "Artifacts"');
  assert(readerHtml.includes('💬1') || readerHtml.includes('💬4'), 'Pills row must merge chat icon and user prompt count');
  assert(readerHtml.includes('🤖517'), 'Pills row must render adjacent AI steps icon+count');
  assert(readerHtml.includes('📦2'), 'Pills row must render icon+count for artifacts');
  assert(readerHtml.includes('id="headerMetaOverflowBtn"'), 'Pills row must include overflow button');
  assert(readerHtml.includes('id="headerCollapseToggleBtn"'), 'Reader title row must include collapse/expand toggle button');
  assert(readerHtml.includes('id="headerCollapsedStrip"'), 'Reader must include 1-line collapsed summary strip');
  assert(readerHtml.includes('<svg viewBox="0 0 16 16"'), 'Header controls must use crisp SVG icons');
  assert(!fullDashHtml.includes('.header-left-section .action-btn.active {\n        background: var(--btn-hover);'), 'Sidebar toggle active state must not use gray hover background');

  // Verify Toolbar appears ABOVE #readerTokenBanner
  const toolbarIdx = readerHtml.indexOf('class="reader-combined-toolbar"');
  const tokenIdx = readerHtml.indexOf('id="readerTokenBanner"');
  assert(toolbarIdx !== -1 && tokenIdx !== -1 && toolbarIdx < tokenIdx, 'Toolbar must appear above #readerTokenBanner');
  console.log('✓ 1: Dashboard header layout, naked pills, >> overflow, and toolbar-above-token verified');

  console.log('2. Checking Collapsed 1-line mode & direct token chart toggle (AC-3, AC-4)...');
  const collapsedReaderHtml = dashboard.generateReaderHtml(
    sampleSession,
    sampleMessages,
    [sampleSession],
    { ...cfgState, defaultHeaderState: 'collapsed' },
    false
  );
  assert(collapsedReaderHtml.includes('class="reader-header header-collapsed"'), 'Collapsed config must render .header-collapsed on #readerHeader');
  const stripStart = collapsedReaderHtml.indexOf('id="headerCollapsedStrip"');
  const stripEnd = collapsedReaderHtml.indexOf('</div>', stripStart + 50);
  const stripSegment = collapsedReaderHtml.slice(stripStart, collapsedReaderHtml.indexOf('class="reader-combined-toolbar"'));
  assert(stripSegment.includes('live-dot'), 'Collapsed strip must start with Live green dot');
  assert(stripSegment.includes('🔴'), 'Collapsed strip must show colored status dot for latest ctx');
  assert(stripSegment.includes('💬1') || stripSegment.includes('💬4'), 'Collapsed strip must show single/thread icon and user chat count');
  assert(stripSegment.includes('📦2'), 'Collapsed strip must show artifact icon+count');
  assert(stripSegment.includes('🤖517'), 'Collapsed strip must show AI steps');
  assert(stripSegment.includes('💰') && stripSegment.includes('⚡') && stripSegment.includes('📥'), 'Collapsed strip must show Cost, Latest Ctx, Total Input');
  assert(stripSegment.includes('toggleCollapsedTokenChart'), 'Collapsed token segment must trigger chart drawer toggle');

  // Simulate toggleHeaderCollapse & toggleCollapsedTokenChart in VM
  const postedMessages = [];
  const fakeHeaderEl = { classList: new Set(['reader-header', 'header-collapsed']) };
  fakeHeaderEl.classList.toggle = function (cls, force) {
    const has = this.has(cls);
    const next = force !== undefined ? !!force : !has;
    if (next) this.add(cls); else this.delete(cls);
    return next;
  };
  fakeHeaderEl.classList.contains = function (cls) { return this.has(cls); };

  const fakeDrawer = { open: false };
  const fakeBtn = { innerHTML: '', textContent: '', title: '' };
  const toggleContext = {
    headerCollapsedState: true,
    headerScrollCollapsed: false,
    scrollAutoCollapseSuppressed: false,
    document: {
      getElementById: (id) => {
        if (id === 'readerHeader' || id === 'chatHeaderContainer') return fakeHeaderEl;
        if (id === 'tokenTelemetryDrawer') return fakeDrawer;
        if (id === 'headerCollapseToggleBtn') return fakeBtn;
        return null;
      }
    },
    vscode: { postMessage: (m) => postedMessages.push(m) }
  };

  // Extract toggleHeaderCollapse & toggleCollapsedTokenChart from Dashboard script
  const scriptMatches = [...fullDashHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  const mainDashScript = scriptMatches.map((m) => m[1]).find((s) => s.includes('function toggleHeaderCollapse'));
  assert(mainDashScript, 'Dashboard HTML must define toggleHeaderCollapse()');
  assert(mainDashScript.includes('function toggleCollapsedTokenChart'), 'Dashboard HTML must define toggleCollapsedTokenChart()');
  assert(mainDashScript.includes('function updateHeaderScrollCollapse'), 'Dashboard HTML must define updateHeaderScrollCollapse()');

  const startIdx = mainDashScript.indexOf('const HEADER_COLLAPSED_SVG');
  const endIdx = mainDashScript.indexOf('window.syncHeaderCollapseUi = syncHeaderCollapseUi;');
  assert(startIdx !== -1 && endIdx !== -1 && endIdx > startIdx, 'Must extract collapse functions cleanly');
  vm.runInNewContext(mainDashScript.slice(startIdx, endIdx), toggleContext);

  // While collapsed, clicking token segment toggles chart WITHOUT expanding header
  toggleContext.toggleCollapsedTokenChart();
  assert.strictEqual(fakeDrawer.open, true, 'Clicking token segment in collapsed mode must open #tokenTelemetryDrawer');
  assert.strictEqual(fakeHeaderEl.classList.contains('header-collapsed'), true, 'Header must stay collapsed when toggling chart');
  toggleContext.toggleCollapsedTokenChart();
  assert.strictEqual(fakeDrawer.open, false, 'Clicking token segment again must close #tokenTelemetryDrawer');

  // Clicking header collapse toggle expands header and posts config persistence
  toggleContext.toggleHeaderCollapse();
  assert.strictEqual(fakeHeaderEl.classList.contains('header-collapsed'), false, 'toggleHeaderCollapse must expand header');
  assert(fakeBtn.innerHTML.includes('<svg'), 'toggleHeaderCollapse must render SVG chevron icon');
  assert(postedMessages.some((m) => m.command === 'setHeaderCollapsed' && m.collapsed === false), 'toggleHeaderCollapse must post persistence message');

  // Scroll-driven auto-collapse when expanded: collapses on scroll down > 90, expands on return <= 12
  toggleContext.updateHeaderScrollCollapse(150, 1200, 500);
  assert.strictEqual(fakeHeaderEl.classList.contains('header-scroll-collapsed'), true, 'Scrolling down in expanded mode must apply .header-scroll-collapsed');
  assert.strictEqual(fakeHeaderEl.classList.contains('header-collapsed'), false, 'Auto-collapse must not set manual .header-collapsed');
  toggleContext.updateHeaderScrollCollapse(5, 1200, 500);
  assert.strictEqual(fakeHeaderEl.classList.contains('header-scroll-collapsed'), false, 'Scrolling back to top must restore expanded header');

  // Verify layoutOverflowRow does not hide flex-end buttons when totalWidth <= clientWidth
  const makeChild = (width) => ({
    classList: new Set(),
    getBoundingClientRect: () => ({ width, right: 300 }),
    classListApi: true
  });
  const children = [1, 2, 3, 4, 5].map(() => makeChild(24));
  children.forEach((c) => {
    const s = c.classList;
    c.classList = {
      add: (x) => s.add(x),
      remove: (x) => s.delete(x),
      contains: (x) => s.has(x)
    };
  });
  const overflowBtn = { style: { display: 'none' } };
  const flexEndContainer = {
    clientWidth: 300,
    children: [...children, overflowBtn],
    getBoundingClientRect: () => ({ right: 300 })
  };
  const overflowContext = {
    window: { getComputedStyle: () => ({ columnGap: '2px' }) },
    document: {
      getElementById: (id) => (id === 'dashboardTopActions' ? flexEndContainer : id === 'dashboardTopActionsOverflowBtn' ? overflowBtn : null)
    }
  };
  const ovStart = mainDashScript.indexOf('function layoutOverflowRow(');
  const ovEnd = mainDashScript.indexOf('function layoutAllOverflowRows()');
  vm.runInNewContext(mainDashScript.slice(ovStart, ovEnd), overflowContext);
  overflowContext.layoutOverflowRow('dashboardTopActions', 'dashboardTopActionsOverflowBtn');
  assert.strictEqual(overflowBtn.style.display, 'none', 'Flex-end items fitting within clientWidth must NOT trigger overflow');
  assert.strictEqual(children.every((c) => !c.classList.contains('overflow-hidden-item')), true, 'Clean Up button must remain visible when width suffices');

  flexEndContainer.clientWidth = 90;
  overflowContext.layoutOverflowRow('dashboardTopActions', 'dashboardTopActionsOverflowBtn');
  assert.strictEqual(overflowBtn.style.display, 'inline-flex', 'Overflowing container must display overflow button');
  assert.strictEqual(children[4].classList.contains('overflow-hidden-item'), true, 'Last button must move to overflow menu when width is insufficient');
  console.log('✓ 2: Collapsed 1-line mode & direct chart toggle verified');

  console.log('3. Checking ChatWebviewPanel parity (AC-5)...');
  const chatPanel = Object.create(ChatWebviewPanel.prototype);
  chatPanel.isShowingCombinedThread = false;
  chatPanel.extensionUri = mockVscode.Uri.file(tmpDir);
  chatPanel.panel = {
    webview: {
      asWebviewUri: (u) => u,
      cspSource: 'vscode-webview://test',
      postMessage: async () => true
    }
  };
  const chatHtml = chatPanel.generateHtml(sampleSession, sampleMessages, [sampleSession]);
  const chatHeaderHtml = chatHtml.slice(chatHtml.indexOf('<header'), chatHtml.indexOf('</header>'));
  assert(!chatHtml.includes('class="artifacts-bar"'), 'ChatWebviewPanel must omit .artifacts-bar');
  assert(!chatHeaderHtml.includes('Single Chat'), 'ChatWebviewPanel must omit text "Single Chat"');
  assert(!chatHeaderHtml.includes('Artifacts</span>'), 'ChatWebviewPanel must omit word "Artifacts"');
  assert(chatHeaderHtml.includes('📦2'), 'ChatWebviewPanel header must show 📦2');
  assert(chatHeaderHtml.includes('id="headerMetaOverflowBtn"'), 'ChatWebviewPanel must include >> overflow button');
  assert(chatHeaderHtml.includes('id="headerCollapseToggleBtn"'), 'ChatWebviewPanel must include collapse toggle button');
  assert(chatHeaderHtml.includes('id="headerCollapsedStrip"'), 'ChatWebviewPanel must include 1-line collapsed strip');
  const chatToolbarIdx = chatHeaderHtml.indexOf('class="header-combined-toolbar"');
  const chatTokenIdx = chatHeaderHtml.indexOf('id="readerTokenBanner"');
  assert(chatToolbarIdx !== -1 && chatTokenIdx !== -1 && chatToolbarIdx < chatTokenIdx, 'ChatWebviewPanel toolbar must appear above #readerTokenBanner');
  console.log('✓ 3: ChatWebviewPanel structural parity verified');

  console.log('=== All Compact Header & Per-Model Threshold Tests Passed! ===');
} finally {
  Module._load = origLoad;
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
