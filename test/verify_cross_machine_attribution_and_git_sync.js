const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');

// Mock vscode before importing services
const Module = require('module');
const origRequire = Module.prototype.require;

const mockConfigStore = {
  'brainHub.brainPath': '',
  'brainHub.additionalBrainPaths': [],
  'brainHub.machineName': '',
  'brainHub.hideEmptySessions': true,
  'brainHub.sessionSortBy': 'lastModified',
  'brainHub.enableTokenStatusBar': true
};

const vscodeMock = {
  workspace: {
    getConfiguration: (section) => ({
      get: (key, def) => {
        const fullKey = `${section}.${key}`;
        return Object.prototype.hasOwnProperty.call(mockConfigStore, fullKey)
          ? mockConfigStore[fullKey]
          : def;
      },
      inspect: (key) => {
        const fullKey = `${section}.${key}`;
        if (Object.prototype.hasOwnProperty.call(mockConfigStore, fullKey)) {
          return { globalValue: mockConfigStore[fullKey] };
        }
        return undefined;
      },
      update: async (key, val) => {
        mockConfigStore[`${section}.${key}`] = val;
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
    file: (p) => ({ fsPath: p, toString: () => `file://${p}` }),
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
      this._listeners = [];
      this.event = (fn) => {
        this._listeners.push(fn);
        return { dispose: () => {} };
      };
    }
    fire(val) {
      for (const l of this._listeners) {
        l(val);
      }
    }
  },
  ThemeIcon: class ThemeIcon { constructor(id) { this.id = id; } },
  ThemeColor: class ThemeColor { constructor(id) { this.id = id; } },
  ProgressLocation: { Notification: 15 },
  commands: { registerCommand: () => ({ dispose: () => {} }), executeCommand: () => {} },
  window: {
    showInformationMessage: async () => undefined,
    showWarningMessage: async () => undefined,
    showErrorMessage: async () => undefined,
    showInputBox: async () => undefined,
    withProgress: async (_opts, task) => task({ report: () => {} }),
    createStatusBarItem: () => ({ show: () => {}, hide: () => {}, dispose: () => {} }),
    createTreeView: () => ({ onDidChangeVisibility: () => ({ dispose: () => {} }), dispose: () => {} })
  }
};

Module.prototype.require = function (request) {
  if (request === 'vscode') {
    return vscodeMock;
  }
  return origRequire.apply(this, arguments);
};

const { SessionScanner } = require('../out/services/SessionScanner');
const { GitSyncService } = require('../out/services/GitSyncService');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runGit(args, cwd) {
  const res = cp.spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (res.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed (${res.status}): ${res.stderr || res.stdout}`);
  }
  return (res.stdout || '').trim();
}

function writeTranscript(sessionDir, steps) {
  const logsDir = path.join(sessionDir, '.system_generated', 'logs');
  fs.mkdirSync(logsDir, { recursive: true });
  const lines = steps.map((s) => JSON.stringify(s)).join('\n') + '\n';
  fs.writeFileSync(path.join(logsDir, 'transcript.jsonl'), lines, 'utf8');
}

async function runTests() {
  const tmpRoot = makeTempDir('bh_attr_git_');
  const storageDir = path.join(tmpRoot, 'globalStorage');
  const brainDir = path.join(tmpRoot, 'brain');
  fs.mkdirSync(storageDir, { recursive: true });
  fs.mkdirSync(brainDir, { recursive: true });

  const scanner = SessionScanner.getInstance();
  const gitSync = GitSyncService.getInstance();
  scanner.setStoragePath(storageDir);

  const origBrainPath = mockConfigStore['brainHub.brainPath'];
  const origAdditional = mockConfigStore['brainHub.additionalBrainPaths'];
  const origMachine = mockConfigStore['brainHub.machineName'];

  try {
    mockConfigStore['brainHub.brainPath'] = brainDir;
    mockConfigStore['brainHub.additionalBrainPaths'] = [];
    mockConfigStore['brainHub.machineName'] = 'VUI-22-36413D';

    // =========================================================================
    // AC-1: Non-Overwriting Origin Metadata Persistence (.brainhub_meta.json)
    // =========================================================================
    console.log('Testing AC-1: .brainhub_meta.json read priority, non-overwrite & atomic write...');
    assert.strictEqual(typeof scanner.readSessionOriginMeta, 'function', 'readSessionOriginMeta must exist');
    assert.strictEqual(typeof scanner.writeSessionOriginMetaIfMissing, 'function', 'writeSessionOriginMetaIfMissing must exist');

    const sessMetaId = '11111111-1111-4111-8111-111111111111';
    const sessMetaDir = path.join(brainDir, sessMetaId);
    writeTranscript(sessMetaDir, [
      {
        step_index: 0,
        source: 'USER_EXPLICIT',
        type: 'USER_INPUT',
        created_at: '2026-11-23T01:00:00.000Z',
        content: '<USER_REQUEST>\nHello from remote\n</USER_REQUEST>'
      }
    ]);
    const metaPath = path.join(sessMetaDir, '.brainhub_meta.json');
    const originalMeta = {
      schemaVersion: 1,
      machineName: 'hunglepc',
      osUser: 'hungl',
      platform: 'win32',
      recordedAt: '2026-11-20T10:00:00.000Z'
    };
    fs.writeFileSync(metaPath, JSON.stringify(originalMeta, null, 2), 'utf8');

    const scannedAc1 = await scanner.scanSessions(true, true);
    const foundAc1 = scannedAc1.find((s) => s.id === sessMetaId);
    assert(foundAc1, 'AC-1 session should be scanned');
    assert.strictEqual(foundAc1.machineName, 'hunglepc', 'AC-1: machineName must resolve from .brainhub_meta.json');

    // Attempt writeSessionOriginMetaIfMissing must NOT overwrite existing valid meta
    const didOverwrite = scanner.writeSessionOriginMetaIfMissing(sessMetaDir, 'VUI-22-36413D');
    assert.strictEqual(didOverwrite, false, 'AC-1: writeSessionOriginMetaIfMissing must not overwrite existing valid meta');
    const afterMeta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    assert.strictEqual(afterMeta.machineName, 'hunglepc', 'AC-1: .brainhub_meta.json must remain unmodified');

    // Concurrent atomic writes on a brand-new dir
    const concurrentDir = path.join(tmpRoot, 'concurrent_meta');
    fs.mkdirSync(concurrentDir, { recursive: true });
    await Promise.all([
      Promise.resolve().then(() => scanner.writeSessionOriginMetaIfMissing(concurrentDir, 'Host-A')),
      new Promise((resolve) => setTimeout(() => resolve(scanner.writeSessionOriginMetaIfMissing(concurrentDir, 'Host-B')), 5))
    ]);
    const concFiles = fs.readdirSync(concurrentDir);
    assert(concFiles.includes('.brainhub_meta.json'), 'AC-1: concurrent write must produce .brainhub_meta.json');
    assert.strictEqual(concFiles.filter((f) => f.endsWith('.tmp')).length, 0, 'AC-1: zero leftover .tmp files');
    console.log('✓ AC-1 passed');

    // =========================================================================
    // AC-2: Pre-Sync Stamping & Cross-Window Anti-Poisoning Guard
    // =========================================================================
    console.log('Testing AC-2: Pre-sync dirty stamping & cross-window anti-poisoning...');
    assert.strictEqual(typeof gitSync.isPullSuppressionActive, 'function', 'isPullSuppressionActive must exist');
    assert.strictEqual(typeof gitSync.stampPendingSessionsBeforeSync, 'function', 'stampPendingSessionsBeforeSync must exist');
    assert.strictEqual(scanner.isRelevantWatchEvent(`${sessMetaId}/.brainhub_meta.json`), false, 'AC-2: .brainhub_meta.json must be ignored by isRelevantWatchEvent');
    assert.strictEqual(scanner.isRelevantWatchEvent('.brainhub_meta.json'), false, 'AC-2: root .brainhub_meta.json must be ignored');

    // Setup real bare remote + local repo
    const remoteBare = path.join(tmpRoot, 'remote.git');
    const repoDir = path.join(tmpRoot, 'git_brain');
    fs.mkdirSync(remoteBare, { recursive: true });
    runGit(['init', '--bare', '-b', 'main'], remoteBare);
    fs.mkdirSync(repoDir, { recursive: true });
    runGit(['init', '-b', 'main'], repoDir);
    runGit(['config', 'user.email', 'test@example.com'], repoDir);
    runGit(['config', 'user.name', 'Test User'], repoDir);
    runGit(['remote', 'add', 'origin', remoteBare], repoDir);

    const remoteCleanId = '22222222-2222-4222-8222-222222222222';
    const remoteCleanDir = path.join(repoDir, remoteCleanId);
    writeTranscript(remoteCleanDir, [
      { step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', created_at: '2026-11-22T01:00:00.000Z', content: '<USER_REQUEST>\nRemote historical\n</USER_REQUEST>' }
    ]);
    runGit(['add', '.'], repoDir);
    runGit(['commit', '-m', 'seed remote clean session'], repoDir);
    runGit(['push', '-u', 'origin', 'main'], repoDir);

    // Local dirty untracked session + line-1 modified tracked session
    const localDirtyUntrackedId = '33333333-3333-4333-8333-333333333333';
    const localDirtyUntrackedDir = path.join(repoDir, localDirtyUntrackedId);
    writeTranscript(localDirtyUntrackedDir, [
      { step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', created_at: '2026-11-23T02:00:00.000Z', content: '<USER_REQUEST>\nLocal dirty untracked\n</USER_REQUEST>' }
    ]);

    // Also test a tracked modified session appearing on line 1 with leading space " M "
    const trackedModId = '44444444-4444-4444-8444-444444444444';
    const trackedModDir = path.join(repoDir, trackedModId);
    writeTranscript(trackedModDir, [
      { step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', created_at: '2026-11-22T05:00:00.000Z', content: '<USER_REQUEST>\nTracked before mod\n</USER_REQUEST>' }
    ]);
    runGit(['add', trackedModId], repoDir);
    runGit(['commit', '-m', 'add trackedMod'], repoDir);
    // Modify trackedModId so it is line 1 " M " in porcelain output (temporarily remove untracked so line 1 is trackedModId)
    fs.rmSync(localDirtyUntrackedDir, { recursive: true, force: true });
    writeTranscript(trackedModDir, [
      { step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', created_at: '2026-11-22T05:00:00.000Z', content: '<USER_REQUEST>\nTracked before mod\n</USER_REQUEST>' },
      { step_index: 1, source: 'MODEL', type: 'PLANNER_RESPONSE', created_at: '2026-11-23T02:05:00.000Z', content: 'Updated locally' }
    ]);

    // Also create a foreign-OS untracked session that should NOT be stamped with local hostname
    const foreignUntrackedId = '55555555-5555-4555-8555-555555555555';
    writeTranscript(path.join(repoDir, foreignUntrackedId), [
      { step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', created_at: '2026-11-21T01:00:00.000Z', content: '<user_information>\nApp Data Directory: /Users/alice/.gemini/antigravity\n</user_information>\n<USER_REQUEST>\nCopied from Mac\n</USER_REQUEST>' }
    ]);

    mockConfigStore['brainHub.brainPath'] = repoDir;
    await gitSync.stampPendingSessionsBeforeSync();

    // Restore untracked local session and run again
    writeTranscript(localDirtyUntrackedDir, [
      { step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', created_at: '2026-11-23T02:00:00.000Z', content: '<USER_REQUEST>\nLocal dirty untracked\n</USER_REQUEST>' }
    ]);
    await gitSync.stampPendingSessionsBeforeSync();

    assert.strictEqual(fs.existsSync(path.join(trackedModDir, '.brainhub_meta.json')), true, 'AC-2: line-1 modified tracked session must be stamped');
    assert.strictEqual(fs.existsSync(path.join(localDirtyUntrackedDir, '.brainhub_meta.json')), true, 'AC-2: local untracked session must be stamped');
    assert.strictEqual(fs.existsSync(path.join(remoteCleanDir, '.brainhub_meta.json')), false, 'AC-2: clean historical session MUST NOT be stamped');
    assert.strictEqual(fs.existsSync(path.join(repoDir, foreignUntrackedId, '.brainhub_meta.json')), false, 'AC-2: foreign-OS untracked session MUST NOT be stamped with local hostname');

    // Cross-window sync state suppression check
    const syncStateFile = path.join(repoDir, '.git', 'antigravity_sync_state.json');
    fs.writeFileSync(syncStateFile, JSON.stringify({
      lastSyncTimestamp: Date.now(),
      lastSyncTimeStr: 'now',
      inProgress: false,
      lockExpiresAt: 0,
      syncedByPid: process.pid
    }), 'utf8');
    assert.strictEqual(gitSync.isPullSuppressionActive(), true, 'AC-2: isPullSuppressionActive must be true within 5000ms of another window sync');
    fs.writeFileSync(syncStateFile, JSON.stringify({
      lastSyncTimestamp: Date.now() - 10000,
      lastSyncTimeStr: 'old',
      inProgress: false,
      lockExpiresAt: 0,
      syncedByPid: process.pid
    }), 'utf8');
    assert.strictEqual(gitSync.isPullSuppressionActive(), false, 'AC-2: isPullSuppressionActive must be false after 5000ms grace window');
    console.log('✓ AC-2 passed');

    // =========================================================================
    // AC-3: Cross-Platform Path, Cross-OS Same-User & Cross-User Attribution
    // =========================================================================
    console.log('Testing AC-3: Windows/POSIX App Data & Workspace cross-OS attribution...');
    mockConfigStore['brainHub.brainPath'] = brainDir;
    const localUser = os.userInfo().username || 'minhh';
    const isWin = process.platform === 'win32';
    const crossOsExpected = isWin ? `${localUser}-Mac` : `${localUser}-Windows`;
    const crossOsContent = isWin
      ? `App Data Directory: /Users/${localUser}/.gemini/antigravity`
      : `App Data Directory: C:\\Users\\${localUser}\\.gemini\\antigravity`;
    const crossOsWs = isWin ? `/Users/${localUser}/projects/demo` : `C:\\Users\\${localUser}\\projects\\demo`;

    assert.strictEqual(scanner.extractMachineFromContent('App Data Directory: /Users/alice/.gemini/antigravity'), 'alice-PC');
    assert.strictEqual(scanner.extractMachineFromContent('App Data Directory: /home/bob/.gemini/antigravity'), 'bob-PC');
    assert.strictEqual(scanner.extractMachineFromContent('App Data Directory: D:\\Users\\charlie\\.gemini\\antigravity'), 'charlie-PC');
    assert.strictEqual(scanner.extractMachineFromContent(crossOsContent), crossOsExpected, 'AC-3: cross-OS same-username must not collapse to local hostname');
    assert.strictEqual(typeof scanner.extractMachineFromWorkspacePath, 'function', 'extractMachineFromWorkspacePath must exist');
    assert.strictEqual(scanner.extractMachineFromWorkspacePath(crossOsWs), crossOsExpected, 'AC-3: workspacePath cross-OS same-username must attribute to other OS');
    assert.strictEqual(scanner.extractMachineFromWorkspacePath('/home/bob/work/repo'), 'bob-PC');
    console.log('✓ AC-3 passed');

    // =========================================================================
    // AC-4: Artifact & Empty-Session Exclusion Without Breaking Dot-Directories
    // =========================================================================
    console.log('Testing AC-4: .brainhub_meta.json exclusion & dot-directory preservation...');
    const metaOnlyId = '66666666-6666-4666-8666-666666666666';
    const metaOnlyDir = path.join(brainDir, metaOnlyId);
    fs.mkdirSync(metaOnlyDir, { recursive: true });
    fs.writeFileSync(path.join(metaOnlyDir, '.brainhub_meta.json'), JSON.stringify(originalMeta), 'utf8');

    assert.strictEqual(scanner.hasAnyArtifacts(metaOnlyDir), false, 'AC-4: .brainhub_meta.json alone must not count as artifact');
    assert.strictEqual(scanner.scanSessionArtifacts(metaOnlyDir).length, 0, 'AC-4: .brainhub_meta.json must not appear in artifacts');

    const userUploadDir = path.join(brainDir, '77777777-7777-4777-8777-777777777777');
    fs.mkdirSync(path.join(userUploadDir, '.user_uploaded'), { recursive: true });
    fs.writeFileSync(path.join(userUploadDir, '.user_uploaded', 'photo.png'), 'png', 'utf8');
    assert.strictEqual(scanner.hasAnyArtifacts(userUploadDir), true, 'AC-4: .user_uploaded must still return hasAnyArtifacts === true');

    const tempMediaDir = path.join(brainDir, '88888888-8888-4888-8888-888888888888');
    fs.mkdirSync(path.join(tempMediaDir, '.tempmediaStorage'), { recursive: true });
    fs.writeFileSync(path.join(tempMediaDir, '.tempmediaStorage', 'img.png'), 'png', 'utf8');
    assert.strictEqual(scanner.hasAnyArtifacts(tempMediaDir), true, 'AC-4: .tempmediaStorage must still return hasAnyArtifacts === true');

    const swarmCoordDir = path.join(brainDir, '99999999-9999-4999-8999-999999999999');
    fs.mkdirSync(path.join(swarmCoordDir, '.system_generated', 'swarm'), { recursive: true });
    fs.writeFileSync(path.join(swarmCoordDir, '.system_generated', 'swarm', 'members.json'), '{"members":{}}', 'utf8');
    const emptyDirs = await scanner.findEmptySessionDirs();
    assert(!emptyDirs.some((d) => d.id === '99999999-9999-4999-8999-999999999999'), 'AC-4: swarm coordinator must not be marked deletable by findEmptySessionDirs');
    console.log('✓ AC-4 passed');

    // =========================================================================
    // AC-5: Cache Schema & auxSignature Invalidation + No Legacy Dir Creation
    // =========================================================================
    console.log('Testing AC-5: CACHE_SCHEMA_VERSION === 6, auxSignature invalidation & saveCacheToDisk guard...');
    assert.strictEqual(SessionScanner.CACHE_SCHEMA_VERSION, 6, 'AC-5: CACHE_SCHEMA_VERSION must be 6');

    const auxSessId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const auxSessDir = path.join(brainDir, auxSessId);
    writeTranscript(auxSessDir, [
      { step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', created_at: '2026-11-23T03:00:00.000Z', content: '<USER_REQUEST>\nAux check\n</USER_REQUEST>' }
    ]);
    let sessions = await scanner.scanSessions(true, true);
    let auxSession = sessions.find((s) => s.id === auxSessId);
    assert(auxSession, 'AC-5: aux session found');
    assert.strictEqual(auxSession.machineName, 'VUI-22-36413D');

    // Now write .brainhub_meta.json WITHOUT touching transcript.jsonl
    fs.writeFileSync(path.join(auxSessDir, '.brainhub_meta.json'), JSON.stringify({
      schemaVersion: 1,
      machineName: 'MacBook-Pro',
      recordedAt: '2026-11-23T03:05:00.000Z'
    }), 'utf8');
    sessions = await scanner.scanSessions(false, true);
    auxSession = sessions.find((s) => s.id === auxSessId);
    assert.strictEqual(auxSession.machineName, 'MacBook-Pro', 'AC-5: auxSignature change must invalidate cache without transcript mtime change');
    console.log('✓ AC-5 passed');

    // =========================================================================
    // AC-6: Git-Aware Brain Dir, Modern Default, Dynamic Branch & Post-Sync Wiring
    // =========================================================================
    console.log('Testing AC-6: Git-aware brain dir, dynamic branch & unborn repo remote probing...');
    assert.strictEqual(typeof gitSync.resolveActiveBranch, 'function', 'resolveActiveBranch must exist');

    // Test dynamic master branch sync
    const masterRemote = path.join(tmpRoot, 'master_remote.git');
    const masterLocal = path.join(tmpRoot, 'master_local');
    fs.mkdirSync(masterRemote, { recursive: true });
    runGit(['init', '--bare', '-b', 'master'], masterRemote);
    fs.mkdirSync(masterLocal, { recursive: true });
    runGit(['init', '-b', 'master'], masterLocal);
    runGit(['config', 'user.email', 'test@example.com'], masterLocal);
    runGit(['config', 'user.name', 'Test User'], masterLocal);
    runGit(['remote', 'add', 'origin', masterRemote], masterLocal);
    fs.writeFileSync(path.join(masterLocal, 'README.md'), 'init\n', 'utf8');
    runGit(['add', '.'], masterLocal);
    runGit(['commit', '-m', 'init master'], masterLocal);
    runGit(['push', '-u', 'origin', 'master'], masterLocal);

    mockConfigStore['brainHub.brainPath'] = masterLocal;
    const resolvedMaster = await gitSync.resolveActiveBranch();
    assert.strictEqual(resolvedMaster, 'master', 'AC-6: resolveActiveBranch must detect master');

    const masterSessDir = path.join(masterLocal, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    writeTranscript(masterSessDir, [
      { step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', created_at: '2026-11-23T04:00:00.000Z', content: '<USER_REQUEST>\nMaster branch session\n</USER_REQUEST>' }
    ]);
    const syncOk = await gitSync.syncSilently(0);
    assert.strictEqual(syncOk, true, 'AC-6: syncSilently must succeed on master branch');
    assert(fs.existsSync(path.join(masterSessDir, '.brainhub_meta.json')), 'AC-6: syncSilently must stamp local session before add/commit/push');

    // Test unborn repo connecting to remote whose default branch is 'master'
    const unbornLocal = path.join(tmpRoot, 'unborn_local');
    mockConfigStore['brainHub.brainPath'] = unbornLocal;
    const setupOk = await gitSync.setupGitRepo(masterRemote);
    assert.strictEqual(setupOk, true, 'AC-6: setupGitRepo must succeed on unborn repo');
    const unbornBranch = await gitSync.resolveActiveBranch();
    assert.strictEqual(unbornBranch, 'master', 'AC-6: unborn repo setupGitRepo must align HEAD to remote default branch master');

    // Static check on extension.ts post-sync rescan & config change handling
    const extSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'extension.ts'), 'utf8');
    assert(extSrc.includes('scanner.scanSessions(false)'), 'AC-6: extension.ts onDidSync must call scanner.scanSessions(false)');
    assert(extSrc.includes("affectsConfiguration('brainHub.brainPath')"), 'AC-6: extension.ts must listen to brainPath config changes');
    const pkgJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    assert(pkgJson.contributes.configuration.properties['brainHub.brainPath'].description.includes('.gemini/antigravity/brain'), 'AC-6: package.json brainPath description must reflect modern default');
    console.log('✓ AC-6 passed');

    console.log('\n🎉 ALL AC-1..AC-6 CROSS-MACHINE ATTRIBUTION & GIT SYNC TESTS PASSED!');
  } finally {
    mockConfigStore['brainHub.brainPath'] = origBrainPath;
    mockConfigStore['brainHub.additionalBrainPaths'] = origAdditional;
    mockConfigStore['brainHub.machineName'] = origMachine;
    scanner.stopRealtimeWatcher();
    scanner.stopBackgroundScanTimer();
    gitSync.stopAutoSyncTimer();
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {}
  }
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
