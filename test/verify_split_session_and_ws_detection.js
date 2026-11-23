const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const Module = require('module');

// Stub 'vscode' module so we can load compiled out/services/SessionScanner directly in Node
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    return {
      workspace: {
        getConfiguration: () => ({
          get: (key, defaultVal) => defaultVal
        }),
        workspaceFolders: []
      },
      Uri: {
        file: (p) => ({ fsPath: p, toString: () => `file://${p}` })
      }
    };
  }
  return originalLoad.apply(this, arguments);
};

const { SessionScanner } = require('../out/services/SessionScanner');

async function runTests() {
  console.log('Running Split-Session Merging, Live Update, Watcher & Antigravity 2.0 Workspace Detection Tests...\n');

  const tmpRoot = path.join(os.tmpdir(), 'brain_hub_split_test_' + Date.now());
  const dirIde = path.join(tmpRoot, 'antigravity-ide', 'brain');
  const dirAgy2 = path.join(tmpRoot, 'antigravity', 'brain');
  const storageDir = path.join(tmpRoot, 'storage');
  fs.mkdirSync(dirIde, { recursive: true });
  fs.mkdirSync(dirAgy2, { recursive: true });
  fs.mkdirSync(storageDir, { recursive: true });

  try {
    const scanner = SessionScanner.getInstance();
    scanner.setStoragePath(storageDir);
    scanner.getAllTargetDirectories = () => [dirIde, dirAgy2];

    // =========================================================================
    // 1. FR-1 (AC-1.1, AC-1.2, AC-1.3): Split-Session Merging across 2 brain dirs
    // =========================================================================
    const splitId = '48583726-df49-4845-b712-93258cbbb51e';
    const ideSessionDir = path.join(dirIde, splitId);
    const agy2SessionDir = path.join(dirAgy2, splitId);
    fs.mkdirSync(path.join(ideSessionDir, '.system_generated', 'logs'), { recursive: true });
    fs.mkdirSync(path.join(agy2SessionDir, '.system_generated', 'logs'), { recursive: true });

    // Older fragment in antigravity-ide/brain (Steps 0..2, Aug 2026)
    const ideLines = [
      JSON.stringify({
        step_index: 0,
        source: 'USER_EXPLICIT',
        type: 'USER_INPUT',
        created_at: '2026-08-12T10:00:00.000Z',
        content: '<USER_REQUEST>Phân tích dữ liệu Facebook Group Insights tháng 8</USER_REQUEST>'
      }),
      JSON.stringify({
        step_index: 1,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        created_at: '2026-08-12T10:01:00.000Z',
        content: 'Dưới đây là báo cáo phân tích chi tiết.'
      }),
      JSON.stringify({
        step_index: 2,
        source: 'USER_EXPLICIT',
        type: 'USER_INPUT',
        created_at: '2026-08-12T10:05:00.000Z',
        content: '<USER_REQUEST>Xuất bảng tổng hợp</USER_REQUEST>'
      })
    ];
    fs.writeFileSync(path.join(ideSessionDir, '.system_generated', 'logs', 'transcript.jsonl'), ideLines.join('\n') + '\n', 'utf8');
    fs.writeFileSync(path.join(ideSessionDir, 'implementation_plan.md'), '# Plan from IDE', 'utf8');

    // Newer fragment in antigravity/brain (Overlapping Step 2 + Steps 3..4, Nov 2026)
    const agy2Lines = [
      JSON.stringify({
        step_index: 2,
        source: 'USER_EXPLICIT',
        type: 'USER_INPUT',
        created_at: '2026-08-12T10:05:00.000Z',
        content: '<USER_REQUEST>Xuất bảng tổng hợp đầy đủ</USER_REQUEST>'
      }),
      JSON.stringify({
        step_index: 3,
        source: 'USER_EXPLICIT',
        type: 'USER_INPUT',
        created_at: '2026-11-06T14:00:00.000Z',
        content: '<USER_REQUEST>từ conversation này, hãy tạo 1 file skill để tái sử dụng cho lần phân tích tiếp theo</USER_REQUEST>'
      }),
      JSON.stringify({
        step_index: 4,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        created_at: '2026-11-06T14:02:00.000Z',
        content: 'Đã tạo file SKILL.md cho facebook-group-insights.',
        tool_calls: [
          {
            name: 'write_file',
            args: {
              Path: 'd:\\chiriforge\\brain-hub-antigravity\\skills\\facebook-group-insights\\SKILL.md'
            }
          }
        ]
      })
    ];
    fs.writeFileSync(path.join(agy2SessionDir, '.system_generated', 'logs', 'transcript.jsonl'), agy2Lines.join('\n') + '\n', 'utf8');
    fs.writeFileSync(path.join(agy2SessionDir, 'walkthrough.md'), '# Walkthrough from AGY 2.0', 'utf8');

    const scannedSessions = await scanner.scanSessions(true);
    const splitMeta = scannedSessions.find((s) => s.id === splitId);
    assert(splitMeta, 'Split session must be discovered by scanSessions');
    assert.strictEqual(
      splitMeta.firstPrompt,
      'Phân tích dữ liệu Facebook Group Insights tháng 8',
      'AC-1.2: firstPrompt must be preserved from earliest fragment (step 0)'
    );
    assert.strictEqual(
      splitMeta.lastModified.toISOString(),
      '2026-11-06T14:02:00.000Z',
      'AC-1.2: lastModified must equal newest fragment timestamp'
    );
    assert.strictEqual(
      splitMeta.userPromptCount,
      3,
      'AC-1.2: userPromptCount must reflect deduplicated user prompts across both fragments (steps 0, 2, 3)'
    );
    assert(
      splitMeta.artifacts && splitMeta.artifacts.length === 2,
      `AC-1.2: artifacts must merge implementation_plan.md and walkthrough.md (got ${splitMeta.artifacts ? splitMeta.artifacts.length : 0})`
    );
    assert(splitMeta.planPath && splitMeta.planPath.endsWith('implementation_plan.md'), 'planPath from older fragment must be preserved');
    assert(splitMeta.walkthroughPath && splitMeta.walkthroughPath.endsWith('walkthrough.md'), 'walkthroughPath from newer fragment must be preserved');
    assert.strictEqual(
      splitMeta.workspaceName,
      'brain-hub-antigravity',
      'AC-4.1: workspaceName must be extracted from Antigravity 2.0 args.Path'
    );

    const fullLoaded = await scanner.loadFullSession(splitId);
    assert(fullLoaded, 'AC-1.1: loadFullSession must return merged session');
    assert.strictEqual(
      fullLoaded.messages.length,
      5,
      `AC-1.1 & AC-1.3: loadFullSession must merge steps 0..4 and deduplicate step 2 (got ${fullLoaded.messages.length})`
    );
    assert.deepStrictEqual(
      fullLoaded.messages.map((m) => m.index),
      [0, 1, 2, 3, 4],
      'AC-1.1: Merged messages must be sorted strictly by step_index 0..4'
    );
    assert(
      fullLoaded.messages[2].cleanContent.includes('Xuất bảng tổng hợp đầy đủ'),
      'AC-1.3: Overlapping step_index 2 must prefer fuller content'
    );
    assert(
      fullLoaded.messages[3].cleanContent.includes('từ conversation này, hãy tạo 1 file skill'),
      'AC-1.1: Step 3 from second brain directory must be present in loaded messages'
    );
    assert.strictEqual(
      fullLoaded.session.lastModified.toISOString(),
      '2026-11-06T14:02:00.000Z',
      'AC-1.1: loadFullSession must NOT revert lastModified to older directory timestamp'
    );

    const cachedAfterLoad = scanner.getCachedSessions().find((s) => s.id === splitId);
    assert(cachedAfterLoad, 'Split session must remain in cache after loadFullSession');
    assert.strictEqual(
      cachedAfterLoad.lastModified.toISOString(),
      '2026-11-06T14:02:00.000Z',
      'AC-1.1: Cached session lastModified must stay at newest timestamp after loadFullSession'
    );
    console.log('✓ FR-1 (AC-1.1, AC-1.2, AC-1.3): Multi-directory split-session merging verified!');

    // =========================================================================
    // 2. FR-4 (AC-4.1, AC-4.2, AC-4.3): Antigravity 2.0 Workspace Detection & Cache Self-Healing
    // =========================================================================
    assert.strictEqual(
      scanner.isValidWorkspacePath('/checkout/git/ref/tags/v7'),
      false,
      'AC-4.1: /checkout/git/ref/tags/v7 must be rejected by isValidWorkspacePath'
    );
    assert.strictEqual(
      scanner.isValidWorkspacePath('/my-workspace'),
      false,
      'AC-4.2: /my-workspace must be rejected by isValidWorkspacePath'
    );
    assert.strictEqual(
      scanner.isValidWorkspacePath('d:\\chiriforge\\gx-steady-flow'),
      true,
      'Valid Windows workspace path must be accepted'
    );

    // Simulate session e80f0337-c647-47cb-8864-b95e3a920a39 with GitHub Actions /checkout/git/ref/tags/v7 log & args.Path
    const sessV7Id = 'e80f0337-c647-47cb-8864-b95e3a920a39';
    const sessV7Dir = path.join(dirAgy2, sessV7Id);
    fs.mkdirSync(path.join(sessV7Dir, '.system_generated', 'logs'), { recursive: true });
    const v7Lines = [
      JSON.stringify({
        step_index: 0,
        source: 'USER_EXPLICIT',
        type: 'USER_INPUT',
        created_at: '2026-11-05T10:00:00.000Z',
        content: '<USER_REQUEST>Check CI workflow logs</USER_REQUEST>'
      }),
      JSON.stringify({
        step_index: 1,
        source: 'SYSTEM',
        type: 'RUN_COMMAND',
        created_at: '2026-11-05T10:01:00.000Z',
        content: 'remote: /checkout/git/ref/tags/v7 -> 08eba0b27e820071\n commenting on /my-workspace -> project-repo'
      }),
      JSON.stringify({
        step_index: 2,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        created_at: '2026-11-05T10:02:00.000Z',
        content: 'Inspecting repository files.',
        tool_calls: [
          {
            name: 'read_file',
            args: {
              Path: 'd:\\chiriforge\\gx-steady-flow\\src\\main.ts'
            }
          }
        ]
      }),
      // Malformed line trap (Negative / Boundary test)
      '{ "step_index": 999, CORRUPTED_JSON_LINE '
    ];
    const v7TranscriptFile = path.join(sessV7Dir, '.system_generated', 'logs', 'transcript.jsonl');
    fs.writeFileSync(v7TranscriptFile, v7Lines.join('\n') + '\n', 'utf8');

    const parsedV7 = await scanner.parseTranscriptFileAsync(v7TranscriptFile, sessV7Id, true);
    assert(
      parsedV7.detectedWorkspace && parsedV7.detectedWorkspace.toLowerCase().includes('gx-steady-flow'),
      `AC-4.1 & AC-4.2: detectedWorkspace should be gx-steady-flow, got ${parsedV7.detectedWorkspace}`
    );

    // AC-4.3: Poisoned cache entry self-healing test
    const v7Stat = fs.statSync(v7TranscriptFile);
    const dirStat = fs.statSync(sessV7Dir);
    scanner.sessionCache.set(`${sessV7Id}_${sessV7Dir}`, {
      session: {
        id: sessV7Id,
        path: sessV7Dir,
        title: 'Check CI workflow logs',
        firstPrompt: 'Check CI workflow logs',
        searchKeywords: 'Check CI',
        lastModified: new Date('2026-11-05T10:02:00.000Z'),
        createdAt: new Date('2026-11-05T10:00:00.000Z'),
        messageCount: 1,
        userPromptCount: 1,
        workspaceName: 'v7',
        workspacePath: '/checkout/git/ref/tags/v7',
        hasArtifacts: false
      },
      mtime: dirStat.mtimeMs,
      fileMtime: v7Stat.mtimeMs,
      fileSize: v7Stat.size,
      targetFilePath: v7TranscriptFile,
      schemaVersion: 2
    });

    const healedSessions = await scanner.scanSessions(false);
    const healedV7 = healedSessions.find((s) => s.id === sessV7Id);
    assert(healedV7, 'Session e80f0337 must be returned after scanSessions(false)');
    assert.strictEqual(
      healedV7.workspaceName,
      'gx-steady-flow',
      `AC-4.3: Poisoned cache workspaceName 'v7' must self-heal to 'gx-steady-flow' (got ${healedV7.workspaceName})`
    );
    console.log('✓ FR-4 (AC-4.1, AC-4.2, AC-4.3): Antigravity 2.0 args.Path workspace detection & cache self-healing verified!');

    // =========================================================================
    // 3. FR-3 (AC-3.1, AC-3.2): Watcher Noise Filter & Boundary Traps
    // =========================================================================
    assert.strictEqual(
      scanner.isRelevantWatchEvent('.sessions_index_cache.json'),
      false,
      'AC-3.2: .sessions_index_cache.json must be ignored by watcher'
    );
    assert.strictEqual(
      scanner.isRelevantWatchEvent('.sessions_index_cache.json.1234.tmp'),
      false,
      'AC-3.2: temporary atomic write files must be ignored by watcher'
    );
    assert.strictEqual(
      scanner.isRelevantWatchEvent(`${splitId}\\.system_generated\\logs\\transcript.jsonl`),
      true,
      'AC-3.1: Nested transcript.jsonl change on Windows NTFS must pass watcher filter'
    );
    assert.strictEqual(
      scanner.isRelevantWatchEvent(`${splitId}\\tempmediaStorage\\preview.png`),
      false,
      'tempmediaStorage files must be ignored by watcher'
    );

    // 0-byte transcript resilience test
    const emptySessId = '00000000-0000-4000-8000-000000000000';
    const emptySessDir = path.join(dirAgy2, emptySessId);
    fs.mkdirSync(path.join(emptySessDir, '.system_generated', 'logs'), { recursive: true });
    const emptyTranscript = path.join(emptySessDir, '.system_generated', 'logs', 'transcript.jsonl');
    fs.writeFileSync(emptyTranscript, '', 'utf8');
    const parsedEmpty = await scanner.parseTranscriptFileAsync(emptyTranscript, emptySessId, false);
    assert.strictEqual(parsedEmpty.messages.length, 0, '0-byte transcript must return 0 messages cleanly');
    assert.strictEqual(parsedEmpty.userPromptCount, 0, '0-byte transcript must return 0 userPromptCount');

    // =========================================================================
    // 4. FR-2 & FR-3 Static & Behavioral Contract Verification
    // =========================================================================
    const scannerSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'SessionScanner.ts'), 'utf8');
    const dashSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'DashboardWebviewPanel.ts'), 'utf8');
    const extSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'extension.ts'), 'utf8');

    assert(
      scannerSrc.includes('recursive: true'),
      'AC-3.1: SessionScanner.startRealtimeWatcher must enable { recursive: true }'
    );
    assert(
      scannerSrc.includes('.sessions_index_cache.json'),
      'AC-3.2: SessionScanner watcher must ignore .sessions_index_cache.json self-writes'
    );
    assert(
      extSrc.includes('DashboardWebviewPanel.currentPanel.updateContent(true)'),
      'AC-2.2: brainHub.refresh in extension.ts must call updateContent(true)'
    );
    assert(
      dashSrc.includes('private isDisposed: boolean = false'),
      'AC-2.3: DashboardWebviewPanel must track isDisposed to prevent Webview is disposed errors'
    );
    assert(
      dashSrc.includes('if (isSearching || hasActiveSelection)'),
      'AC-2.1: DashboardWebviewPanel must only defer live updates during active search or text selection'
    );
    console.log('✓ FR-2 & FR-3: Recursive watcher, manual refresh force-update & webview disposal guards verified!');

    console.log('\nALL SPLIT-SESSION, LIVE UPDATE, WATCHER & WORKSPACE DETECTION TESTS PASSED (100%)!\n');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
