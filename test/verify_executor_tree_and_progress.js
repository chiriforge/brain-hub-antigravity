const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Mock vscode before importing services/views
const Module = require('module');
const origRequire = Module.prototype.require;

const mockConfigStore = {
  'brainHub.brainPath': '',
  'brainHub.additionalBrainPaths': [],
  'brainHub.machineName': '',
  'brainHub.hideEmptySessions': true,
  'brainHub.sessionSortBy': 'lastModified',
  'brainHub.enableTokenStatusBar': true,
  'brainHub.autoReloadOnLiveChat': true,
  'brainHub.defaultModelPricing': {
    label: 'Default (Hydrogen)',
    inputPer1M: 1.5,
    outputPer1M: 7.5,
    cachedPer1M: 0.075
  }
};

const vscodeMock = {
  workspace: {
    getConfiguration: (section) => ({
      get: (key, def) => {
        const fullKey = `${section}.${key}`;
        return Object.prototype.hasOwnProperty.call(mockConfigStore, fullKey)
          ? mockConfigStore[fullKey]
          : def;
      }
    }),
    workspaceFolders: [],
    onDidChangeWorkspaceFolders: () => ({ dispose: () => {} }),
    onDidChangeConfiguration: () => ({ dispose: () => {} })
  },
  env: {
    clipboard: { writeText: async () => {} },
    openExternal: async () => {}
  },
  Uri: {
    file: (p) => ({ fsPath: p }),
    joinPath: (base, ...segments) => ({ fsPath: path.join(base.fsPath || base, ...segments) })
  },
  TreeItem: class TreeItem {
    constructor(label, collapsibleState) {
      this.label = label;
      this.collapsibleState = collapsibleState;
    }
  },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  EventEmitter: class EventEmitter {
    constructor() {
      this.event = () => ({ dispose: () => {} });
    }
    fire() {}
  },
  ThemeIcon: class ThemeIcon { constructor(id, color) { this.id = id; this.color = color; } },
  ThemeColor: class ThemeColor { constructor(id) { this.id = id; } },
  MarkdownString: class MarkdownString {
    constructor(val = '') {
      this.value = val;
      this.isTrusted = false;
      this.supportThemeIcons = false;
    }
    appendMarkdown(str) {
      this.value += str;
      return this;
    }
  },
  StatusBarAlignment: { Left: 1, Right: 2 },
  commands: { registerCommand: () => ({ dispose: () => {} }), executeCommand: () => {} },
  window: {
    showInformationMessage: async () => undefined,
    showWarningMessage: async () => undefined,
    showErrorMessage: async () => undefined,
    createStatusBarItem: () => ({
      text: '',
      tooltip: '',
      backgroundColor: undefined,
      command: undefined,
      show() {},
      hide() {},
      dispose() {}
    })
  }
};

Module.prototype.require = function (request) {
  if (request === 'vscode') {
    return vscodeMock;
  }
  return origRequire.apply(this, arguments);
};

const { SessionScanner } = require('../out/services/SessionScanner');
const { ChatHistoryTreeProvider, SessionTreeItem } = require('../out/providers/ChatHistoryTreeProvider');
const { ExecutorLayoutHelper } = require('../out/views/ExecutorLayoutHelper');
const { DashboardWebviewPanel } = require('../out/views/DashboardWebviewPanel');

function writeTranscript(sessionDir, steps) {
  const logsDir = path.join(sessionDir, '.system_generated', 'logs');
  fs.mkdirSync(logsDir, { recursive: true });
  fs.writeFileSync(
    path.join(logsDir, 'transcript.jsonl'),
    steps.map((s) => JSON.stringify(s)).join('\n') + '\n',
    'utf8'
  );
}

async function runTests() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bh_exec_tree_fix_'));
  const storageDir = path.join(tmpRoot, 'globalStorage');
  const brainDir = path.join(tmpRoot, 'brain');
  fs.mkdirSync(storageDir, { recursive: true });
  fs.mkdirSync(brainDir, { recursive: true });

  const scanner = SessionScanner.getInstance();
  scanner.setStoragePath(storageDir);
  const origBrainPath = mockConfigStore['brainHub.brainPath'];
  mockConfigStore['brainHub.brainPath'] = brainDir;

  try {
    // =========================================================================
    // AC-1 & AC-2 & AC-3: Anti-Hijack Parsing, User Root Protection, Descriptor Schema & Cache
    // =========================================================================
    console.log('Testing AC-1, AC-2, AC-3: Anti-hijack parsing, user root protection, subagentDescriptor & cache...');
    assert.strictEqual(SessionScanner.CACHE_SCHEMA_VERSION, 8, 'AC-3: CACHE_SCHEMA_VERSION must be bumped to 8');

    const userRootId = '11111111-1111-4111-8111-111111111111';
    const realChildId = '22222222-2222-4222-8222-222222222222';
    const emptySpawnedChildId = '33333333-3333-4333-8333-333333333333';
    const historicalStdoutId = '44444444-4444-4444-8444-444444444444';
    const historicalReadFileId = '55555555-5555-4555-8555-555555555555';

    const userRootDir = path.join(brainDir, userRootId);
    const realChildDir = path.join(brainDir, realChildId);
    const emptyChildDir = path.join(brainDir, emptySpawnedChildId);
    const histStdoutDir = path.join(brainDir, historicalStdoutId);
    const histReadDir = path.join(brainDir, historicalReadFileId);

    // Historical unrelated sessions that happen to appear in run_command / read_file GENERIC stdout
    writeTranscript(histStdoutDir, [
      {
        step_index: 0,
        source: 'USER_EXPLICIT',
        type: 'USER_INPUT',
        created_at: '2026-11-22T10:00:00.000Z',
        content: '<USER_REQUEST>\nHistorical session A\n</USER_REQUEST>'
      }
    ]);
    writeTranscript(histReadDir, [
      {
        step_index: 0,
        source: 'SYSTEM',
        type: 'SYSTEM_MESSAGE',
        created_at: '2026-11-22T11:00:00.000Z',
        content: 'Historical subagent B'
      },
      {
        step_index: 1,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        created_at: '2026-11-22T11:01:00.000Z',
        content: 'Done'
      }
    ]);

    // Real nested subagentDescriptor schema (.system_generated/subagents/<child>.json)
    fs.mkdirSync(path.join(userRootDir, '.system_generated', 'subagents'), { recursive: true });
    fs.writeFileSync(
      path.join(userRootDir, '.system_generated', 'subagents', `${realChildId}.json`),
      JSON.stringify({
        conversationId: realChildId,
        spawnStepIndex: 4,
        state: 'SUBAGENT_STATE_ALIVE',
        subagentDescriptor: {
          typeName: 'boost-investigator',
          role: 'DeepInvestigator'
        },
        workspaceUris: ['file:///d%3A/chiriforge/brain-hub-antigravity']
      }),
      'utf8'
    );

    // Empty 0-step newly spawned subagent referenced in subagents/*.json
    fs.writeFileSync(
      path.join(userRootDir, '.system_generated', 'subagents', `${emptySpawnedChildId}.json`),
      JSON.stringify({
        conversationId: emptySpawnedChildId,
        spawnStepIndex: 5,
        state: 'SUBAGENT_STATE_ALIVE',
        subagentDescriptor: {
          typeName: 'research',
          role: 'FreshEmptyWorker'
        }
      }),
      'utf8'
    );
    fs.mkdirSync(path.join(emptyChildDir, '.system_generated', 'logs'), { recursive: true });
    fs.writeFileSync(path.join(emptyChildDir, '.system_generated', 'logs', 'transcript.jsonl'), '', 'utf8');

    writeTranscript(userRootDir, [
      {
        step_index: 0,
        source: 'USER_EXPLICIT',
        type: 'USER_INPUT',
        created_at: '2026-11-23T09:00:00.000Z',
        content: '<USER_REQUEST>\nRoot user request\n</USER_REQUEST>'
      },
      {
        step_index: 1,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        created_at: '2026-11-23T09:00:10.000Z',
        input_tokens: 1000,
        cache_read_tokens: 2000,
        output_tokens: 200,
        model: 'gemini-4-hydrogen',
        content: 'Inspecting subagents directory',
        tool_calls: [{ name: 'run_command', args: { CommandLine: 'cat old_subagent.json' } }]
      },
      {
        step_index: 2,
        source: 'MODEL',
        type: 'GENERIC',
        created_at: '2026-11-23T09:00:12.000Z',
        content: `Created At: 2026-11-23T09:00:11+07:00\nCompleted At: 2026-11-23T09:00:12+07:00\nCommand exited with code 0.\n\nCommand output:\n=== Snippet from other session ===\nCreated the following subagent:\n{\n  "conversationId": "${historicalStdoutId}",\n  "role": "OldAgent"\n}`
      },
      {
        step_index: 3,
        source: 'MODEL',
        type: 'GENERIC',
        created_at: '2026-11-23T09:00:15.000Z',
        content: `Showing lines 1-5 of 5\n1: {"conversationId": "${historicalReadFileId}"}`
      },
      {
        step_index: 4,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        created_at: '2026-11-23T09:00:20.000Z',
        input_tokens: 1200,
        cache_read_tokens: 2500,
        output_tokens: 300,
        model: 'gemini-4-hydrogen',
        content: 'Spawning investigator',
        tool_calls: [{ name: 'invoke_subagent', args: { Role: 'DeepInvestigator', TypeName: 'boost-investigator' } }]
      },
      {
        step_index: 5,
        source: 'MODEL',
        type: 'GENERIC',
        created_at: '2026-11-23T09:00:22.000Z',
        content: `Created the following subagent:\n{"conversationId": "${realChildId}"}`
      },
      {
        step_index: 6,
        source: 'SYSTEM',
        type: 'SYSTEM_MESSAGE',
        created_at: '2026-11-23T09:05:00.000Z',
        content: `[Message] timestamp=2026-11-23T09:05:00Z sender=${realChildId} content=## Child Completion Report`
      }
    ]);

    // Real child transcript (running, 0 USER_INPUT steps, and even attempts a bogus GENERIC ref back to userRootId)
    writeTranscript(realChildDir, [
      {
        step_index: 0,
        source: 'SYSTEM',
        type: 'SYSTEM_MESSAGE',
        created_at: '2026-11-23T09:00:25.000Z',
        content: `[Message] timestamp=2026-11-23T09:00:25Z sender=${userRootId} content=<original_task>Find matching regexes</original_task>`
      },
      {
        step_index: 1,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        created_at: new Date().toISOString(),
        input_tokens: 2000,
        cache_read_tokens: 3000,
        output_tokens: 500,
        model: 'gemini-4-hydrogen',
        content: 'Searching source code for unique_subagent_needle_xyz',
        tool_calls: [{ name: 'run_command', args: { CommandLine: 'rg -n unique_subagent_needle_xyz src/' } }]
      }
    ]);

    const sessions = await scanner.scanSessions(true);
    const rootSess = sessions.find((s) => s.id === userRootId);
    const childSess = sessions.find((s) => s.id === realChildId);
    const emptyChildSess = sessions.find((s) => s.id === emptySpawnedChildId);
    const histStdoutSess = sessions.find((s) => s.id === historicalStdoutId);
    const histReadSess = sessions.find((s) => s.id === historicalReadFileId);

    // AC-1 assertions
    assert(rootSess, 'AC-1: userRoot must be scanned');
    assert(!rootSess.executorRefs.some((r) => r.conversationId === historicalStdoutId), 'AC-1: GENERIC run_command stdout UUID must NOT attach to executorRefs');
    assert(!rootSess.executorRefs.some((r) => r.conversationId === historicalReadFileId), 'AC-1: GENERIC read_file stdout UUID must NOT attach to executorRefs');
    assert.strictEqual(histStdoutSess.executorParentId, undefined, 'AC-1: historical stdout session must NOT be hijacked');
    assert.strictEqual(histReadSess.executorParentId, undefined, 'AC-1: historical read_file session must NOT be hijacked');

    // AC-2 assertions
    assert.strictEqual(rootSess.executorParentId, undefined, 'AC-2: user root receiving mid-session [Message] sender=<child> must keep executorParentId === undefined');
    assert.strictEqual(rootSess.executorRootId, userRootId, 'AC-2: user root must remain its own executorRootId');
    assert.strictEqual(rootSess.executorDepth, 0, 'AC-2: user root executorDepth must be 0');
    assert(childSess, 'AC-2: child session must be scanned');
    assert.strictEqual(childSess.executorParentId, userRootId, 'AC-2: child executorParentId must be userRootId');
    assert.strictEqual(childSess.executorDepth, 1, 'AC-2: child executorDepth must be 1');

    // Verify loadFullSession classifies mid-session [Message] on root as executor_report
    const loadedRootFull = await scanner.loadFullSession(userRootId);
    const reportMsg = loadedRootFull.messages.find((m) => m.index === 6);
    assert(reportMsg && reportMsg.interAgentMeta && reportMsg.interAgentMeta.kind === 'executor_report', 'AC-2: mid-session child message on root must be executor_report');

    // AC-3 assertions: subagentDescriptor fields + spawnStepIndex + SUBAGENT_STATE_ALIVE -> running
    const childRef = rootSess.executorRefs.find((r) => r.conversationId === realChildId);
    assert(childRef, 'AC-3: realChildId must be in root executorRefs');
    assert.strictEqual(childRef.role, 'DeepInvestigator', 'AC-3: role must be read from subagentDescriptor.role');
    assert.strictEqual(childRef.typeName, 'boost-investigator', 'AC-3: typeName must be read from subagentDescriptor.typeName');
    assert.strictEqual(childRef.spawnStepIndex, 4, 'AC-3: spawnStepIndex must be read from descriptor');
    assert.strictEqual(childSess.executorRole, 'DeepInvestigator', 'AC-3: child session must inherit executorRole');
    assert.strictEqual(childSess.executorTypeName, 'boost-investigator', 'AC-3: child session must inherit executorTypeName');

    // AC-3 cache cleanliness: loadFullSession must NOT resurrect stale executorRefs / executorParentId
    for (const entry of scanner.sessionCache.values()) {
      if (entry.session && entry.session.id === userRootId) {
        entry.session.executorParentId = '99999999-9999-4999-8999-999999999999';
        entry.session.executorRefs = [
          ...(entry.session.executorRefs || []),
          { conversationId: '88888888-8888-4888-8888-888888888888', kind: 'subagent' }
        ];
      }
    }
    const reloadedRoot = await scanner.loadFullSession(userRootId);
    assert.strictEqual(reloadedRoot.session.executorParentId, undefined, 'AC-3: loadFullSession must not resurrect stale executorParentId');
    assert(!reloadedRoot.session.executorRefs.some((r) => r.conversationId === '88888888-8888-4888-8888-888888888888'), 'AC-3: loadFullSession must not resurrect stale executorRefs');

    // AC-3 mergeSessionMetadata combines executorRefs across directories
    const mergedMeta = scanner.mergeSessionMetadata(
      { ...rootSess, executorRefs: [{ conversationId: realChildId, kind: 'subagent', role: 'DeepInvestigator' }] },
      { ...rootSess, executorRefs: [{ conversationId: emptySpawnedChildId, kind: 'subagent', role: 'FreshEmptyWorker' }] }
    );
    assert.strictEqual(mergedMeta.executorRefs.length, 2, 'AC-3: mergeSessionMetadata must merge executorRefs from both directories');

    // AC-2/AC-7 authority-ranked cycle breaking & waiting parent status
    assert.strictEqual(rootSess.executorStatus, 'waiting', 'AC-7: root coordinator with running child must surface waiting status instead of done');

    // Synthetic cycle + authority test in resolveExecutorLinks
    const fakeSub = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      path: '',
      title: 'Sub',
      firstPrompt: 'Sub',
      lastModified: new Date('2026-11-23T10:01:00Z'),
      createdAt: new Date('2026-11-23T10:01:00Z'),
      messageCount: 1,
      userPromptCount: 0,
      hasArtifacts: false,
      executorParentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      executorRefs: [{ conversationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', kind: 'subagent', sourceAuthority: 'invoke_subagent' }]
    };
    const fakeUserRoot = {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      path: '',
      title: 'User Root',
      firstPrompt: 'User Root',
      lastModified: new Date('2026-11-23T10:00:00Z'),
      createdAt: new Date('2026-11-23T10:00:00Z'),
      messageCount: 1,
      userPromptCount: 1,
      hasArtifacts: false,
      executorParentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      executorRefs: [{ conversationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', kind: 'subagent', sourceAuthority: 'subagent_descriptor' }]
    };
    scanner.resolveExecutorLinks([fakeSub, fakeUserRoot]);
    assert.strictEqual(fakeUserRoot.executorParentId, undefined, 'AC-2: cycle break must preserve userPromptCount > 0 root');
    assert.strictEqual(fakeSub.executorParentId, fakeUserRoot.id, 'AC-2: subagent must link under user root after cycle resolution');
    assert(!fakeSub.executorRefs.some((r) => r.conversationId === fakeUserRoot.id), 'AC-2: rejected executorRefs must be pruned from losing parent');

    const foreignChild = {
      ...fakeSub,
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      executorParentId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    };
    const staleParent = {
      ...fakeUserRoot,
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      executorRefs: [{ conversationId: foreignChild.id, kind: 'subagent' }]
    };
    const collected = ExecutorLayoutHelper.collectExecutorDescendants(staleParent, [staleParent, foreignChild]);
    assert.strictEqual(collected.length, 0, 'AC-2: collectExecutorDescendants must ignore refs whose executorParentId belongs to another parent');
    console.log('✓ AC-1, AC-2, AC-3 passed');

    // =========================================================================
    // AC-4: Tree View Rollup & Empty Referenced Subagent Visibility
    // =========================================================================
    console.log('Testing AC-4: Tree view rollup telemetry, cycle-safe getChildren, and empty child visibility...');
    assert(emptyChildSess, 'AC-4: 0-step subagent referenced in executorRefs must NOT be stripped when hideEmptySessions=true');
    assert.strictEqual(emptyChildSess.executorParentId, userRootId, 'AC-4: 0-step referenced subagent must link under parent');

    assert(rootSess.treeTokenUsage && rootSess.treeTokenUsage.executorCount >= 2, 'AC-4: rootSess must have treeTokenUsage');
    const rootTreeItem = new SessionTreeItem(rootSess, sessions, false);
    assert(rootTreeItem.description.includes('tree'), 'AC-4: root SessionTreeItem description must surface treeTokenUsage rollup');
    assert(rootTreeItem.tooltip.value.includes('Tree Rollup'), 'AC-4: root SessionTreeItem tooltip must include Tree Rollup telemetry');

    // Cycle-safe getChildren check
    const treeProvider = new ChatHistoryTreeProvider();
    const cyclicA = { ...fakeSub, id: 'cyc-a', executorParentId: 'cyc-b', executorRefs: [{ conversationId: 'cyc-b', kind: 'subagent' }] };
    const cyclicB = { ...fakeSub, id: 'cyc-b', executorParentId: 'cyc-a', executorRefs: [{ conversationId: 'cyc-a', kind: 'subagent' }] };
    treeProvider.allSessions = [cyclicA, cyclicB];
    const itemA = new SessionTreeItem(cyclicA, [cyclicA, cyclicB], false, new Set(['cyc-a']));
    const childrenOfA = await treeProvider.getChildren(itemA);
    assert.strictEqual(childrenOfA.length, 1, 'AC-4: getChildren returns cyclicB once');
    const grandchildrenOfB = await treeProvider.getChildren(childrenOfA[0]);
    assert.strictEqual(grandchildrenOfB.length, 0, 'AC-4: ancestor guard must prevent infinite cycle in getChildren');
    console.log('✓ AC-4 passed');

    // =========================================================================
    // AC-5: Dashboard Sidebar Search, Deep Search & Selected Child Visibility
    // =========================================================================
    console.log('Testing AC-5: Dashboard sidebar descendant search, deep search & selected child visibility...');
    const navMock = Object.assign(Object.create(DashboardWebviewPanel.prototype), {
      selectedSessionId: realChildId,
      allSessionsCache: sessions
    });
    const navHtml = DashboardWebviewPanel.prototype.generateSessionListHtml.call(navMock, sessions, realChildId);
    assert(navHtml.includes('data-descendant-text="'), 'AC-5: .session-nav-item must include data-descendant-text');
    assert(navHtml.includes(`data-descendant-ids="`), 'AC-5: .session-nav-item must include data-descendant-ids');
    assert(navHtml.includes(realChildId), 'AC-5: descendant ID must be embedded for deep search matching');
    assert(navHtml.includes('deepinvestigator'), 'AC-5: subagent role must appear in descendant search text');

    const dashSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'DashboardWebviewPanel.ts'), 'utf8');
    assert(
      dashSrc.includes('.session-tree-node:has(.session-nav-item.hidden):not(:has(.executor-subnav-item.selected)) .executor-subtree-details'),
      'AC-5: CSS must exempt selected child subagents from parent-hidden suppression'
    );
    assert(
      dashSrc.includes('evaluateSidebarFilters(currentQuery, currentDeepMatchedIds)'),
      'AC-5: applyDeepSearchResults must run shared sidebar/group/subtree filter logic'
    );
    console.log('✓ AC-5 passed');

    // =========================================================================
    // AC-6: Dashboard & ChatViewer Live Progress / Switcher Sync
    // =========================================================================
    console.log('Testing AC-6: Dashboard & ChatViewer live progress/switcher sync & overlay search...');
    assert(dashSrc.includes("command: 'updateSessionList'"), 'AC-6: Dashboard updateReaderOnly must push live updateSessionList');
    assert(dashSrc.includes("path.join(s.path, '.system_generated', 'subagents')"), 'AC-6: Dashboard computeTreePollSignature must watch subagents/*.json');
    assert(dashSrc.includes('overlayPanel && timeline && timeline.style.display === \'none\''), 'AC-6: filterTranscriptMessages must handle active progress/swarm overlay tabs');

    const chatSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'ChatWebviewPanel.ts'), 'utf8');
    assert(chatSrc.includes("newDoc.getElementById('executorSwitcherBar')"), 'AC-6: ChatWebviewPanel applyChatContentUpdate must sync #executorSwitcherBar');
    assert(chatSrc.includes("newDoc.getElementById('executorProgressMatrix')"), 'AC-6: ChatWebviewPanel applyChatContentUpdate must sync #executorProgressMatrix');
    assert(chatSrc.includes("newDoc.getElementById('swarmBoardPanel')"), 'AC-6: ChatWebviewPanel applyChatContentUpdate must sync #swarmBoardPanel');
    assert(chatSrc.includes("oldMain.style.display = newMain.style.display || ''"), 'AC-6: ChatWebviewPanel applyChatContentUpdate must sync #chatContainer display state');
    console.log('✓ AC-6 passed');

    // =========================================================================
    // AC-7: Progress Matrix Unmaterialized Refs, Waiting Status & Swarm Member Matching
    // =========================================================================
    console.log('Testing AC-7: Progress matrix unmaterialized refs, waiting status & Swarm member.name matching...');
    const unmaterializedRefId = '66666666-6666-4666-8666-666666666666';
    const swarmCoord = {
      id: '77777777-7777-4777-8777-777777777777',
      path: '',
      title: 'Swarm Root',
      firstPrompt: 'Swarm Root',
      lastModified: new Date(),
      createdAt: new Date(),
      messageCount: 1,
      userPromptCount: 1,
      hasArtifacts: false,
      executorStatus: 'waiting',
      executorRefs: [
        { conversationId: '77777777-0000-4000-8000-000000000001', kind: 'swarm_worker', role: 'Implementer', status: 'running' },
        { conversationId: unmaterializedRefId, kind: 'subagent', role: 'RemoteVerifier', status: 'running' }
      ]
    };
    const swarmWorker = {
      id: '77777777-0000-4000-8000-000000000001',
      path: '',
      title: 'Implementer',
      firstPrompt: 'Implementer',
      lastModified: new Date(),
      createdAt: new Date(),
      messageCount: 1,
      userPromptCount: 0,
      hasArtifacts: false,
      executorParentId: swarmCoord.id,
      executorRootId: swarmCoord.id,
      executorDepth: 1,
      executorRole: 'Implementer',
      executorStatus: 'running',
      stepCount: 5
    };
    const swarmData = {
      title: 'Test Swarm',
      members: [
        { name: 'coordinator', conversationId: swarmCoord.id, role: 'coordinator', status: 'waiting' },
        { name: 'worker-1', conversationId: swarmWorker.id, role: 'Implementer', status: 'working' }
      ],
      boardMessages: [],
      overview: {
        tasksMap: {
          coordinator: 'Coordinate overall delivery',
          'worker-1': 'Patch progress matrix lookup'
        },
        workstreams: [
          { name: 'Matrix', owners: ['worker-1'], state: 'in_progress', progress: '2/3' }
        ]
      }
    };

    const matrixHtml = ExecutorLayoutHelper.renderProgressMatrixHtml(
      swarmCoord,
      [swarmCoord, swarmWorker],
      swarmData
    );
    assert(matrixHtml.includes('RemoteVerifier'), 'AC-7: unmaterialized executorRef must render a row in Progress Matrix');
    assert(matrixHtml.includes('Pending / Remote'), 'AC-7: unmaterialized executorRef must surface Pending / Remote state');
    assert(matrixHtml.includes('disabled'), 'AC-7: unmaterialized executorRef transcript button must be disabled');
    assert(matrixHtml.includes('waiting'), 'AC-7: waiting coordinator must display waiting status');
    assert(matrixHtml.includes('Patch progress matrix lookup'), 'AC-7: tasksMap keyed by member.name (worker-1) must match worker row');
    assert(matrixHtml.includes('2/3'), 'AC-7: workstreams keyed by member.name (worker-1) must match worker row progress');
    console.log('✓ AC-7 passed');

    console.log('\n🎉 ALL AC-1..AC-7 EXECUTOR TREE & PROGRESS TESTS PASSED!');
  } finally {
    mockConfigStore['brainHub.brainPath'] = origBrainPath;
    scanner.stopRealtimeWatcher();
    scanner.stopBackgroundScanTimer();
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {}
  }
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
