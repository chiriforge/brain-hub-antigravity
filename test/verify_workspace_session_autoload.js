const assert = require('assert');
const fs = require('fs');
const Module = require('module');

// Mock vscode module for unit testing SessionScanner, ChatHistoryTreeProvider & DashboardWebviewPanel in Node
const mockWorkspaceStateStore = new Map();
const mockGlobalStateStore = new Map();
let mockWorkspaceFolders = [
  {
    uri: { fsPath: 'd:\\chiriforge\\brain-hub-antigravity' },
    name: 'brain-hub-antigravity',
    index: 0
  }
];
let mockActiveTextEditor = undefined;
const mockConfigStore = new Map([
  ['sessionSortBy', 'lastModified'],
  ['filterWorkspaceByDefault', false],
  ['hideEmptySessions', true],
  ['defaultGroupExpansion', 'smart'],
  ['messageOrder', 'newestFirst']
]);

let lastWebviewMessageHandler = null;
let postedWebviewMessages = [];

const vscodeMock = {
  workspace: {
    get workspaceFolders() {
      return mockWorkspaceFolders;
    },
    getWorkspaceFolder: (uri) => {
      if (!uri || !uri.fsPath || !mockWorkspaceFolders) return undefined;
      const normUri = uri.fsPath.replace(/\\/g, '/').toLowerCase();
      return mockWorkspaceFolders.find((wf) => {
        const normWf = wf.uri.fsPath.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
        return normUri === normWf || normUri.startsWith(normWf + '/');
      });
    },
    getConfiguration: () => ({
      get: (key, defaultVal) => (mockConfigStore.has(key) ? mockConfigStore.get(key) : defaultVal),
      inspect: () => undefined,
      update: async (key, val) => {
        mockConfigStore.set(key, val);
      }
    }),
    onDidChangeWorkspaceFolders: () => ({ dispose: () => {} }),
    onDidChangeConfiguration: () => ({ dispose: () => {} })
  },
  window: {
    get activeTextEditor() {
      return mockActiveTextEditor;
    },
    createWebviewPanel: () => ({
      webview: {
        html: '',
        postMessage: async (msg) => {
          postedWebviewMessages.push(msg);
          return true;
        },
        onDidReceiveMessage: (cb) => {
          lastWebviewMessageHandler = cb;
          return { dispose: () => {} };
        },
        asWebviewUri: (u) => u
      },
      reveal: () => {},
      onDidDispose: () => ({ dispose: () => {} }),
      dispose: () => {}
    }),
    showInformationMessage: () => {},
    showWarningMessage: () => {},
    showErrorMessage: () => {}
  },
  Uri: {
    file: (p) => ({ fsPath: p, toString: () => `file:///${p.replace(/\\/g, '/')}` }),
    joinPath: (base, ...segments) => ({
      fsPath: [base.fsPath, ...segments].join('/'),
      toString: () => `file:///${[base.fsPath, ...segments].join('/')}`
    }),
    parse: (s) => ({ fsPath: s.replace(/^file:\/+/, ''), toString: () => s })
  },
  ViewColumn: { One: 1, Active: -1 },
  TreeItem: class {
    constructor(label, collapsibleState) {
      this.label = label;
      this.collapsibleState = collapsibleState;
    }
  },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  ThemeIcon: class {
    constructor(id) {
      this.id = id;
    }
  },
  EventEmitter: class {
    constructor() {
      this.event = () => {};
    }
    fire() {}
  }
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    return vscodeMock;
  }
  return originalLoad.apply(this, arguments);
};

const { SessionScanner } = require('../out/services/SessionScanner');
const { DashboardWebviewPanel } = require('../out/views/DashboardWebviewPanel');
const { ChatHistoryTreeProvider } = require('../out/providers/ChatHistoryTreeProvider');

async function runVerificationSuite() {
  console.log('=== Tier 1 & Tier 5: SessionScanner Multi-Line Active Workspaces & Boundary Matching ===');

  // 1. Verify CACHE_SCHEMA_VERSION === 3
  assert.strictEqual(
    SessionScanner.CACHE_SCHEMA_VERSION,
    3,
    'SessionScanner.CACHE_SCHEMA_VERSION must be bumped to 3'
  );

  // 2. Verify multi-line Active Workspaces bullet extraction & priority over subsequent CWD
  const scanner = SessionScanner.getInstance();
  const sampleUserInfoMultiLine = `<user_information>
The USER's OS version is windows.
Active Workspaces:
- d:\\chiriforge\\brain-hub-antigravity
- d:\\chiriforge\\gemini-dotfiles
</user_information>
Running tool in CWD: d:\\temp\\some-other-folder`;

  const extractedWs = scanner.extractWorkspaceFromContent(sampleUserInfoMultiLine);
  assert.strictEqual(
    SessionScanner.normalizeWorkspacePath(extractedWs || ''),
    'd:/chiriforge/brain-hub-antigravity',
    'AC-1.1: Should extract first valid path from multi-line Active Workspaces bullet list and prioritize it over CWD'
  );

  // POSIX multi-line Active Workspaces
  const samplePosixMultiLine = `<user_information>
Active Workspaces:
- /Users/developer/workspace/brain-hub-antigravity
</user_information>`;
  assert.strictEqual(
    SessionScanner.normalizeWorkspacePath(scanner.extractWorkspaceFromContent(samplePosixMultiLine) || ''),
    '/users/developer/workspace/brain-hub-antigravity',
    'Tier 5: Should extract POSIX path from multi-line Active Workspaces bullet list'
  );

  // 3. Verify normalizeWorkspacePath
  assert.strictEqual(
    SessionScanner.normalizeWorkspacePath('D:\\ChiriForge\\brain-hub-antigravity\\'),
    'd:/chiriforge/brain-hub-antigravity',
    'normalizeWorkspacePath should normalize slashes, strip trailing slashes, and lowercase'
  );
  assert.strictEqual(
    SessionScanner.normalizeWorkspacePath(''),
    '',
    'normalizeWorkspacePath should return empty string on empty input'
  );

  // 4. Verify isPathBoundaryMatch (AC-1.2 & AC-1.3)
  assert.strictEqual(
    SessionScanner.isPathBoundaryMatch('d:\\chiriforge\\brain-hub-antigravity', 'd:/chiriforge/brain-hub'),
    false,
    'AC-1.2: Sibling prefix d:/chiriforge/brain-hub must NOT match d:/chiriforge/brain-hub-antigravity'
  );
  assert.strictEqual(
    SessionScanner.isPathBoundaryMatch('d:/chiriforge/brain-hub', 'd:/chiriforge/brain-hub-antigravity'),
    false,
    'AC-1.2: Symmetric sibling prefix check must return false'
  );
  assert.strictEqual(
    SessionScanner.isPathBoundaryMatch('d:\\chiriforge\\monorepo\\packages\\web', 'd:/chiriforge/monorepo'),
    true,
    'AC-1.3: Nested monorepo subfolder must match parent workspace root'
  );
  assert.strictEqual(
    SessionScanner.isPathBoundaryMatch('d:/chiriforge/monorepo', 'd:\\chiriforge\\monorepo\\packages\\web'),
    true,
    'AC-1.3: Parent workspace root must match nested monorepo subfolder'
  );

  // 5. Verify matchSessionToWorkspaceFolder (Tier 1A vs Tier 1B vs Sibling Rejection)
  const sessionExact = {
    id: 's1',
    workspacePath: 'd:\\chiriforge\\brain-hub-antigravity',
    workspaceName: 'brain-hub-antigravity'
  };
  assert.strictEqual(
    SessionScanner.matchSessionToWorkspaceFolder(sessionExact, 'd:\\chiriforge\\brain-hub-antigravity', 'brain-hub-antigravity'),
    'tier1a_path',
    'Tier 1A should match exact workspace path'
  );
  assert.strictEqual(
    SessionScanner.matchSessionToWorkspaceFolder(sessionExact, 'd:\\chiriforge\\brain-hub', 'brain-hub'),
    null,
    'Sibling folder must return null'
  );

  const sessionCrossMachine = {
    id: 's2',
    workspacePath: '/Users/dev/projects/brain-hub-antigravity',
    workspaceName: 'brain-hub-antigravity'
  };
  assert.strictEqual(
    SessionScanner.matchSessionToWorkspaceFolder(sessionCrossMachine, 'd:\\chiriforge\\brain-hub-antigravity', 'brain-hub-antigravity'),
    'tier1b_name',
    'Tier 1B should match cross-machine session with same workspaceName'
  );

  // ChatHistoryTreeProvider boundary filter check
  const treeProvider = new ChatHistoryTreeProvider();
  const filteredByTree = treeProvider.filterSessionsByWorkspace([
    sessionExact,
    {
      id: 'sibling_false_positive',
      workspacePath: 'd:\\chiriforge\\brain-hub-antigravity-v2',
      workspaceName: 'brain-hub-antigravity-v2'
    }
  ]);
  assert.strictEqual(filteredByTree.length, 1, 'ChatHistoryTreeProvider must reject sibling prefix sessions');
  assert.strictEqual(filteredByTree[0].id, 's1');

  console.log('✓ Tier 1 & Tier 5 SessionScanner & TreeProvider assertions passed!');

  console.log('=== Tier 1, Tier 2 & Tier 5: 4-Layer Session Resolution Pipeline & workspaceState Affinity ===');

  const mockContext = {
    workspaceState: {
      get: (k, def) => (mockWorkspaceStateStore.has(k) ? mockWorkspaceStateStore.get(k) : def),
      update: async (k, v) => {
        if (v === undefined) {
          mockWorkspaceStateStore.delete(k);
        } else {
          mockWorkspaceStateStore.set(k, v);
        }
      }
    },
    globalState: {
      get: (k, def) => (mockGlobalStateStore.has(k) ? mockGlobalStateStore.get(k) : def),
      update: async (k, v) => mockGlobalStateStore.set(k, v)
    }
  };

  DashboardWebviewPanel.setGlobalContext(mockContext);

  const testSessions = [
    {
      id: 'global_newest_other_proj',
      title: 'Other Project Chat',
      workspacePath: 'd:\\chiriforge\\other-project',
      workspaceName: 'other-project',
      lastModified: new Date('2026-11-08T15:00:00Z'),
      createdAt: new Date('2026-11-08T14:00:00Z'),
      messageCount: 5
    },
    {
      id: 'sibling_prefix_proj',
      title: 'Sibling Prefix Project Chat',
      workspacePath: 'd:\\chiriforge\\brain-hub-antigravity-extra',
      workspaceName: 'brain-hub-antigravity-extra',
      lastModified: new Date('2026-11-08T14:50:00Z'),
      createdAt: new Date('2026-11-08T13:50:00Z'),
      messageCount: 3
    },
    {
      id: 'current_ws_latest',
      title: 'Current Workspace Latest Chat',
      workspacePath: 'd:\\chiriforge\\brain-hub-antigravity',
      workspaceName: 'brain-hub-antigravity',
      lastModified: new Date('2026-11-08T12:00:00Z'),
      createdAt: new Date('2026-11-08T10:00:00Z'),
      messageCount: 8
    },
    {
      id: 'current_ws_older_created_later',
      title: 'Current Workspace Created Later Chat',
      workspacePath: 'd:\\chiriforge\\brain-hub-antigravity',
      workspaceName: 'brain-hub-antigravity',
      lastModified: new Date('2026-10-15T12:00:00Z'),
      createdAt: new Date('2026-11-08T13:30:00Z'),
      messageCount: 4
    },
    {
      id: 'pathless_discussion',
      title: 'Pure Text Discussion',
      workspacePath: undefined,
      workspaceName: undefined,
      lastModified: new Date('2026-11-08T14:30:00Z'),
      createdAt: new Date('2026-11-08T09:00:00Z'),
      messageCount: 2
    }
  ];

  // Zero-session edge case
  assert.strictEqual(
    DashboardWebviewPanel.resolveInitialSessionId([]),
    undefined,
    'Tier 2: Empty sessions array must return undefined without throwing'
  );

  // AC-2.1: Layer 1 selects current_ws_latest (not global_newest_other_proj or sibling_prefix_proj)
  mockWorkspaceStateStore.clear();
  mockConfigStore.set('sessionSortBy', 'lastModified');
  const resolvedLayer1 = DashboardWebviewPanel.resolveInitialSessionId(testSessions);
  assert.strictEqual(
    resolvedLayer1,
    'current_ws_latest',
    'AC-2.1: Layer 1 must select current_ws_latest for current workspace'
  );
  assert.strictEqual(
    mockWorkspaceStateStore.get('brainHub.lastSessionId'),
    'current_ws_latest',
    'AC-2.1: Layer 1 must persist resolved session ID to workspaceState'
  );

  // Tier 5: Respect brainHub.sessionSortBy = 'createdAt'
  mockConfigStore.set('sessionSortBy', 'createdAt');
  const resolvedByCreatedAt = DashboardWebviewPanel.resolveInitialSessionId(testSessions);
  assert.strictEqual(
    resolvedByCreatedAt,
    'current_ws_older_created_later',
    'Tier 5: When sessionSortBy is createdAt, Layer 1 must select session with newest createdAt'
  );
  mockConfigStore.set('sessionSortBy', 'lastModified');

  // AC-2.2: Layer 0 explicit session ID override
  const resolvedLayer0 = DashboardWebviewPanel.resolveInitialSessionId(testSessions, 'current_ws_older_created_later');
  assert.strictEqual(
    resolvedLayer0,
    'current_ws_older_created_later',
    'AC-2.2: Layer 0 explicit initialSessionId must override Layer 1'
  );

  // AC-2.3: Foreign workspace session selection must NOT pollute workspaceState('brainHub.lastSessionId')
  DashboardWebviewPanel.persistWorkspaceSessionAffinity(testSessions[0]); // global_newest_other_proj
  assert.strictEqual(
    mockWorkspaceStateStore.get('brainHub.lastSessionId'),
    'current_ws_older_created_later',
    'AC-2.3: Selecting a foreign workspace session must NOT overwrite workspaceState lastSessionId'
  );

  // AC-2.3: Newer pathless session in workspaceState beats older Layer 1 session
  DashboardWebviewPanel.persistWorkspaceSessionAffinity(testSessions[4]); // pathless_discussion (lastModified 14:30 > 12:00)
  assert.strictEqual(
    mockWorkspaceStateStore.get('brainHub.lastSessionId'),
    'pathless_discussion',
    'AC-2.3: Pathless session selected in current workspace must be persisted to workspaceState'
  );
  const resolvedLayer2NewerPathless = DashboardWebviewPanel.resolveInitialSessionId(testSessions);
  assert.strictEqual(
    resolvedLayer2NewerPathless,
    'pathless_discussion',
    'AC-2.3: Newer pathless session in workspaceState should be selected over older Layer 1 session'
  );

  // AC-2.3: Stale/deleted session ID in workspaceState is ignored and falls back to Layer 3 when Layer 1 has 0 matches
  mockWorkspaceFolders = [
    {
      uri: { fsPath: 'd:\\chiriforge\\brand-new-workspace' },
      name: 'brand-new-workspace',
      index: 0
    }
  ];
  mockWorkspaceStateStore.set('brainHub.lastSessionId', 'deleted_non_existent_session_id');
  const resolvedStaleFallback = DashboardWebviewPanel.resolveInitialSessionId(testSessions);
  assert.strictEqual(
    resolvedStaleFallback,
    'global_newest_other_proj',
    'AC-2.3: When Layer 1 has 0 matches and workspaceState ID is stale, must fall back to Layer 3 global latest'
  );

  // Tier 5: Multi-root workspace activeTextEditor prioritization
  mockWorkspaceFolders = [
    {
      uri: { fsPath: 'd:\\chiriforge\\other-project' },
      name: 'other-project',
      index: 0
    },
    {
      uri: { fsPath: 'd:\\chiriforge\\brain-hub-antigravity' },
      name: 'brain-hub-antigravity',
      index: 1
    }
  ];
  mockActiveTextEditor = {
    document: {
      uri: { fsPath: 'd:\\chiriforge\\brain-hub-antigravity\\src\\extension.ts' }
    }
  };
  mockWorkspaceStateStore.clear();
  const resolvedMultiRoot = DashboardWebviewPanel.resolveInitialSessionId(testSessions);
  assert.strictEqual(
    resolvedMultiRoot,
    'current_ws_latest',
    'Tier 5: Multi-root workspace must prioritize the workspace folder containing activeTextEditor'
  );
  mockActiveTextEditor = undefined;

  // AC-2.4: Empty Window Guard clears workspaceState and falls back to Layer 3 (sessions[0])
  mockWorkspaceFolders = [];
  const resolvedEmptyWindow = DashboardWebviewPanel.resolveInitialSessionId(testSessions);
  assert.strictEqual(
    resolvedEmptyWindow,
    'global_newest_other_proj',
    'AC-2.4: Empty window must fall back to Layer 3 global latest (sessions[0])'
  );
  assert.strictEqual(
    mockWorkspaceStateStore.get('brainHub.lastSessionId'),
    undefined,
    'AC-2.4: Empty window must clear workspaceState brainHub.lastSessionId'
  );

  console.log('✓ Tier 1, Tier 2 & Tier 5 resolution pipeline assertions passed!');

  console.log('=== Tier 3, Tier 4 & Tier 6: Cold-Cache Handshake, Sidebar Auto-Expand & Source Invariants ===');

  // Restore workspace folder for DashboardWebviewPanel instance test
  mockWorkspaceFolders = [
    {
      uri: { fsPath: 'd:\\chiriforge\\brain-hub-antigravity' },
      name: 'brain-hub-antigravity',
      index: 0
    }
  ];

  // Test generateSessionListHtml auto-opening older time group when selectedSessionId is in 'older'
  const panelProto = DashboardWebviewPanel.prototype;
  const sessionListHtml = panelProto.generateSessionListHtml.call(
    { selectedSessionId: 'current_ws_older_created_later', renderSessionNavItemHtml: panelProto.renderSessionNavItemHtml },
    testSessions,
    'current_ws_older_created_later'
  );
  assert(
    /<details class="session-time-group"\s+open\s+data-group="older">/.test(sessionListHtml),
    'AC-3.1: Parent <details class="session-time-group" open data-group="older"> must be open when selected session is in Older group'
  );
  assert(
    sessionListHtml.includes('class="session-nav-item selected"') &&
      sessionListHtml.includes('data-id="current_ws_older_created_later"'),
    'AC-3.1: Selected workspace session must have .session-nav-item.selected class'
  );
  assert(
    sessionListHtml.includes('data-ws-path="d:/chiriforge/brain-hub-antigravity"'),
    'FR-1.4: data-ws-path must be normalized with forward slashes'
  );

  // Live functional Cold-Cache Handshake & Deleted-Session Recovery test (AC-2.5)
  const origHasValidCache = scanner.hasValidCache.bind(scanner);
  const origScanSessions = scanner.scanSessions.bind(scanner);
  const origLoadFullSession = scanner.loadFullSession.bind(scanner);

  let coldCacheScanned = false;
  scanner.hasValidCache = () => false;
  scanner.scanSessions = async () => {
    coldCacheScanned = true;
    return testSessions;
  };
  scanner.loadFullSession = async (id) => ({
    session: testSessions.find((s) => s.id === id) || testSessions[0],
    messages: []
  });

  DashboardWebviewPanel.currentPanel = undefined;
  mockWorkspaceStateStore.clear();
  const coldPanel = DashboardWebviewPanel.createOrShow({ fsPath: process.cwd() });
  assert.strictEqual(coldPanel.isHtmlInitialized, false, 'AC-2.5: Cold cache must start with skeleton HTML (isHtmlInitialized = false)');
  assert.strictEqual(coldPanel.selectedSessionId, undefined, 'AC-2.5: Cold cache starts with selectedSessionId = undefined before handshake');

  // Simulate webview posting dashboardReady immediately
  assert(typeof lastWebviewMessageHandler === 'function', 'onDidReceiveMessage handler must be registered');
  await lastWebviewMessageHandler({ command: 'dashboardReady' });
  assert.strictEqual(coldCacheScanned, true, 'AC-2.5: dashboardReady on cold cache must immediately trigger updateContent() -> scanSessions()');
  assert.strictEqual(coldPanel.isHtmlInitialized, true, 'AC-2.5: updateContent() must initialize dashboard HTML');
  assert.strictEqual(
    coldPanel.selectedSessionId,
    'current_ws_latest',
    'AC-2.5: Cold-cache dashboardReady must resolve current workspace latest session'
  );

  // Simulate deleting current_ws_latest and calling updateContent()
  const remainingAfterDelete = testSessions.filter((s) => s.id !== 'current_ws_latest');
  scanner.scanSessions = async () => remainingAfterDelete;
  await coldPanel.updateContent(true);
  assert.strictEqual(
    coldPanel.selectedSessionId,
    'current_ws_older_created_later',
    'AC-2.5: When active session is deleted, updateContent() must re-resolve to next workspace session'
  );

  // Simulate clicking Latest button (selectLatestSession) while viewing an older session
  scanner.scanSessions = async () => testSessions;
  await lastWebviewMessageHandler({ command: 'selectLatestSession' });
  assert.strictEqual(
    coldPanel.selectedSessionId,
    'current_ws_latest',
    'AC-4.1: Clicking Latest button (selectLatestSession) must jump to current workspace latest session'
  );

  coldPanel.dispose();
  scanner.hasValidCache = origHasValidCache;
  scanner.scanSessions = origScanSessions;
  scanner.loadFullSession = origLoadFullSession;

  // Verify source code contracts in DashboardWebviewPanel.ts, ChatHistoryTreeProvider.ts, ProjectDocsArchiver.ts, extension.ts
  const dashSrc = fs.readFileSync('src/views/DashboardWebviewPanel.ts', 'utf8');
  const treeSrc = fs.readFileSync('src/providers/ChatHistoryTreeProvider.ts', 'utf8');
  const archiverSrc = fs.readFileSync('src/services/ProjectDocsArchiver.ts', 'utf8');
  const extSrc = fs.readFileSync('src/extension.ts', 'utf8');

  assert(
    /if \(!this\.isHtmlInitialized \|\| !this\.selectedSessionId\)\s*\{\s*await this\.updateContent\(\);/.test(dashSrc),
    'AC-2.5: dashboardReady must immediately invoke await this.updateContent() on cold cache'
  );
  assert(
    dashSrc.includes("const latestId = DashboardWebviewPanel.resolveInitialSessionId(sorted) || sorted[0].id;"),
    'AC-4.1: selectLatestSession (Latest button) must resolve workspace latest session first'
  );
  assert(
    dashSrc.includes("initialSelectedEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });"),
    'AC-3.1: Initial webview script must scroll .session-nav-item.selected into view'
  );
  assert(
    dashSrc.includes("itemWsPath === cPath || itemWsPath.startsWith(cPath + '/') || cPath.startsWith(itemWsPath + '/')"),
    'AC-1.2: Webview client matchesWorkspaceFilter must enforce slash boundary matching'
  );
  assert(
    !dashSrc.includes('itemWsPath.includes(cPath)'),
    'AC-1.2: Legacy substring .includes(cPath) must be removed from DashboardWebviewPanel.ts'
  );
  assert(
    !treeSrc.includes('lowerWsPath.includes(cPath)'),
    'AC-1.2: Legacy substring .includes(cPath) must be removed from ChatHistoryTreeProvider.ts'
  );
  assert(
    archiverSrc.includes('SessionScanner.isPathBoundaryMatch'),
    'Tier 4: ProjectDocsArchiver.ts must use SessionScanner.isPathBoundaryMatch'
  );
  assert(
    extSrc.includes('SessionScanner.isPathBoundaryMatch'),
    'Tier 4: extension.ts must use SessionScanner.isPathBoundaryMatch'
  );

  // Tier 6: Check for log leaks / NaN / undefined string leaks in rendered HTML
  assert(!sessionListHtml.includes('undefined'), 'Tier 6: Rendered sessionListHtml must not contain literal "undefined"');
  assert(!sessionListHtml.includes('NaN'), 'Tier 6: Rendered sessionListHtml must not contain literal "NaN"');
  assert(!sessionListHtml.includes('[object Object]'), 'Tier 6: Rendered sessionListHtml must not contain "[object Object]"');

  console.log('✓ Tier 3, Tier 4 & Tier 6 assertions passed!');
  console.log('🎉 ALL 6 TIERS OF WORKSPACE LATEST SESSION AUTOLOAD VERIFICATION PASSED!');
}

runVerificationSuite().catch((err) => {
  console.error('Verification suite failed:', err);
  process.exit(1);
});
