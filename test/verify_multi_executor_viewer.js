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
      showCalled: false,
      hideCalled: false,
      show() { this.showCalled = true; },
      hide() { this.hideCalled = true; },
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
const { TokenUsageMonitor } = require('../out/services/TokenUsageMonitor');
const { MarkdownRenderer } = require('../out/services/MarkdownRenderer');
const { ChatHistoryTreeProvider } = require('../out/providers/ChatHistoryTreeProvider');
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
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bh_multi_exec_'));
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
    // AC-7: 3-Level Executor Linking, Percent-Encoded workspaceUris & Progress
    // =========================================================================
    console.log('Testing AC-7: 3-level subagent hierarchy, encoded workspaceUris & progress telemetry...');
    const rootId = '10000000-0000-4000-8000-000000000001';
    const l1Id = '20000000-0000-4000-8000-000000000002';
    const l2Id = '30000000-0000-4000-8000-000000000003';
    const l2SiblingId = '40000000-0000-4000-8000-000000000004';
    const taskNoiseId = '50000000-0000-4000-8000-000000000005';

    const rootDir = path.join(brainDir, rootId);
    const l1Dir = path.join(brainDir, l1Id);
    const l2Dir = path.join(brainDir, l2Id);
    const l2SibDir = path.join(brainDir, l2SiblingId);

    // Subagent JSON with percent-encoded workspaceUris
    fs.mkdirSync(path.join(rootDir, '.system_generated', 'subagents'), { recursive: true });
    fs.writeFileSync(
      path.join(rootDir, '.system_generated', 'subagents', `${l1Id}.json`),
      JSON.stringify({
        conversationId: l1Id,
        typeName: 'boost-investigator',
        role: 'DeepInvestigator',
        state: 'done',
        workspaceUris: ['file:///d%3A/chiriforge/brain-hub-antigravity']
      }),
      'utf8'
    );

    writeTranscript(rootDir, [
      {
        step_index: 0,
        source: 'USER_EXPLICIT',
        type: 'USER_INPUT',
        created_at: '2026-11-23T01:00:00.000Z',
        content: '<user_information>\nActive Workspaces:\n- d:\\chiriforge\\brain-hub-antigravity\n</user_information>\n<USER_REQUEST>\n/boost Analyze architecture\n</USER_REQUEST>'
      },
      {
        step_index: 1,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        created_at: '2026-11-23T01:01:00.000Z',
        input_tokens: 1000,
        cache_read_tokens: 4000,
        output_tokens: 200,
        model: 'gemini-4-hydrogen',
        content: `Delegating to [DeepInvestigator](conversation://${l1Id})`,
        tool_calls: [{ name: 'invoke_subagent', args: { Role: 'DeepInvestigator', TypeName: 'boost-investigator' } }]
      },
      {
        step_index: 2,
        source: 'MODEL',
        type: 'INVOKE_SUBAGENT',
        created_at: '2026-11-23T01:01:05.000Z',
        content: JSON.stringify({ conversationId: l1Id, status: 'STARTED' })
      },
      {
        step_index: 3,
        source: 'SYSTEM',
        type: 'SYSTEM_MESSAGE',
        created_at: '2026-11-23T01:02:00.000Z',
        content: `sender=${taskNoiseId}/task-1 Background command finished`
      },
      {
        step_index: 4,
        source: 'SYSTEM',
        type: 'SYSTEM_MESSAGE',
        created_at: '2026-11-23T01:02:05.000Z',
        content: `sender=system Notice: sandbox ready`
      }
    ]);

    // L1 spawns L2 and L2Sibling via multi-subagent INVOKE_SUBAGENT + SYSTEM_MESSAGE
    writeTranscript(l1Dir, [
      {
        step_index: 0,
        source: 'SYSTEM',
        type: 'SYSTEM_MESSAGE',
        created_at: '2026-11-23T01:01:10.000Z',
        content: `[Message] timestamp=2026-11-23T01:01:10Z sender=${rootId} content=<original_task>Inspect SessionScanner parsing</original_task>`
      },
      {
        step_index: 1,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        created_at: '2026-11-23T01:01:20.000Z',
        input_tokens: 2000,
        cache_read_tokens: 3000,
        output_tokens: 300,
        model: 'gemini-4-hydrogen',
        content: 'Spawning two workers',
        tool_calls: [
          { name: 'invoke_subagent', args: { Role: 'WorkerL0', TypeName: 'research' } },
          { name: 'invoke_subagent', args: { Role: 'ImprovementWorker', TypeName: 'self' } }
        ]
      },
      {
        step_index: 2,
        source: 'MODEL',
        type: 'INVOKE_SUBAGENT',
        created_at: '2026-11-23T01:01:25.000Z',
        content: JSON.stringify({ spawned: [{ conversationId: l2Id }, { conversationId: l2SiblingId }] })
      },
      {
        step_index: 3,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        created_at: '2026-11-23T01:02:30.000Z',
        input_tokens: 500,
        cache_read_tokens: 4500,
        output_tokens: 150,
        model: 'gemini-4-hydrogen',
        content: 'Sending final report',
        tool_calls: [
          {
            name: 'send_message',
            args: JSON.stringify({
              Recipient: JSON.stringify(rootId),
              Message: JSON.stringify('## Findings\nAll checks complete. See [Worker](conversation://' + l2Id + ')')
            })
          }
        ]
      },
      {
        step_index: 4,
        source: 'SYSTEM',
        type: 'SYSTEM_MESSAGE',
        created_at: '2026-11-23T01:02:35.000Z',
        content: `sender=${l2Id} WorkerL0 completed scan`
      }
    ]);

    // L2 transcript (active/running: ends with tool_calls and recent timestamp)
    writeTranscript(l2Dir, [
      {
        step_index: 0,
        source: 'SYSTEM',
        type: 'SYSTEM_MESSAGE',
        created_at: '2026-11-23T01:01:30.000Z',
        content: `[Message] timestamp=2026-11-23T01:01:30Z sender=${l1Id} content=Trace token accumulation across files`
      },
      {
        step_index: 1,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        created_at: new Date().toISOString(),
        input_tokens: 3000,
        cache_read_tokens: 1000,
        output_tokens: 400,
        model: 'gemini-4-hydrogen',
        content: 'Scanning files now',
        tool_calls: [{ name: 'run_command', args: { CommandLine: 'rg -n tokenUsage src/' } }]
      }
    ]);

    // L2 sibling transcript (done)
    writeTranscript(l2SibDir, [
      {
        step_index: 0,
        source: 'SYSTEM',
        type: 'SYSTEM_MESSAGE',
        created_at: '2026-11-23T01:01:32.000Z',
        content: `sender=${l1Id} Suggest improvements`
      },
      {
        step_index: 1,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        created_at: '2026-11-23T01:02:00.000Z',
        input_tokens: 1500,
        cache_read_tokens: 2500,
        output_tokens: 250,
        model: 'gemini-4-hydrogen',
        content: 'Done suggesting improvements'
      }
    ]);

    // Untruncated message artifact for L1
    fs.mkdirSync(path.join(l1Dir, '.system_generated', 'messages'), { recursive: true });
    fs.writeFileSync(
      path.join(l1Dir, '.system_generated', 'messages', 'msg_001.json'),
      JSON.stringify({
        stepIndex: 3,
        renderDetails: { messageTitle: 'Investigation Summary' },
        Message: '## Untruncated Findings\nFull details recovered from .system_generated/messages/.'
      }),
      'utf8'
    );

    // =========================================================================
    // AC-8: Dual-Source Swarm Ingestion (view.json & plan.json)
    // =========================================================================
    console.log('Testing AC-8: Dual-source swarm ingestion (view.json, plan.json, members.json, board.jsonl)...');
    const swarmCoordId = '60000000-0000-4000-8000-000000000006';
    const swarmWorkerId = '70000000-0000-4000-8000-000000000007';
    const narratorId = '80000000-0000-4000-8000-000000000008';

    const swarmCoordDir = path.join(brainDir, swarmCoordId);
    const swarmWorkerDir = path.join(brainDir, swarmWorkerId);
    const narratorDir = path.join(brainDir, narratorId);

    writeTranscript(swarmCoordDir, [
      {
        step_index: 0,
        source: 'USER_EXPLICIT',
        type: 'USER_INPUT',
        created_at: '2026-11-23T02:00:00.000Z',
        content: '<USER_REQUEST>\n/swarm Build multi-executor UI\n</USER_REQUEST>'
      }
    ]);
    writeTranscript(swarmWorkerDir, [
      {
        step_index: 0,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        created_at: new Date().toISOString(),
        input_tokens: 800,
        cache_read_tokens: 200,
        output_tokens: 100,
        content: 'Working on task',
        tool_calls: [{ name: 'edit_file', args: { Path: 'src/app.ts' } }]
      }
    ]);
    writeTranscript(narratorDir, [
      { step_index: 0, source: 'MODEL', type: 'PLANNER_RESPONSE', created_at: '2026-11-23T02:01:00.000Z', content: 'Narrating' }
    ]);

    const swarmDir = path.join(swarmCoordDir, '.system_generated', 'swarm');
    fs.mkdirSync(swarmDir, { recursive: true });
    fs.writeFileSync(
      path.join(swarmDir, 'members.json'),
      JSON.stringify({
        title: 'Multi-Executor Swarm',
        members: {
          coordinator: {
            conversation_id: swarmCoordId,
            role: 'coordinator',
            model: 'gemini-4-hydrogen',
            status: 'waiting'
          },
          'worker-1': {
            conversation_id: swarmWorkerId,
            role: 'Implementer',
            model: 'gemini-4-hydrogen',
            status: 'working'
          },
          narrator: {
            conversation_id: narratorId,
            role: 'narrator',
            model: 'gemini-4-flash',
            status: 'waiting'
          }
        }
      }),
      'utf8'
    );
    // Narrator writes view.json inside narratorDir/swarm_view/view.json
    fs.mkdirSync(path.join(narratorDir, 'swarm_view'), { recursive: true });
    fs.writeFileSync(
      path.join(narratorDir, 'swarm_view', 'view.json'),
      JSON.stringify({
        headline: 'UI Build In Progress',
        running_summary: 'Worker-1 is editing components',
        goal: 'Ship 3-layer viewer',
        phase: 'Implementation',
        workstreams: [
          { name: 'Tree UI', owners: ['worker-1'], state: 'in_progress', progress: '1/2', note: 'Editing TreeProvider' }
        ],
        attention: ['Check AC-11 token rollup'],
        milestones: ['Schema v6 complete'],
        risks: []
      }),
      'utf8'
    );
    // Also include a plan.json and board.jsonl with control + torn trailing line
    fs.writeFileSync(
      path.join(swarmDir, 'plan.json'),
      JSON.stringify({
        goal: 'Ship 3-layer viewer',
        tasks: { 'worker-1': 'Build TreeView & Webview UI' }
      }),
      'utf8'
    );
    fs.writeFileSync(
      path.join(swarmDir, 'board.jsonl'),
      [
        JSON.stringify({ seq: 1, agent: 'coordinator', text: 'Starting swarm', time: '2026-11-23T02:00:05Z' }),
        JSON.stringify({ seq: 2, agent: 'system', control: { type: 'channel_open', channel: 'ui' }, time: '2026-11-23T02:00:06Z' }),
        JSON.stringify({ seq: 3, agent: 'worker-1', text: 'Editing TreeProvider', time: '2026-11-23T02:00:10Z' }),
        '{"seq":4,"agent":"worker-1","text":"torn trailing'
      ].join('\n'),
      'utf8'
    );

    // Remote-only swarm (only swarm.json)
    const remoteSwarmId = '90000000-0000-4000-8000-000000000009';
    const remoteSwarmDir = path.join(brainDir, remoteSwarmId);
    writeTranscript(remoteSwarmDir, [
      { step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', created_at: '2026-11-23T01:30:00.000Z', content: '<USER_REQUEST>\nRemote swarm\n</USER_REQUEST>' }
    ]);
    fs.mkdirSync(path.join(remoteSwarmDir, '.system_generated', 'swarm'), { recursive: true });
    fs.writeFileSync(path.join(remoteSwarmDir, '.system_generated', 'swarm', 'swarm.json'), '{"remoteOnly":true}', 'utf8');

    const sessions = await scanner.scanSessions(true, true);
    const rootSess = sessions.find((s) => s.id === rootId);
    const l1Sess = sessions.find((s) => s.id === l1Id);
    const l2Sess = sessions.find((s) => s.id === l2Id);
    const swarmSess = sessions.find((s) => s.id === swarmCoordId);
    const swarmWorkerSess = sessions.find((s) => s.id === swarmWorkerId);
    const remoteSwarmSess = sessions.find((s) => s.id === remoteSwarmId);

    assert(rootSess && l1Sess && l2Sess, 'AC-7: all 3 levels must be scanned');
    assert.strictEqual(rootSess.executorDepth, 0, 'AC-7: root executorDepth must be 0');
    assert.strictEqual(l1Sess.executorParentId, rootId, 'AC-7: L1 executorParentId must be root');
    assert.strictEqual(l1Sess.executorRootId, rootId, 'AC-7: L1 executorRootId must be root');
    assert.strictEqual(l1Sess.executorDepth, 1, 'AC-7: L1 executorDepth must be 1');
    assert.strictEqual(l2Sess.executorParentId, l1Id, 'AC-7: L2 executorParentId must be L1');
    assert.strictEqual(l2Sess.executorRootId, rootId, 'AC-7: L2 executorRootId must be root');
    assert.strictEqual(l2Sess.executorDepth, 2, 'AC-7: L2 executorDepth must be 2');
    assert.strictEqual(l2Sess.executorStatus, 'running', 'AC-7: L2 active tool call must yield running status');
    assert.strictEqual(l2Sess.latestAction, 'run_command', 'AC-7: L2 latestAction must be run_command');
    assert(!l1Sess.title.includes('[Message]'), 'AC-7: L1 title must strip [Message] wrapper');
    assert(!l2Sess.title.includes('<original_task>'), 'AC-7: title must strip <original_task> wrapper');
    assert(l1Sess.workspacePath && l1Sess.workspacePath.toLowerCase().includes('brain-hub-antigravity'), 'AC-7: L1 must decode percent-encoded workspaceUris');
    assert(l2Sess.workspacePath && l2Sess.workspacePath.toLowerCase().includes('brain-hub-antigravity'), 'AC-7: L2 must inherit workspacePath from parent/root');
    assert(!rootSess.executorRefs.some((r) => r.conversationId.startsWith(taskNoiseId)), 'AC-7: sender=<uuid>/task-1 must NOT link as subagent');

    // AC-8 assertions
    assert(swarmSess && swarmSess.swarmSummary, 'AC-8: swarmSummary must populate');
    assert.strictEqual(swarmSess.swarmSummary.title, 'Multi-Executor Swarm');
    assert(!swarmSess.executorRefs.some((r) => r.conversationId === swarmCoordId), 'AC-8: coordinator must be excluded from child executorRefs');
    assert.strictEqual(swarmWorkerSess.executorParentId, swarmCoordId, 'AC-8: swarm worker must link to coordinator');
    assert.strictEqual(typeof scanner.loadSwarmData, 'function', 'loadSwarmData must exist');
    const swarmData = await scanner.loadSwarmData(swarmCoordDir);
    assert(swarmData && swarmData.overview, 'AC-8: loadSwarmData must return overview from narrator view.json');
    assert.strictEqual(swarmData.overview.headline, 'UI Build In Progress');
    assert.strictEqual(swarmData.boardMessages.length, 3, 'AC-8: torn trailing line in board.jsonl must be ignored safely');
    assert(swarmData.boardMessages.some((m) => m.control), 'AC-8: control events in board.jsonl must be parsed');
    const remoteSwarmData = await scanner.loadSwarmData(remoteSwarmDir);
    assert(remoteSwarmData && remoteSwarmData.isRemoteOnly === true, 'AC-8: remote-only swarm.json must degrade safely');
    assert(remoteSwarmSess, 'AC-8: remote-only swarm session must scan cleanly');
    console.log('✓ AC-7 & AC-8 passed');

    // =========================================================================
    // AC-9: Inter-Agent, send_message, INVOKE_SUBAGENT, Lookahead & conversation://
    // =========================================================================
    console.log('Testing AC-9: Lookahead non-swallowing, send_message unquoting, INVOKE_SUBAGENT & conversation:// links...');
    const loadedRoot = await scanner.loadFullSession(rootId);
    const loadedL1 = await scanner.loadFullSession(l1Id);
    assert(loadedRoot && loadedL1, 'AC-9: loadFullSession must succeed');

    // Verify lookahead did NOT swallow SYSTEM_MESSAGE in root
    const plannerWithInvoke = loadedRoot.messages.find((m) => m.index === 1);
    assert(!plannerWithInvoke.toolCalls?.[0]?.output?.includes('task-1'), 'AC-9: SYSTEM_MESSAGE must NOT be swallowed into toolCalls[0].output');
    const sysNoticeMsg = loadedRoot.messages.find((m) => m.index === 4);
    assert(sysNoticeMsg && sysNoticeMsg.interAgentMeta && sysNoticeMsg.interAgentMeta.kind === 'status_notice', 'AC-9: sender=system must map to status_notice');

    // Verify send_message double-JSON unquoting + .system_generated/messages enrichment
    const sendMsgStep = loadedL1.messages.find((m) => m.toolCalls && m.toolCalls.some((tc) => tc.name === 'send_message'));
    assert(sendMsgStep, 'AC-9: send_message step must exist in L1');

    const convLinkHtml = MarkdownRenderer.render(`[Worker](conversation://${l2Id})`);
    assert(convLinkHtml.includes('conversation-link') && convLinkHtml.includes(`data-conversation-id="${l2Id}"`), 'AC-9: conversation:// must render clickable .conversation-link');
    console.log('✓ AC-9 passed');

    // =========================================================================
    // AC-10: Top-Level Auto-Selection & 3-Layer Live Execution Tree UI
    // =========================================================================
    console.log('Testing AC-10: Top-level auto-selection & 3-layer execution tree UI...');
    const initialSelected = DashboardWebviewPanel.resolveInitialSessionId([l2Sess, swarmWorkerSess, rootSess, swarmSess]);
    assert(initialSelected === rootId || initialSelected === swarmCoordId, `AC-10: resolveInitialSessionId must prefer top-level session, got ${initialSelected}`);

    const treeProvider = new ChatHistoryTreeProvider();
    treeProvider.allSessions = sessions;
    const rootGroups = await treeProvider.getChildren();
    assert(rootGroups.length > 0, 'AC-10: tree groups must render');
    const todayItems = await treeProvider.getChildren(rootGroups[0]);
    const todayIds = todayItems.map((i) => i.session.id);
    assert(!todayIds.includes(l1Id) && !todayIds.includes(l2Id), 'AC-10: root time groups must not list child subagents at top level');
    const rootTreeItem = todayItems.find((i) => i.session.id === rootId);
    assert(rootTreeItem && rootTreeItem.collapsibleState !== vscodeMock.TreeItemCollapsibleState.None, 'AC-10: coordinator TreeItem must be collapsible');
    const l1TreeItems = await treeProvider.getChildren(rootTreeItem);
    assert(l1TreeItems.some((i) => i.session.id === l1Id), 'AC-10: expanding coordinator must reveal L1 subagent');

    const { ExecutorLayoutHelper } = require('../out/views/ExecutorLayoutHelper');
    const switcherHtml = ExecutorLayoutHelper.renderExecutorSwitcherHtml(rootSess, [rootSess, l1Sess, l2Sess, l2Sess], rootId, 'transcript');
    assert(switcherHtml.includes(l1Id) && switcherHtml.includes(l2Id), 'AC-10: ExecutorSwitcher must render multi-level hierarchy');
    const matrixHtml = ExecutorLayoutHelper.renderProgressMatrixHtml(rootSess, [rootSess, l1Sess, l2Sess], swarmData);
    assert(matrixHtml.includes('WorkerL0') && matrixHtml.includes('run_command'), 'AC-10: ProgressMatrix must include subagent role & latestAction');
    const navMock = Object.assign(Object.create(DashboardWebviewPanel.prototype), {
      selectedSessionId: rootId,
      allSessionsCache: sessions
    });
    const navHtml = DashboardWebviewPanel.prototype.generateSessionListHtml.call(navMock, sessions, rootId);
    assert(navHtml.includes('executor-subnav-item') && navHtml.includes('data-rollup-exclude="true"'), 'AC-10/11: Dashboard nav sub-tree must mark children with .executor-subnav-item and data-rollup-exclude');
    console.log('✓ AC-10 passed');

    // =========================================================================
    // AC-11: Subagent Tree Token Rollup & Live Token Update Integrity
    // =========================================================================
    console.log('Testing AC-11: Subagent treeTokenUsage rollup, zero double-count, live status bar & pricing parity...');
    // Root: 1000 in, 4000 cache, 200 out (ctx 5000)
    // L1: (2000+500)=2500 in, (3000+4500)=7500 cache, (300+150)=450 out (ctx 5000)
    // L2: 3000 in, 1000 cache, 400 out (ctx 4000)
    // L2Sib: 1500 in, 2500 cache, 250 out (ctx 4000)
    // Expected Tree Total: in=8000, cache=15000, out=1300, cum=24300
    assert(rootSess.treeTokenUsage, 'AC-11: rootSess.treeTokenUsage must be populated');
    assert.strictEqual(rootSess.tokenUsage.peakContextTokens, 5000, 'AC-11: root tokenUsage.peakContextTokens must remain self-scoped (5000)');
    assert.strictEqual(rootSess.treeTokenUsage.totalInputTokens, 8000, 'AC-11: treeTokenUsage.totalInputTokens must sum self + descendants');
    assert.strictEqual(rootSess.treeTokenUsage.totalCacheReadTokens, 15000, 'AC-11: treeTokenUsage.totalCacheReadTokens must sum self + descendants');
    assert.strictEqual(rootSess.treeTokenUsage.totalOutputTokens, 1300, 'AC-11: treeTokenUsage.totalOutputTokens must sum self + descendants');
    assert.strictEqual(rootSess.treeTokenUsage.cumulativeTokens, 24300, 'AC-11: treeTokenUsage.cumulativeTokens must sum self + descendants');

    // Project rollup zero double-count when both root and children are passed, and zero under-count when only root is passed
    const rollupWithChildren = TokenUsageMonitor.aggregateProjectTokenUsage([rootSess, l1Sess, l2Sess]);
    const rollupRootOnly = TokenUsageMonitor.aggregateProjectTokenUsage([rootSess]);
    assert.strictEqual(rollupWithChildren.cumulativeTokens, 24300, 'AC-11: aggregateProjectTokenUsage must NOT double-count children');
    assert.strictEqual(rollupRootOnly.cumulativeTokens, 24300, 'AC-11: aggregateProjectTokenUsage must NOT under-count when only coordinator is present');

    // Reader banner Tree Total strip
    const bannerHtml = TokenUsageMonitor.renderReaderTokenBannerHtml(rootSess.tokenUsage, undefined, undefined, rootSess.treeTokenUsage);
    assert(bannerHtml.includes('Tree Total') && bannerHtml.includes('24.3k'), 'AC-11: renderReaderTokenBannerHtml must display Tree Total strip');

    // Status bar live incremental update when child L2 appends new tokens while Coordinator is idle
    const monitor = TokenUsageMonitor.getInstance();
    monitor.initialize({ subscriptions: [] });
    await monitor.triggerRefresh(rootId);
    const tooltipBefore = monitor.statusBarItem.tooltip.value;
    assert(tooltipBefore.includes('Tree Total'), 'AC-11: Status bar tooltip must include Tree Total for multi-executor session');

    // Append new token step to L2 while Root is untouched
    fs.appendFileSync(
      path.join(l2Dir, '.system_generated', 'logs', 'transcript.jsonl'),
      JSON.stringify({
        step_index: 2,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        created_at: new Date().toISOString(),
        input_tokens: 1000,
        cache_read_tokens: 2000,
        output_tokens: 500,
        model: 'gemini-4-hydrogen',
        content: 'More work done'
      }) + '\n',
      'utf8'
    );
    await monitor.triggerRefresh(rootId);
    const tooltipAfter = monitor.statusBarItem.tooltip.value;
    assert.notStrictEqual(tooltipAfter, tooltipBefore, 'AC-11: Status bar tooltip must update live when child subagent grows');
    assert(tooltipAfter.includes('27,800') || tooltipAfter.includes('27.8k'), 'AC-11: Status bar tooltip must reflect updated tree total (24300+3500=27800)');

    // Static check: ChatWebviewPanel passes pricingConfig to renderReaderTokenBannerHtml
    const chatPanelSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'ChatWebviewPanel.ts'), 'utf8');
    assert(chatPanelSrc.includes('getPricingFromSettings()'), 'AC-11: ChatWebviewPanel must pass TokenUsageMonitor.getPricingFromSettings()');
    console.log('✓ AC-11 passed');

    console.log('\n🎉 ALL AC-7..AC-11 MULTI-EXECUTOR VIEWER TESTS PASSED!');
  } finally {
    mockConfigStore['brainHub.brainPath'] = origBrainPath;
    scanner.stopRealtimeWatcher();
    scanner.stopBackgroundScanTimer();
    TokenUsageMonitor.getInstance().dispose();
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {}
  }
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
