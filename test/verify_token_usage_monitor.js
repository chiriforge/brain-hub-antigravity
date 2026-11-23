const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const Module = require('module');

// Mock 'vscode' module so SessionScanner and TokenUsageMonitor can be imported in Node test runner
const mockStatusBarItems = [];
const mockVscode = {
  StatusBarAlignment: { Left: 1, Right: 2 },
  ThemeColor: class ThemeColor {
    constructor(id) {
      this.id = id;
    }
  },
  ThemeIcon: class ThemeIcon {
    constructor(id, color) {
      this.id = id;
      this.color = color;
    }
  },
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
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  TreeItem: class TreeItem {
    constructor(label, collapsibleState) {
      this.label = label;
      this.collapsibleState = collapsibleState;
    }
  },
  EventEmitter: class EventEmitter {
    constructor() {
      this.event = () => ({ dispose: () => {} });
    }
    fire() {}
  },
  Uri: {
    file: (p) => ({ fsPath: p, scheme: 'file', toString: () => `file://${p}` }),
    parse: (s) => ({ fsPath: s.replace(/^file:\/+/, ''), scheme: 'file' }),
    joinPath: (base, ...segs) => ({ fsPath: path.join(base.fsPath || '', ...segs) })
  },
  workspace: {
    workspaceFolders: [],
    getConfiguration: () => ({
      get: (key, def) => def,
      inspect: () => undefined,
      update: async () => {}
    }),
    onDidChangeConfiguration: () => ({ dispose: () => {} }),
    onDidChangeWorkspaceFolders: () => ({ dispose: () => {} })
  },
  window: {
    createStatusBarItem: (alignment, priority) => {
      const item = {
        alignment,
        priority,
        text: '',
        tooltip: undefined,
        command: undefined,
        backgroundColor: undefined,
        color: undefined,
        visible: false,
        show() { this.visible = true; },
        hide() { this.visible = false; },
        dispose() { this.visible = false; }
      };
      mockStatusBarItems.push(item);
      return item;
    },
    showInformationMessage: async () => undefined,
    showWarningMessage: async () => undefined,
    showErrorMessage: async () => undefined
  },
  commands: {
    registerCommand: () => ({ dispose: () => {} }),
    executeCommand: async () => undefined
  }
};

const origRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === 'vscode') {
    return mockVscode;
  }
  return origRequire.apply(this, arguments);
};

async function runPhase1Tests() {
  console.log('=== Phase 1: Token Telemetry Data Model & SessionScanner Extraction (FR-1) ===');
  const { SessionScanner } = require('../out/services/SessionScanner');
  const scanner = SessionScanner.getInstance();

  // 1. Verify CACHE_SCHEMA_VERSION is at least 6
  assert(
    SessionScanner.CACHE_SCHEMA_VERSION >= 6,
    `Expected SessionScanner.CACHE_SCHEMA_VERSION >= 6, got ${SessionScanner.CACHE_SCHEMA_VERSION}`
  );
  console.log(`✓ 1.1: SessionScanner.CACHE_SCHEMA_VERSION >= 6 (${SessionScanner.CACHE_SCHEMA_VERSION})`);

  // 2. Verify formatCompactTokens helper
  assert.strictEqual(typeof SessionScanner.formatCompactTokens, 'function', 'SessionScanner.formatCompactTokens must be a static function');
  assert.strictEqual(SessionScanner.formatCompactTokens(0), '0');
  assert.strictEqual(SessionScanner.formatCompactTokens(-50), '0');
  assert.strictEqual(SessionScanner.formatCompactTokens(NaN), '0');
  assert.strictEqual(SessionScanner.formatCompactTokens(undefined), '0');
  assert.strictEqual(SessionScanner.formatCompactTokens(950), '950');
  assert.strictEqual(SessionScanner.formatCompactTokens(18137), '18.1k');
  assert.strictEqual(SessionScanner.formatCompactTokens(249894), '249.9k');
  assert.strictEqual(SessionScanner.formatCompactTokens(1250000), '1.25M');
  console.log('✓ 1.2: SessionScanner.formatCompactTokens formatting verified');

  // 3. Create temp fixture transcript with cold start, cache hit, mid-session cache miss, and malformed fields
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-hub-token-test-'));
  const sessionId = '96186b24-43ca-4ccd-9f05-5f0676b0eb30';
  const sessionDir = path.join(tmpDir, sessionId);
  const logsDir = path.join(sessionDir, '.system_generated', 'logs');
  fs.mkdirSync(logsDir, { recursive: true });
  const transcriptPath = path.join(logsDir, 'transcript.jsonl');

  const lines = [
    JSON.stringify({
      step_index: 0,
      type: 'USER_INPUT',
      source: 'USER_EXPLICIT',
      content: '<USER_REQUEST>Build token usage monitor</USER_REQUEST><user_information>Active Workspaces:\n- d:\\chiriforge\\brain-hub-antigravity</user_information>',
      created_at: '2026-11-11T14:00:00Z'
    }),
    // Step 1: Initial cold cache (input_tokens: 19052, cache_read_tokens: 0) -> NOT a cache miss
    JSON.stringify({
      step_index: 1,
      type: 'PLANNER_RESPONSE',
      source: 'MODEL',
      content: 'Inspecting project...',
      thinking: 'Thinking step 1',
      input_tokens: 19052,
      cache_read_tokens: 0,
      output_tokens: 450,
      tool_calls: [{ name: 'read_file', args: { Path: 'd:/chiriforge/brain-hub-antigravity/package.json' } }],
      created_at: '2026-11-11T14:00:05Z'
    }),
    // Step 2: Tool output
    JSON.stringify({
      step_index: 2,
      type: 'VIEW_FILE',
      source: 'TOOL',
      content: '{"name":"brain-hub-antigravity"}',
      created_at: '2026-11-11T14:00:06Z'
    }),
    // Step 3: Warm cache hit (input_tokens: 3202, cache_read_tokens: 20696 -> total 23898, 86.6% cache)
    JSON.stringify({
      step_index: 3,
      type: 'PLANNER_RESPONSE',
      source: 'MODEL',
      content: 'Implementing feature...',
      input_tokens: 3202,
      cache_read_tokens: 20696,
      output_tokens: 572,
      created_at: '2026-11-11T14:00:15Z'
    }),
    // Step 4: Mid-session KV Cache Miss (step > 1, cache_read_tokens: 0, input_tokens: 117873 > 25000)
    JSON.stringify({
      step_index: 4,
      type: 'PLANNER_RESPONSE',
      source: 'MODEL',
      content: 'Cache expired after pause, continuing...',
      input_tokens: 117873,
      cache_read_tokens: 0,
      output_tokens: 810,
      created_at: '2026-11-11T14:25:00Z'
    }),
    // Step 5: Malformed / negative / NaN token fields resilience test
    JSON.stringify({
      step_index: 5,
      type: 'PLANNER_RESPONSE',
      source: 'MODEL',
      content: 'Malformed step telemetry',
      input_tokens: -100,
      cache_read_tokens: 'not-a-number',
      output_tokens: null,
      created_at: '2026-11-11T14:26:00Z'
    }),
    // Step 6: Peak context step (input_tokens: 12000, cache_read_tokens: 148000 -> total 160000, 92.5% cache)
    JSON.stringify({
      step_index: 6,
      type: 'PLANNER_RESPONSE',
      source: 'MODEL',
      content: 'Final verification complete.',
      input_tokens: 12000,
      cache_read_tokens: 148000,
      output_tokens: 618,
      created_at: '2026-11-11T14:27:00Z'
    })
  ];

  fs.writeFileSync(transcriptPath, lines.join('\n') + '\n', 'utf8');

  try {
    // Test both metadataOnly = true and metadataOnly = false
    const parsedMeta = await scanner.parseTranscriptFileAsync(transcriptPath, sessionId, true);
    const parsedFull = await scanner.parseTranscriptFileAsync(transcriptPath, sessionId, false);

    assert(parsedMeta.tokenUsage, 'parsedMeta.tokenUsage should be populated in metadataOnly mode');
    assert(parsedFull.tokenUsage, 'parsedFull.tokenUsage should be populated in full mode');
    assert.deepStrictEqual(parsedMeta.tokenUsage, parsedFull.tokenUsage, 'metadataOnly and full mode tokenUsage must match');

    const tu = parsedFull.tokenUsage;
    assert.strictEqual(tu.plannerStepCount, 5, `Expected 5 planner steps, got ${tu.plannerStepCount}`);
    assert.strictEqual(tu.baselineContextTokens, 19052, `Expected baselineContextTokens === 19052, got ${tu.baselineContextTokens}`);
    assert.strictEqual(tu.peakContextTokens, 160000, `Expected peakContextTokens === 160000, got ${tu.peakContextTokens}`);
    assert.strictEqual(tu.peakStepIndex, 6, `Expected peakStepIndex === 6, got ${tu.peakStepIndex}`);
    assert.strictEqual(tu.latestStepIndex, 6, `Expected latestStepIndex === 6, got ${tu.latestStepIndex}`);
    assert.strictEqual(tu.latestContextTokens, 160000, `Expected latestContextTokens === 160000, got ${tu.latestContextTokens}`);
    assert.strictEqual(tu.latestCacheHitRatio, 92.5, `Expected latestCacheHitRatio === 92.5, got ${tu.latestCacheHitRatio}`);
    assert.strictEqual(tu.cacheMissCount, 1, `Expected cacheMissCount === 1, got ${tu.cacheMissCount}`);
    assert.strictEqual(tu.hasCacheMissAtTail, false, 'Step 6 is warm cache so hasCacheMissAtTail should be false');
    assert.strictEqual(tu.totalInputTokens, 19052 + 3202 + 117873 + 0 + 12000);
    assert.strictEqual(tu.totalCacheReadTokens, 0 + 20696 + 0 + 0 + 148000);
    assert.strictEqual(tu.totalOutputTokens, 450 + 572 + 810 + 0 + 618);
    assert.strictEqual(tu.cumulativeTokens, tu.totalInputTokens + tu.totalCacheReadTokens + tu.totalOutputTokens);

    // Check individual ChatMessage fields in full mode
    const plannerMsgs = parsedFull.messages.filter((m) => m.type === 'PLANNER_RESPONSE');
    assert.strictEqual(plannerMsgs.length, 5);
    // Step 1: initial cold cache -> isCacheMiss: false
    assert.strictEqual(plannerMsgs[0].inputTokens, 19052);
    assert.strictEqual(plannerMsgs[0].cacheReadTokens, 0);
    assert.strictEqual(plannerMsgs[0].totalContextTokens, 19052);
    assert.strictEqual(plannerMsgs[0].cacheHitRatio, 0);
    assert.strictEqual(plannerMsgs[0].isCacheMiss, false);

    // Step 3: warm cache hit -> 86.6%
    assert.strictEqual(plannerMsgs[1].totalContextTokens, 23898);
    assert.strictEqual(plannerMsgs[1].cacheHitRatio, 86.6);
    assert.strictEqual(plannerMsgs[1].isCacheMiss, false);

    // Step 4: mid-session cache miss -> isCacheMiss: true
    assert.strictEqual(plannerMsgs[2].totalContextTokens, 117873);
    assert.strictEqual(plannerMsgs[2].isCacheMiss, true);

    // Step 5: malformed -> coerced to 0 without NaN
    assert.strictEqual(plannerMsgs[3].inputTokens, 0);
    assert.strictEqual(plannerMsgs[3].cacheReadTokens, 0);
    assert.strictEqual(plannerMsgs[3].outputTokens, 0);
    assert.strictEqual(plannerMsgs[3].totalContextTokens, 0);
    assert.strictEqual(plannerMsgs[3].cacheHitRatio, 0);
    assert.strictEqual(plannerMsgs[3].isCacheMiss, false);

    // Check buildSessionFromParsed attaches tokenUsage
    const builtSession = scanner.buildSessionFromParsed(sessionId, sessionDir, new Date(), parsedMeta, [sessionDir]);
    assert(builtSession.tokenUsage, 'builtSession.tokenUsage must be attached');
    assert.strictEqual(builtSession.tokenUsage.peakContextTokens, 160000);
    console.log('✓ 1.3: Step & Session token extraction, cold-start vs cache-miss, and malformed input coercion verified');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function runPhase2Tests() {
  console.log('\n=== Phase 2: Byte-Offset Transcript Tailer & VS Code Status Bar HUD (FR-2, FR-3) ===');
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const props = pkg.contributes?.configuration?.properties || {};

  // 1. Check package.json settings & command
  assert(props['brainHub.enableTokenStatusBar'], 'Missing brainHub.enableTokenStatusBar setting in package.json');
  assert.strictEqual(props['brainHub.enableTokenStatusBar'].default, true);
  assert(props['brainHub.tokenWarningThreshold'], 'Missing brainHub.tokenWarningThreshold setting in package.json');
  assert.strictEqual(props['brainHub.tokenWarningThreshold'].default, 100000);
  assert(props['brainHub.tokenCriticalThreshold'], 'Missing brainHub.tokenCriticalThreshold setting in package.json');
  assert.strictEqual(props['brainHub.tokenCriticalThreshold'].default, 150000);
  const hasTokenCmd = (pkg.contributes?.commands || []).some((c) => c.command === 'brainHub.openActiveTokenSession');
  assert(hasTokenCmd, 'Missing brainHub.openActiveTokenSession command in package.json');
  console.log('✓ 2.1: package.json settings & command verified');

  // 2. Check TokenUsageMonitor service
  const { TokenUsageMonitor } = require('../out/services/TokenUsageMonitor');
  const { SessionScanner } = require('../out/services/SessionScanner');
  const monitor = TokenUsageMonitor.getInstance();
  const scanner = SessionScanner.getInstance();

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-hub-tailer-test-'));
  const sessionId = 'a1b2c3d4-1111-2222-3333-444455556666';
  const sessionDir = path.join(tmpDir, sessionId);
  const logsDir = path.join(sessionDir, '.system_generated', 'logs');
  fs.mkdirSync(logsDir, { recursive: true });
  const transcriptPath = path.join(logsDir, 'transcript.jsonl');

  try {
    // Write initial 2 steps
    const step0 = JSON.stringify({
      step_index: 0,
      type: 'USER_INPUT',
      source: 'USER_EXPLICIT',
      content: '<USER_REQUEST>Initial prompt</USER_REQUEST>',
      created_at: '2026-11-11T15:00:00Z'
    });
    const step1 = JSON.stringify({
      step_index: 1,
      type: 'PLANNER_RESPONSE',
      source: 'MODEL',
      content: 'First response',
      input_tokens: 18500,
      cache_read_tokens: 0,
      output_tokens: 320,
      created_at: '2026-11-11T15:00:05Z'
    });
    fs.writeFileSync(transcriptPath, `${step0}\n${step1}\n`, 'utf8');
    const sizeAfterStep1 = fs.statSync(transcriptPath).size;

    const usage1 = await monitor.readIncrementalTokenUsage(transcriptPath, sessionId);
    assert.strictEqual(usage1.plannerStepCount, 1);
    assert.strictEqual(usage1.latestContextTokens, 18500);
    assert.strictEqual(usage1.latestOutputTokens, 320);
    const tailState1 = monitor.getTailStateForTest(transcriptPath);
    assert(tailState1, 'Tail state must be tracked for transcriptPath');
    assert.strictEqual(tailState1.lastByteOffset, sizeAfterStep1, 'Byte offset after step 1 should equal file size');

    // Append step 2 + an incomplete trailing line (no newline yet)
    const step2 = JSON.stringify({
      step_index: 2,
      type: 'PLANNER_RESPONSE',
      source: 'MODEL',
      content: 'Second response with warm cache',
      input_tokens: 3202,
      cache_read_tokens: 20696,
      output_tokens: 572,
      created_at: '2026-11-11T15:00:15Z'
    });
    const partialStep3 = '{"step_index":3,"type":"PLANNER_RESPONSE","source":"MODEL","input_tokens":15000';
    fs.appendFileSync(transcriptPath, `${step2}\n${partialStep3}`, 'utf8');

    const usage2 = await monitor.readIncrementalTokenUsage(transcriptPath, sessionId);
    assert.strictEqual(usage2.plannerStepCount, 2, 'Incomplete partial line must be buffered, not counted yet');
    assert.strictEqual(usage2.latestContextTokens, 23898);
    assert.strictEqual(usage2.latestCacheHitRatio, 86.6);

    // Complete the trailing line for step 3
    const restOfStep3 = ',"cache_read_tokens":105000,"output_tokens":1200,"created_at":"2026-11-11T15:00:25Z"}\n';
    fs.appendFileSync(transcriptPath, restOfStep3, 'utf8');

    const usage3 = await monitor.readIncrementalTokenUsage(transcriptPath, sessionId);
    const fullParsed = await scanner.parseTranscriptFileAsync(transcriptPath, sessionId, true);
    assert.deepStrictEqual(usage3, fullParsed.tokenUsage, 'Incremental tail usage must equal full-file parse exactly');
    assert.strictEqual(usage3.plannerStepCount, 3);
    assert.strictEqual(usage3.latestContextTokens, 120000);
    assert.strictEqual(usage3.peakContextTokens, 120000);
    console.log('✓ 2.2: Incremental byte-offset tailing & partial-line buffering verified');

    // Test truncation safety (stat.size < lastByteOffset)
    fs.writeFileSync(transcriptPath, `${step0}\n${step1}\n`, 'utf8');
    const usageTruncated = await monitor.readIncrementalTokenUsage(transcriptPath, sessionId);
    assert.strictEqual(usageTruncated.plannerStepCount, 1, 'After truncation, tailer must reset to byte 0 and re-read cleanly');
    assert.strictEqual(usageTruncated.latestContextTokens, 18500);
    console.log('✓ 2.3: File truncation fallback to byte 0 verified');

    // Test Status Bar State formatting (Normal, Warning, Critical, Cache Miss, and Inverted Thresholds)
    const mockSession = {
      id: sessionId,
      title: 'Token Monitor Test Session',
      workspaceName: 'brain-hub-antigravity'
    };

    // Normal state (< 100k)
    const normalState = TokenUsageMonitor.formatStatusBarState(usage2, mockSession, {
      warningThreshold: 100000,
      criticalThreshold: 150000
    });
    assert.strictEqual(normalState.severity, 'normal');
    assert(normalState.text.startsWith('$(pulse) Ctx: 23.9k (87% cache) | Out: 572 | #2'), `Unexpected normal text: ${normalState.text}`);
    assert.strictEqual(normalState.backgroundColorId, undefined);
    assert(!normalState.tooltipMarkdown.includes('undefined') && !normalState.tooltipMarkdown.includes('NaN'));

    // Warning state (120k >= 100k)
    const warnState = TokenUsageMonitor.formatStatusBarState(usage3, mockSession, {
      warningThreshold: 100000,
      criticalThreshold: 150000
    });
    assert.strictEqual(warnState.severity, 'warning');
    assert(warnState.text.startsWith('$(warning) Ctx: 120.0k (88% cache) | Out: 1.2k | #3'), `Unexpected warn text: ${warnState.text}`);
    assert.strictEqual(warnState.backgroundColorId, 'statusBarItem.warningBackground');
    assert(warnState.tooltipMarkdown.includes('/compact'), 'Warning tooltip should mention /compact');

    // Critical state (168.1k >= 150k)
    const critUsage = {
      ...usage3,
      latestStepIndex: 51,
      latestContextTokens: 168100,
      latestCacheHitRatio: 91.2,
      latestOutputTokens: 618,
      peakContextTokens: 168100
    };
    const critState = TokenUsageMonitor.formatStatusBarState(critUsage, mockSession, {
      warningThreshold: 100000,
      criticalThreshold: 150000
    });
    assert.strictEqual(critState.severity, 'critical');
    assert.strictEqual(critState.text, '$(flame) Ctx: 168.1k (91% cache) | Out: 618 | #51');
    assert.strictEqual(critState.backgroundColorId, 'statusBarItem.errorBackground');
    assert(critState.tooltipMarkdown.includes('/compact'), 'Critical tooltip must recommend /compact');

    // Cache Miss at tail state
    const cacheMissUsage = {
      ...usage2,
      latestStepIndex: 94,
      latestInputTokens: 247905,
      latestCacheReadTokens: 0,
      latestContextTokens: 247905,
      latestCacheHitRatio: 0,
      latestOutputTokens: 1989,
      hasCacheMissAtTail: true,
      cacheMissCount: 1
    };
    const missState = TokenUsageMonitor.formatStatusBarState(cacheMissUsage, mockSession, {
      warningThreshold: 300000,
      criticalThreshold: 400000
    });
    assert.strictEqual(missState.severity, 'warning');
    assert(missState.text.includes('Cache Miss'), `Expected Cache Miss suffix in status bar text, got: ${missState.text}`);

    // Threshold inversion guard (warningThreshold > criticalThreshold -> effectiveWarning = Math.min(warn, crit) = 100k, effectiveCritical = Math.max(warn, crit) = 200k)
    const normThresholds = TokenUsageMonitor.normalizeThresholds({
      warningThreshold: 200000,
      criticalThreshold: 100000
    });
    assert.strictEqual(normThresholds.warningThreshold, 100000);
    assert.strictEqual(normThresholds.criticalThreshold, 200000);
    const invertedState = TokenUsageMonitor.formatStatusBarState(usage3, mockSession, {
      warningThreshold: 200000,
      criticalThreshold: 100000
    });
    assert.strictEqual(invertedState.severity, 'warning', 'When warning (200k) > critical (100k), normalized bounds [100k, 200k] classify 120k as warning');
    console.log('✓ 2.4: Status Bar deterministic text, severity, ThemeColor & Markdown tooltip verified');

    // Test concurrent reentrancy guard (rapid calls at t=0ms..10ms)
    const concurrentCalls = await Promise.all([
      monitor.readIncrementalTokenUsage(transcriptPath, sessionId),
      monitor.readIncrementalTokenUsage(transcriptPath, sessionId),
      monitor.readIncrementalTokenUsage(transcriptPath, sessionId)
    ]);
    assert.strictEqual(concurrentCalls[0].plannerStepCount, 1);
    assert.strictEqual(concurrentCalls[2].plannerStepCount, 1);
    console.log('✓ 2.5: Concurrent re-entrancy lock verified');
  } finally {
    monitor.dispose();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function runPhase3Tests() {
  console.log('\n=== Phase 3: 3-Tier Webview & Sidebar Token Telemetry UI (FR-4, FR-5) ===');
  const { TokenUsageMonitor } = require('../out/services/TokenUsageMonitor');
  const { SessionTreeItem } = require('../out/providers/ChatHistoryTreeProvider');

  // 1. Verify TokenUsageMonitor static rendering helpers for Tier 1, Tier 2, Tier 3, and CSS
  assert.strictEqual(
    typeof TokenUsageMonitor.renderTokenUsageSvgChart,
    'function',
    'TokenUsageMonitor.renderTokenUsageSvgChart must be a static function'
  );
  assert.strictEqual(
    typeof TokenUsageMonitor.renderReaderTokenBannerHtml,
    'function',
    'TokenUsageMonitor.renderReaderTokenBannerHtml must be a static function'
  );
  assert.strictEqual(
    typeof TokenUsageMonitor.renderStepTokenBadgeHtml,
    'function',
    'TokenUsageMonitor.renderStepTokenBadgeHtml must be a static function'
  );
  assert.strictEqual(
    typeof TokenUsageMonitor.renderSessionTokenBadgeHtml,
    'function',
    'TokenUsageMonitor.renderSessionTokenBadgeHtml must be a static function'
  );
  assert.strictEqual(
    typeof TokenUsageMonitor.getTokenTelemetryCss,
    'function',
    'TokenUsageMonitor.getTokenTelemetryCss must be a static function'
  );

  const sampleUsage = {
    plannerStepCount: 3,
    latestStepIndex: 4,
    latestInputTokens: 12000,
    latestCacheReadTokens: 148000,
    latestOutputTokens: 618,
    latestContextTokens: 160000,
    latestCacheHitRatio: 92.5,
    peakContextTokens: 160000,
    peakStepIndex: 4,
    baselineContextTokens: 19052,
    totalInputTokens: 148925,
    totalCacheReadTokens: 148000,
    totalOutputTokens: 1878,
    cumulativeTokens: 298803,
    overallCacheHitRatio: 49.8,
    cacheMissCount: 1,
    hasCacheMissAtTail: false,
    stepMetrics: [
      {
        stepIndex: 1,
        inputTokens: 19052,
        cacheReadTokens: 0,
        outputTokens: 450,
        totalContextTokens: 19052,
        cacheHitRatio: 0,
        isCacheMiss: false,
        timestamp: '2026-11-11T14:00:05Z',
        toolNames: ['read_file']
      },
      {
        stepIndex: 3,
        inputTokens: 117873,
        cacheReadTokens: 0,
        outputTokens: 810,
        totalContextTokens: 117873,
        cacheHitRatio: 0,
        isCacheMiss: true,
        timestamp: '2026-11-11T14:25:00Z',
        toolNames: ['edit_file']
      },
      {
        stepIndex: 4,
        inputTokens: 12000,
        cacheReadTokens: 148000,
        outputTokens: 618,
        totalContextTokens: 160000,
        cacheHitRatio: 92.5,
        isCacheMiss: false,
        timestamp: '2026-11-11T14:27:00Z',
        toolNames: ['run_command']
      }
    ]
  };

  // Tier 1: Banner & SVG chart
  const bannerHtml = TokenUsageMonitor.renderReaderTokenBannerHtml(sampleUsage, {
    warningThreshold: 100000,
    criticalThreshold: 150000
  });
  assert(bannerHtml.includes('id="readerTokenBanner"'), 'Banner must have id="readerTokenBanner"');
  assert(bannerHtml.includes('class="token-telemetry-banner'), 'Banner must have class="token-telemetry-banner"');
  assert(bannerHtml.includes('id="tokenTelemetryDrawer"'), 'Banner must include #tokenTelemetryDrawer');
  assert(bannerHtml.includes('class="token-telemetry-drawer"'), 'Banner must include .token-telemetry-drawer');
  assert(bannerHtml.includes('data-step="token-telemetry-drawer"'), 'Drawer must have data-step="token-telemetry-drawer" for open state preservation');
  assert(bannerHtml.includes('<svg class="token-step-chart"'), 'Drawer must contain <svg class="token-step-chart"');
  assert(bannerHtml.includes('token-threshold-warn'), 'SVG chart must include warning threshold dashed line');
  assert(bannerHtml.includes('token-threshold-crit'), 'SVG chart must include critical threshold dashed line');
  assert(!bannerHtml.includes('NaN') && !bannerHtml.includes('undefined') && !bannerHtml.includes('[object Object]'));
  console.log('✓ 3.1: Tier 1 Reader Header Token Banner & SVG Step Chart verified');

  // Tier 2: Per-step token badge & cache miss badge
  const normalStepBadge = TokenUsageMonitor.renderStepTokenBadgeHtml({
    inputTokens: 3202,
    cacheReadTokens: 20696,
    outputTokens: 572,
    totalContextTokens: 23898,
    cacheHitRatio: 86.6,
    isCacheMiss: false
  });
  assert(normalStepBadge.includes('class="step-token-badge"'), 'Step badge must have .step-token-badge');
  assert(normalStepBadge.includes('23.9k'), 'Step badge must display compact context tokens');
  assert(normalStepBadge.includes('86.6% cache'), 'Step badge must display cache hit ratio');
  assert(!normalStepBadge.includes('step-cache-miss-badge'), 'Normal step must not include cache-miss badge');

  const missStepBadge = TokenUsageMonitor.renderStepTokenBadgeHtml({
    inputTokens: 117873,
    cacheReadTokens: 0,
    outputTokens: 810,
    totalContextTokens: 117873,
    cacheHitRatio: 0,
    isCacheMiss: true
  });
  assert(missStepBadge.includes('class="step-token-badge"'), 'Miss step must include .step-token-badge');
  assert(missStepBadge.includes('class="step-cache-miss-badge"'), 'Cache miss step must include .step-cache-miss-badge');
  assert(missStepBadge.includes('Cache Miss'), 'Cache miss step must include Cache Miss label');
  console.log('✓ 3.2: Tier 2 Per-step token badge & cache-miss badge verified');

  // Tier 3: Sidebar session card badge & SessionTreeItem description/tooltip
  const sessionBadgeCrit = TokenUsageMonitor.renderSessionTokenBadgeHtml(sampleUsage, {
    warningThreshold: 100000,
    criticalThreshold: 150000
  });
  assert(sessionBadgeCrit.includes('session-token-badge'), 'Sidebar session badge must include .session-token-badge');
  assert(sessionBadgeCrit.includes('token-crit'), '160k peak >= 150k critical must have token-crit class');
  assert(sessionBadgeCrit.includes('160.0k'), 'Sidebar session badge must display compact peak context');

  const sessionBadgeWarn = TokenUsageMonitor.renderSessionTokenBadgeHtml(
    { ...sampleUsage, peakContextTokens: 120000, latestContextTokens: 120000 },
    { warningThreshold: 100000, criticalThreshold: 150000 }
  );
  assert(sessionBadgeWarn.includes('token-warn'), '120k peak >= 100k warning must have token-warn class');

  const sessionBadgeOk = TokenUsageMonitor.renderSessionTokenBadgeHtml(
    { ...sampleUsage, peakContextTokens: 45000, latestContextTokens: 45000, cacheMissCount: 0, hasCacheMissAtTail: false },
    { warningThreshold: 100000, criticalThreshold: 150000 }
  );
  assert(sessionBadgeOk.includes('token-ok'), '45k peak < 100k warning must have token-ok class');

  // Verify SessionTreeItem in ChatHistoryTreeProvider
  const treeItem = new SessionTreeItem(
    {
      id: '96186b24-43ca-4ccd-9f05-5f0676b0eb30',
      title: 'Test Session With Tokens',
      lastModified: new Date(),
      path: 'C:\\tmp\\96186b24-43ca-4ccd-9f05-5f0676b0eb30',
      messages: [],
      messageCount: 12,
      workspaceName: 'brain-hub-antigravity',
      tokenUsage: sampleUsage
    },
    mockVscode.TreeItemCollapsibleState.None
  );
  assert(
    typeof treeItem.description === 'string' && treeItem.description.includes('160.0k'),
    `Expected SessionTreeItem.description to include peak context 160.0k, got: ${treeItem.description}`
  );
  const tooltipText = typeof treeItem.tooltip === 'string' ? treeItem.tooltip : (treeItem.tooltip && treeItem.tooltip.value) || '';
  assert(
    tooltipText.includes('160.0k'),
    `Expected SessionTreeItem.tooltip to include peak context 160.0k, got: ${tooltipText}`
  );
  console.log('✓ 3.3: Tier 3 Sidebar session badge & SessionTreeItem description/tooltip verified');

  // Verify Theme Parity CSS (AC-4.2)
  const css = TokenUsageMonitor.getTokenTelemetryCss();
  assert(css.includes('.token-telemetry-banner'), 'CSS must style .token-telemetry-banner');
  assert(css.includes('.token-telemetry-drawer'), 'CSS must style .token-telemetry-drawer');
  assert(css.includes('.token-step-chart'), 'CSS must style .token-step-chart');
  assert(css.includes('.step-token-badge'), 'CSS must style .step-token-badge');
  assert(css.includes('.step-cache-miss-badge'), 'CSS must style .step-cache-miss-badge');
  assert(css.includes('.session-token-badge'), 'CSS must style .session-token-badge');
  assert(css.includes('var(--vscode-'), 'CSS must use VS Code theme variables');
  assert(css.includes('body.vscode-light'), 'CSS must support body.vscode-light');
  assert(css.includes('body.vscode-high-contrast'), 'CSS must support body.vscode-high-contrast');
  console.log('✓ 3.4: Theme parity CSS variables & light/high-contrast overrides verified');

  // Verify wiring in DashboardWebviewPanel.ts and ChatWebviewPanel.ts (FR-4 & FR-5)
  const dashSrc = fs.readFileSync('src/views/DashboardWebviewPanel.ts', 'utf8');
  const chatSrc = fs.readFileSync('src/views/ChatWebviewPanel.ts', 'utf8');

  assert(dashSrc.includes('renderReaderTokenBannerHtml'), 'DashboardWebviewPanel.ts must call renderReaderTokenBannerHtml');
  assert(dashSrc.includes('renderStepTokenBadgeHtml'), 'DashboardWebviewPanel.ts must call renderStepTokenBadgeHtml');
  assert(dashSrc.includes('renderSessionTokenBadgeHtml'), 'DashboardWebviewPanel.ts must call renderSessionTokenBadgeHtml');
  assert(dashSrc.includes('getTokenTelemetryCss'), 'DashboardWebviewPanel.ts must include getTokenTelemetryCss');
  assert(dashSrc.includes('tokenTelemetryDrawer'), 'DashboardWebviewPanel.ts must preserve #tokenTelemetryDrawer state on live updates');
  assert(dashSrc.includes('tokenBannerHtml'), 'DashboardWebviewPanel.ts liveStepsUpdated must include tokenBannerHtml');

  assert(chatSrc.includes('renderReaderTokenBannerHtml'), 'ChatWebviewPanel.ts must call renderReaderTokenBannerHtml');
  assert(chatSrc.includes('renderStepTokenBadgeHtml'), 'ChatWebviewPanel.ts must call renderStepTokenBadgeHtml');
  assert(chatSrc.includes('getTokenTelemetryCss'), 'ChatWebviewPanel.ts must include getTokenTelemetryCss');
  assert(chatSrc.includes('tokenTelemetryDrawer'), 'ChatWebviewPanel.ts must preserve #tokenTelemetryDrawer state on live updates');
  assert(chatSrc.includes('tokenBannerHtml'), 'ChatWebviewPanel.ts liveStepsUpdated must include tokenBannerHtml');
  console.log('✓ 3.5: DashboardWebviewPanel & ChatWebviewPanel 3-Tier & liveStepsUpdated wiring verified');
}

async function runPhase4EnhancementTests() {
  console.log('\n=== Phase 4: DESC Table, Sticky Header CSS, Cached Pill, Model Pricing & Project Rollup (SPEC-26111416) ===');
  const { SessionScanner } = require('../out/services/SessionScanner');
  const { TokenUsageMonitor } = require('../out/services/TokenUsageMonitor');

  // 1. AC-3 & AC-4: Per-model extraction & modelBreakdown in computeTokenUsageFromRawSteps
  const mixedRawSteps = [
    {
      step_index: 1,
      type: 'PLANNER_RESPONSE',
      model: 'gemini-4-hydrogen-high',
      input_tokens: 100000,
      cache_read_tokens: 2000000,
      output_tokens: 20000,
      created_at: '2026-11-14T10:00:00Z'
    },
    {
      step_index: 3,
      type: 'PLANNER_RESPONSE',
      model: 'gemini-3.8-flash',
      input_tokens: 50000,
      cache_read_tokens: 1000000,
      output_tokens: 10000,
      created_at: '2026-11-14T10:01:00Z'
    },
    {
      step_index: 5,
      type: 'PLANNER_RESPONSE',
      input_tokens: 10000,
      cache_read_tokens: 0,
      output_tokens: 1000,
      created_at: '2026-11-14T10:02:00Z'
    }
  ];

  const mixedSummary = SessionScanner.computeTokenUsageFromRawSteps(mixedRawSteps);
  assert.strictEqual(mixedSummary.primaryModel, 'gemini-3.8-flash', 'primaryModel should record last seen non-empty model');
  assert(mixedSummary.modelBreakdown && typeof mixedSummary.modelBreakdown === 'object', 'modelBreakdown must be populated');
  assert.strictEqual(mixedSummary.modelBreakdown['gemini-4-hydrogen-high'].inputTokens, 100000);
  assert.strictEqual(mixedSummary.modelBreakdown['gemini-4-hydrogen-high'].cacheReadTokens, 2000000);
  assert.strictEqual(mixedSummary.modelBreakdown['gemini-4-hydrogen-high'].outputTokens, 20000);
  assert.strictEqual(mixedSummary.modelBreakdown['gemini-3.8-flash'].inputTokens, 50000);
  assert.strictEqual(mixedSummary.modelBreakdown['unknown'].inputTokens, 10000);
  assert.strictEqual(mixedSummary.stepMetrics[0].model, 'gemini-4-hydrogen-high');
  console.log('✓ 4.1: Per-model token breakdown extraction verified');

  // 2. AC-3 & AC-4: package.json settings & TokenUsageMonitor.calculateTokenCost
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const props = pkg.contributes.configuration.properties;
  assert(props['brainHub.modelPricing'], 'package.json must declare brainHub.modelPricing');
  assert(props['brainHub.defaultModelPricing'], 'package.json must declare brainHub.defaultModelPricing');

  assert.strictEqual(typeof TokenUsageMonitor.calculateTokenCost, 'function', 'TokenUsageMonitor.calculateTokenCost must exist');
  const twoModelSummary = SessionScanner.computeTokenUsageFromRawSteps(mixedRawSteps.slice(0, 2));
  const twoModelCost = TokenUsageMonitor.calculateTokenCost(twoModelSummary);
  // Hydrogen: (0.1 * 1.5) + (2.0 * 0.075) + (0.02 * 7.5) = 0.15 + 0.15 + 0.15 = 0.45
  // Flash:    (0.05 * 0.75) + (1.0 * 0.075) + (0.01 * 3.75) = 0.0375 + 0.075 + 0.0375 = 0.15
  assert(Math.abs(twoModelCost.totalCost - 0.6) < 1e-6, `Expected totalCost === 0.60, got ${twoModelCost.totalCost}`);
  assert(Math.abs(twoModelCost.cachedCost - 0.225) < 1e-6, `Expected cachedCost === 0.225, got ${twoModelCost.cachedCost}`);

  // Test Argon & Carbon & older Gemini Flash defaults
  const multiFamilySummary = SessionScanner.computeTokenUsageFromRawSteps([
    { step_index: 1, type: 'PLANNER_RESPONSE', model: 'gemini-4-argon', input_tokens: 1000000, cache_read_tokens: 1000000, output_tokens: 1000000 },
    { step_index: 2, type: 'PLANNER_RESPONSE', model: 'gemini-4-carbon-high', input_tokens: 1000000, cache_read_tokens: 1000000, output_tokens: 1000000 },
    { step_index: 3, type: 'PLANNER_RESPONSE', model: 'gemini-2.5-flash', input_tokens: 1000000, cache_read_tokens: 1000000, output_tokens: 1000000 }
  ]);
  const multiFamilyCost = TokenUsageMonitor.calculateTokenCost(multiFamilySummary);
  // Argon: 2 + 0.1 + 10 = 12.1; Carbon: 2 + 0.1 + 10 = 12.1; Flash: 0.75 + 0.075 + 3.75 = 4.575 => 28.775
  assert(Math.abs(multiFamilyCost.totalCost - 28.775) < 1e-6, `Expected 28.775 across Argon/Carbon/Flash, got ${multiFamilyCost.totalCost}`);

  // Test negative / NaN / legacy summary without modelBreakdown
  const legacyCost = TokenUsageMonitor.calculateTokenCost(
    { totalInputTokens: 1000000, totalCacheReadTokens: 2000000, totalOutputTokens: 100000 },
    {
      rules: [{ pattern: 'bad', label: 'Bad', inputPer1M: -5, outputPer1M: NaN, cachedPer1M: -1 }],
      defaultPricing: { inputPer1M: -2, outputPer1M: Number.NaN, cachedPer1M: -0.5 }
    }
  );
  assert(Number.isFinite(legacyCost.totalCost) && legacyCost.totalCost >= 0, 'Cost must sanitize invalid rates without NaN');
  console.log('✓ 4.2: Configurable model pricing & boundary resilience verified');

  // 3. AC-1: DESC step table with ALL 40 steps & left-to-right SVG chart
  const fortySteps = [];
  for (let i = 1; i <= 40; i++) {
    fortySteps.push({
      stepIndex: i * 3,
      inputTokens: 2000 + i * 10,
      cacheReadTokens: 20000 + i * 100,
      outputTokens: 300 + i,
      totalContextTokens: 22000 + i * 110,
      cacheHitRatio: 90.0,
      isCacheMiss: false,
      model: 'gemini-4-hydrogen-high',
      toolNames: ['read_file']
    });
  }
  const fortySummary = {
    plannerStepCount: 40,
    latestStepIndex: 120,
    latestInputTokens: 2400,
    latestCacheReadTokens: 24000,
    latestOutputTokens: 340,
    latestContextTokens: 26400,
    latestCacheHitRatio: 90.0,
    peakContextTokens: 26400,
    peakStepIndex: 120,
    baselineContextTokens: 22110,
    totalInputTokens: 100000,
    totalCacheReadTokens: 2000000,
    totalOutputTokens: 20000,
    cumulativeTokens: 2120000,
    overallCacheHitRatio: 95.2,
    cacheMissCount: 0,
    hasCacheMissAtTail: false,
    primaryModel: 'gemini-4-hydrogen-high',
    modelBreakdown: {
      'gemini-4-hydrogen-high': {
        inputTokens: 100000,
        cacheReadTokens: 2000000,
        outputTokens: 20000,
        stepCount: 40
      }
    },
    stepMetrics: fortySteps
  };

  const bannerForty = TokenUsageMonitor.renderReaderTokenBannerHtml(fortySummary);
  const tbodyMatch = bannerForty.match(/<tbody>([\s\S]*?)<\/tbody>/);
  assert(tbodyMatch, 'Banner must include <tbody>');
  const rowMatches = tbodyMatch[1].match(/<tr[\s>]/g) || [];
  assert.strictEqual(rowMatches.length, 40, `Expected all 40 step rows in table, got ${rowMatches.length}`);
  const firstRowIdx = tbodyMatch[1].indexOf('#120');
  const lastRowIdx = tbodyMatch[1].indexOf('#3<');
  assert(firstRowIdx !== -1 && lastRowIdx !== -1 && firstRowIdx < lastRowIdx, 'Table rows must be sorted DESC (#120 before #3)');

  const svgFirstBar = bannerForty.indexOf('data-step-index="3"');
  const svgLastBar = bannerForty.indexOf('data-step-index="120"');
  assert(svgFirstBar !== -1 && svgLastBar !== -1 && svgFirstBar < svgLastBar, 'SVG chart bars must remain left-to-right (#3 before #120)');

  // Verify compact icon-only metrics & Est. Cost pills in banner & status bar
  assert(bannerForty.includes('💾2M'), `Banner must display compact 💾2M without label, got: ${bannerForty}`);
  assert(!bannerForty.includes('Σ Cached:'), 'Banner must omit verbose Σ Cached label');
  assert(!bannerForty.includes('Latest Ctx:'), 'Banner must omit verbose Latest Ctx label');
  assert(!bannerForty.includes('Peak Ctx:'), 'Banner must omit verbose Peak Ctx label');
  assert(bannerForty.includes('💰$0.45'), 'Banner must display compact 💰$0.45');
  assert(!bannerForty.includes('NaN') && !bannerForty.includes('undefined'), 'Banner must have zero NaN/undefined leaks');

  const sbForty = TokenUsageMonitor.formatStatusBarState(fortySummary);
  assert(sbForty.tooltipMarkdown.includes('$0.45'), 'Status bar tooltip must include Est. Cost');
  console.log('✓ 4.3: DESC 40-row table, left-to-right SVG, compact icon-only metrics & Est. Cost verified');

  // 4. AC-2: Sticky header CSS isolation & opaque background
  const css = TokenUsageMonitor.getTokenTelemetryCss();
  assert(css.includes('border-collapse: separate'), 'CSS must use border-collapse: separate on .token-step-table');
  assert(css.includes('border-spacing: 0'), 'CSS must set border-spacing: 0 on .token-step-table');
  assert(css.includes('margin: 0'), 'CSS must reset margin: 0 on .token-step-table');
  assert(css.includes('isolation: isolate'), 'CSS must isolate .token-step-table-wrap');
  assert(css.includes('z-index: 2'), 'CSS must set z-index on sticky .token-step-table thead th');
  console.log('✓ 4.4: Sticky header CSS bleed-through fixes verified');

  // 5. AC-5: Project / Folder rollup & Dashboard sidebar wiring
  assert.strictEqual(typeof TokenUsageMonitor.aggregateProjectTokenUsage, 'function', 'TokenUsageMonitor.aggregateProjectTokenUsage must exist');
  const rollup = TokenUsageMonitor.aggregateProjectTokenUsage([
    { workspacePath: 'D:\\Project\\Alpha', tokenUsage: twoModelSummary },
    { workspacePath: '/d/project/alpha/', tokenUsage: fortySummary }
  ]);
  assert.strictEqual(rollup.sessionCount, 2);
  assert.strictEqual(rollup.totalInputTokens, 150000 + 100000);
  assert.strictEqual(rollup.totalCacheReadTokens, 3000000 + 2000000);
  assert.strictEqual(rollup.totalOutputTokens, 30000 + 20000);
  assert(Math.abs(rollup.cost.totalCost - (0.6 + 0.45)) < 1e-6, `Expected rollup cost 1.05, got ${rollup.cost.totalCost}`);

  const dashSrc = fs.readFileSync('src/views/DashboardWebviewPanel.ts', 'utf8');
  assert(dashSrc.includes('sidebarTokenRollup'), 'DashboardWebviewPanel.ts must render #sidebarTokenRollup');
  assert(dashSrc.includes('updateSidebarTokenRollup'), 'DashboardWebviewPanel.ts must dynamically update #sidebarTokenRollup on filterSessions');
  console.log('✓ 4.5: Project/Folder rollup aggregation & Dashboard sidebar wiring verified');
}

async function runPhase5PerModelThresholdAndCompactBannerTests() {
  console.log('\n=== Phase 5: Per-Model Context Thresholds & Compact Token Strip (SPEC-26112117) ===');
  const { TokenUsageMonitor } = require('../out/services/TokenUsageMonitor');
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const pricingDefaults = pkg.contributes?.configuration?.properties?.['brainHub.modelPricing']?.default || [];
  assert(Array.isArray(pricingDefaults) && pricingDefaults.length >= 5, 'brainHub.modelPricing defaults must exist');
  const hydrogenDefault = pricingDefaults.find((r) => r.pattern === 'hydrogen');
  assert(
    hydrogenDefault && hydrogenDefault.warningThreshold === 205000 && hydrogenDefault.criticalThreshold === 240000,
    'package.json hydrogen rule must default to 205k / 240k'
  );

  assert.strictEqual(typeof TokenUsageMonitor.resolveModelThresholds, 'function', 'resolveModelThresholds must exist');
  assert.deepStrictEqual(TokenUsageMonitor.resolveModelThresholds('gemini-4-hydrogen-high'), {
    warningThreshold: 205000,
    criticalThreshold: 240000
  });
  assert.deepStrictEqual(TokenUsageMonitor.resolveModelThresholds('gemini-3.8-flash'), {
    warningThreshold: 200000,
    criticalThreshold: 235000
  });
  assert.deepStrictEqual(TokenUsageMonitor.resolveModelThresholds('gemini-4-argon'), {
    warningThreshold: 285000,
    criticalThreshold: 335000
  });
  assert.deepStrictEqual(TokenUsageMonitor.resolveModelThresholds('gemini-4-carbon-high'), {
    warningThreshold: 285000,
    criticalThreshold: 335000
  });
  assert.deepStrictEqual(TokenUsageMonitor.resolveModelThresholds('claude-sonnet-4-5'), {
    warningThreshold: 150000,
    criticalThreshold: 180000
  });
  assert.deepStrictEqual(
    TokenUsageMonitor.resolveModelThresholds('unknown-custom-model', undefined, { warningThreshold: 100000, criticalThreshold: 150000 }),
    { warningThreshold: 100000, criticalThreshold: 150000 }
  );

  // Hydrogen at 220k -> Warning (not Critical), Argon at 260k -> Normal
  const baseUsage = {
    plannerStepCount: 10,
    latestStepIndex: 55,
    latestInputTokens: 4000,
    latestCacheReadTokens: 216000,
    latestOutputTokens: 900,
    latestContextTokens: 220000,
    latestCacheHitRatio: 98.2,
    peakContextTokens: 220000,
    peakStepIndex: 42,
    baselineContextTokens: 20000,
    totalInputTokens: 50000,
    totalCacheReadTokens: 1200000,
    totalOutputTokens: 12000,
    cumulativeTokens: 1262000,
    overallCacheHitRatio: 96.0,
    cacheMissCount: 0,
    hasCacheMissAtTail: false,
    primaryModel: 'gemini-4-hydrogen-high',
    stepMetrics: [
      {
        stepIndex: 55,
        inputTokens: 4000,
        cacheReadTokens: 216000,
        outputTokens: 900,
        totalContextTokens: 220000,
        cacheHitRatio: 98.2,
        isCacheMiss: false,
        model: 'gemini-4-hydrogen-high'
      }
    ]
  };

  const hydroBanner = TokenUsageMonitor.renderReaderTokenBannerHtml(baseUsage);
  const hydroPlain = hydroBanner
    .split('<')
    .map((seg, idx) => (idx === 0 ? seg : seg.slice(seg.indexOf('>') + 1)))
    .join('');
  assert(hydroBanner.includes('token-severity-warning'), 'Hydrogen at 220k must be warning (>=205k, <240k)');
  assert(hydroBanner.includes('🟡</span>'), 'Status indicator must be icon-only circle 🟡 without text');
  assert(!hydroBanner.includes('Critical: Run /compact'), 'Status indicator must not render verbose label text');
  assert(!hydroPlain.includes('🏔️220.0k (#42)') && !hydroPlain.includes('🏔️220.0k(#42)'), 'Peak Ctx must not display (#step)');
  assert(hydroPlain.includes('🏔️220.0k'), 'Peak Ctx must display compact value with no space');
  assert(hydroPlain.includes('⚡220.0k(#55)'), 'Latest Ctx must display compact value with no space');
  assert(hydroPlain.includes('📥50.0k'), 'Total Input must display icon-only compact value with no space');
  assert(hydroPlain.includes('💾1.2M'), 'Total Cache must display icon-only compact value with no space');
  assert(hydroPlain.includes('📤12.0k'), 'Total Output must display icon-only compact value with no space');
  assert(hydroPlain.includes('♻️98.2%(Σ96.0%)'), 'Cache Hit must display compact ratio with no space');
  assert(!hydroBanner.includes('token-summary-metrics'), 'Summary must omit nested .token-summary-metrics wrapper so Chart toggle stays inline');

  // Verify exact order: Cost -> Latest Ctx -> Total Input -> Total Cache -> Total Output -> Peak Ctx -> Cache Hit -> Chart toggle
  const summarySection = hydroBanner.slice(hydroBanner.indexOf('<summary'), hydroBanner.indexOf('</summary>'));
  const costPos = summarySection.indexOf('💰');
  const latestPos = summarySection.indexOf('⚡');
  const inPos = summarySection.indexOf('📥');
  const cachePos = summarySection.indexOf('💾');
  const outPos = summarySection.indexOf('📤');
  const peakPos = summarySection.indexOf('🏔️');
  const hitPos = summarySection.indexOf('♻️');
  const chartPos = summarySection.indexOf('token-drawer-toggle-hint');
  assert(
    costPos !== -1 && costPos < latestPos && latestPos < inPos && inPos < cachePos && cachePos < outPos && outPos < peakPos && peakPos < hitPos && hitPos < chartPos,
    'Token metrics must follow exact order: Cost -> Latest Ctx -> Total Input -> Total Cache -> Total Output -> Peak Ctx -> Cache Hit -> Chart toggle'
  );

  // Argon at 260k -> Normal (<285k)
  const argonUsage = {
    ...baseUsage,
    latestContextTokens: 260000,
    peakContextTokens: 260000,
    primaryModel: 'gemini-4-argon',
    stepMetrics: [{ ...baseUsage.stepMetrics[0], totalContextTokens: 260000, model: 'gemini-4-argon' }]
  };
  const argonBanner = TokenUsageMonitor.renderReaderTokenBannerHtml(argonUsage);
  assert(argonBanner.includes('token-severity-normal'), 'Argon at 260k must be normal (<285k)');
  assert(argonBanner.includes('🟢</span>'), 'Argon at 260k must display 🟢 status dot');

  const argonStatusBar = TokenUsageMonitor.formatStatusBarState(argonUsage, { id: 's1', title: 'Argon Test' });
  assert.strictEqual(argonStatusBar.severity, 'normal', 'Status bar must also respect Argon 285k threshold');

  const argonBadge = TokenUsageMonitor.renderSessionTokenBadgeHtml(argonUsage);
  assert(argonBadge.includes('token-ok'), 'Sidebar badge must also respect Argon 285k threshold');
  console.log('✓ 5.1: Per-model thresholds & compact icon-only token strip verified');
}

(async () => {
  try {
    await runPhase1Tests();
    await runPhase2Tests();
    await runPhase3Tests();
    await runPhase4EnhancementTests();
    await runPhase5PerModelThresholdAndCompactBannerTests();
  } catch (err) {
    console.error('Test failed:', err);
    process.exit(1);
  }
})();
