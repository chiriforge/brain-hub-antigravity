import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as cp from 'child_process';
import * as vscode from 'vscode';
import { SessionScanner } from './SessionScanner';

export interface GitStatusInfo {
  isRepo: boolean;
  hasRemote: boolean;
  remoteUrl?: string;
  branch?: string;
  hasUncommittedChanges: boolean;
  uncommittedFilesCount: number;
}

export class GitSyncService {
  private static instance: GitSyncService;
  private isSyncing: boolean = false;
  private pullSuppressionUntil: number = 0;
  private autoSyncTimer?: NodeJS.Timeout;
  private _onDidSync: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
  public readonly onDidSync: vscode.Event<void> = this._onDidSync.event;

  private constructor() {
    SessionScanner.getInstance().setPullSuppressionChecker(() => this.isPullSuppressionActive());
  }

  public static getInstance(): GitSyncService {
    if (!GitSyncService.instance) {
      GitSyncService.instance = new GitSyncService();
    }
    return GitSyncService.instance;
  }

  public getBrainDir(): string {
    const configPath = vscode.workspace.getConfiguration('brainHub').get<string>('brainPath');
    if (configPath && configPath.trim().length > 0) {
      return path.resolve(configPath.trim());
    }
    const home = os.homedir();
    const modernDir = path.join(home, '.gemini', 'antigravity', 'brain');
    const legacyDir = path.join(home, '.gemini', 'antigravity-ide', 'brain');
    const candidates = [
      modernDir,
      legacyDir,
      path.join(home, '.gemini', 'antigravity-2.0', 'brain'),
      path.join(home, '.gemini', 'antigravity-app', 'brain'),
      path.join(home, '.gemini', 'antigravity-cli', 'brain'),
      path.join(home, '.gemini', 'agy', 'brain')
    ];
    for (const dir of candidates) {
      if (fs.existsSync(path.join(dir, '.git'))) {
        return dir;
      }
    }
    if (fs.existsSync(modernDir)) {
      return modernDir;
    }
    if (fs.existsSync(legacyDir)) {
      return legacyDir;
    }
    return modernDir;
  }

  public isPullSuppressionActive(): boolean {
    if (this.isSyncing || Date.now() < this.pullSuppressionUntil) {
      return true;
    }
    const state = this.readSyncState();
    const now = Date.now();
    if (state.inProgress) {
      return true;
    }
    if (state.lastSyncTimestamp > 0 && now - state.lastSyncTimestamp < 5000) {
      return true;
    }
    return false;
  }

  private parseGitArgs(command: string): string[] {
    const args: string[] = [];
    let current = '';
    let inQuotes: '"' | "'" | null = null;
    for (let i = 0; i < command.length; i++) {
      const ch = command[i];
      if (inQuotes) {
        if (ch === inQuotes) {
          inQuotes = null;
        } else {
          current += ch;
        }
      } else if (ch === '"' || ch === "'") {
        inQuotes = ch;
      } else if (/\s/.test(ch)) {
        if (current.length > 0) {
          args.push(current);
          current = '';
        }
      } else {
        current += ch;
      }
    }
    if (current.length > 0) {
      args.push(current);
    }
    return args;
  }

  private execGit(
    commandOrArgs: string | string[],
    cwd?: string,
    options?: { trimOutput?: boolean }
  ): Promise<{ stdout: string; stderr: string; code: number }> {
    const targetCwd = cwd || this.getBrainDir();
    const args = Array.isArray(commandOrArgs) ? commandOrArgs : this.parseGitArgs(commandOrArgs);
    const trimOutput = options?.trimOutput !== false;
    return new Promise((resolve) => {
      const gitEnv = {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_ASKPASS: '',
        GIT_PAGER: 'cat'
      };
      cp.execFile(
        'git',
        args,
        {
          cwd: targetCwd,
          encoding: 'utf8',
          timeout: 45000,
          maxBuffer: 50 * 1024 * 1024,
          killSignal: 'SIGKILL',
          env: gitEnv
        },
        (error, stdout, stderr) => {
          const exitCode = error
            ? typeof (error as any).code === 'number'
              ? (error as any).code
              : 1
            : 0;
          resolve({
            stdout: stdout ? (trimOutput ? stdout.trim() : stdout) : '',
            stderr: stderr ? stderr.trim() : '',
            code: exitCode
          });
        }
      );
    });
  }

  public ensureCleanIndexLock(): boolean {
    const brainDir = this.getBrainDir();
    const lockFile = path.join(brainDir, '.git', 'index.lock');
    if (fs.existsSync(lockFile)) {
      try {
        const stats = fs.statSync(lockFile);
        const ageMs = Date.now() - stats.mtimeMs;
        if (ageMs > 30000) {
          console.log(`Pruning stale .git/index.lock (age: ${Math.round(ageMs / 1000)}s)`);
          fs.unlinkSync(lockFile);
          return true;
        }
      } catch (err) {
        console.warn('Could not inspect or remove .git/index.lock:', err);
      }
    }
    return false;
  }

  public async recoverZombieRebase(): Promise<boolean> {
    const brainDir = this.getBrainDir();
    const gitDir = path.join(brainDir, '.git');
    if (!fs.existsSync(gitDir)) return false;

    let recovered = false;
    const rebaseMergeDir = path.join(gitDir, 'rebase-merge');
    const rebaseApplyDir = path.join(gitDir, 'rebase-apply');
    const mergeHeadFile = path.join(gitDir, 'MERGE_HEAD');

    if (fs.existsSync(rebaseMergeDir) || fs.existsSync(rebaseApplyDir)) {
      console.log('Detected zombie or unfinished git rebase directory. Recovering...');
      try {
        await this.execGit(['rebase', '--quit']);
      } catch {}
      try {
        if (fs.existsSync(rebaseMergeDir)) fs.rmSync(rebaseMergeDir, { recursive: true, force: true });
        if (fs.existsSync(rebaseApplyDir)) fs.rmSync(rebaseApplyDir, { recursive: true, force: true });
        recovered = true;
      } catch (err) {
        console.warn('Failed to prune rebase directory:', err);
      }
    }

    if (fs.existsSync(mergeHeadFile)) {
      console.log('Detected unfinished git merge (MERGE_HEAD). Aborting merge...');
      try {
        await this.execGit(['merge', '--abort']);
      } catch {}
      try {
        if (fs.existsSync(mergeHeadFile)) {
          await this.execGit(['reset', '--merge']);
        }
        if (fs.existsSync(mergeHeadFile)) {
          fs.unlinkSync(mergeHeadFile);
          const mergeMsgFile = path.join(gitDir, 'MERGE_MSG');
          const mergeModeFile = path.join(gitDir, 'MERGE_MODE');
          if (fs.existsSync(mergeMsgFile)) fs.unlinkSync(mergeMsgFile);
          if (fs.existsSync(mergeModeFile)) fs.unlinkSync(mergeModeFile);
          await this.execGit(['reset', '--hard', 'HEAD']);
        }
        recovered = true;
      } catch (err) {
        console.warn('Failed to clean up MERGE_HEAD:', err);
      }
    }

    return recovered;
  }

  public async resolveActiveBranch(): Promise<string> {
    const branchRes = await this.execGit(['branch', '--show-current']);
    if (branchRes.code === 0 && branchRes.stdout) {
      return branchRes.stdout;
    }
    const symRefRes = await this.execGit(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
    if (symRefRes.code === 0 && symRefRes.stdout) {
      return symRefRes.stdout.replace(/^origin\//, '').trim() || 'main';
    }
    const headRefRes = await this.execGit(['symbolic-ref', '--short', 'HEAD']);
    if (headRefRes.code === 0 && headRefRes.stdout) {
      return headRefRes.stdout.trim();
    }
    return 'main';
  }

  public async stampPendingSessionsBeforeSync(): Promise<void> {
    const brainDir = this.getBrainDir();
    if (!fs.existsSync(brainDir) || !(await this.isGitRepo())) {
      return;
    }
    const statusRes = await this.execGit(
      ['-c', 'core.quotepath=false', 'status', '--porcelain'],
      brainDir,
      { trimOutput: false }
    );
    if (statusRes.code !== 0 || !statusRes.stdout) {
      return;
    }

    const scanner = SessionScanner.getInstance();
    const localMachine = scanner.getLocalMachineName();
    const candidateSessionIds = new Set<string>();

    for (const line of statusRes.stdout.split(/\r?\n/)) {
      if (!line || line.length < 4) continue;
      const x = line[0];
      const y = line[1];
      if (x === 'D' || y === 'D') {
        continue;
      }
      let relPath = line.slice(3).trim();
      if (relPath.includes(' -> ')) {
        relPath = relPath.split(' -> ').pop()!.trim();
      }
      relPath = relPath.replace(/^["']|["']$/g, '');
      const firstSeg = relPath.replace(/\\/g, '/').split('/')[0];
      if (!firstSeg || firstSeg.startsWith('.') || firstSeg === 'tempmediaStorage') {
        continue;
      }
      candidateSessionIds.add(firstSeg);
    }

    for (const sessionId of candidateSessionIds) {
      const sessionDir = path.join(brainDir, sessionId);
      try {
        if (!fs.existsSync(sessionDir) || !fs.statSync(sessionDir).isDirectory()) {
          continue;
        }
        if (scanner.readSessionOriginMeta(sessionDir)) {
          continue;
        }
        const tf = scanner.getTranscriptFilePath(sessionDir);
        if (!tf) {
          continue;
        }
        const parsed = scanner.parseTranscriptFile(tf, sessionId, true);
        if (parsed.detectedMachine && parsed.detectedMachine.toLowerCase() !== localMachine.toLowerCase()) {
          continue;
        }
        const wsMachine = scanner.extractMachineFromWorkspacePath(parsed.detectedWorkspace);
        if (wsMachine && wsMachine.toLowerCase() !== localMachine.toLowerCase()) {
          continue;
        }
        scanner.stampLocalSessionOrigin(sessionDir);
      } catch {}
    }
  }

  private async pullAndMergeBranch(branch: string): Promise<{ ok: boolean; error?: string }> {
    const brainDir = this.getBrainDir();
    const mergeHeadFile = path.join(brainDir, '.git', 'MERGE_HEAD');
    const escapedBranch = branch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const missingRefRegex = new RegExp(`couldn't find remote ref ${escapedBranch}`, 'i');

    let pullRes = await this.execGit(['pull', 'origin', branch, '--no-rebase', '-X', 'ours']);
    this.pullSuppressionUntil = Date.now() + 5000;
    if (pullRes.code === 0) {
      return { ok: true };
    }

    const combinedErr = `${pullRes.stderr}\n${pullRes.stdout}`;
    if (missingRefRegex.test(combinedErr)) {
      return { ok: true };
    }

    if (fs.existsSync(mergeHeadFile)) {
      await this.recoverZombieRebase();
    }

    pullRes = await this.execGit(['pull', 'origin', branch, '--no-rebase', '--no-edit', '--allow-unrelated-histories', '-X', 'ours']);
    this.pullSuppressionUntil = Date.now() + 5000;
    if (pullRes.code === 0) {
      return { ok: true };
    }

    const retryErr = `${pullRes.stderr}\n${pullRes.stdout}`;
    if (missingRefRegex.test(retryErr)) {
      return { ok: true };
    }

    if (fs.existsSync(mergeHeadFile)) {
      await this.recoverZombieRebase();
    }

    return { ok: false, error: (pullRes.stderr || pullRes.stdout || 'Git pull/merge failed').trim() };
  }

  public async isGitRepo(): Promise<boolean> {
    const brainDir = this.getBrainDir();
    const gitDir = path.join(brainDir, '.git');
    return fs.existsSync(gitDir);
  }

  public async getStatus(): Promise<GitStatusInfo> {
    const brainDir = this.getBrainDir();
    if (!fs.existsSync(brainDir) || !(await this.isGitRepo())) {
      return {
        isRepo: false,
        hasRemote: false,
        hasUncommittedChanges: false,
        uncommittedFilesCount: 0
      };
    }

    try {
      const branch = await this.resolveActiveBranch();
      const remoteRes = await this.execGit('remote get-url origin');
      const statusRes = await this.execGit('status --porcelain');

      const lines = statusRes.stdout ? statusRes.stdout.split('\n').filter((l) => l.trim()) : [];

      return {
        isRepo: true,
        branch,
        hasRemote: remoteRes.code === 0 && !!remoteRes.stdout,
        remoteUrl: remoteRes.code === 0 ? remoteRes.stdout : undefined,
        hasUncommittedChanges: lines.length > 0,
        uncommittedFilesCount: lines.length
      };
    } catch {
      return {
        isRepo: true,
        hasRemote: false,
        hasUncommittedChanges: false,
        uncommittedFilesCount: 0
      };
    }
  }

  public async ensureGitIgnore(): Promise<void> {
    const brainDir = this.getBrainDir();
    if (!fs.existsSync(brainDir)) {
      return;
    }

    const gitignorePath = path.join(brainDir, '.gitignore');
    const defaultIgnoreRules = [
      'tempmediaStorage/',
      '*.tmp',
      '*.log',
      '.DS_Store',
      'Thumbs.db',
      '.vscode-test/',
      '.sessions_index_cache.json',
      '.antigravity_sync_state.json'
    ];

    let currentContent = '';
    if (fs.existsSync(gitignorePath)) {
      currentContent = await fs.promises.readFile(gitignorePath, 'utf8');
    }

    let modified = false;
    for (const rule of defaultIgnoreRules) {
      if (!currentContent.includes(rule)) {
        currentContent += (currentContent.endsWith('\n') || !currentContent ? '' : '\n') + rule + '\n';
        modified = true;
      }
    }

    if (modified || !fs.existsSync(gitignorePath)) {
      await fs.promises.writeFile(gitignorePath, currentContent, 'utf8');
    }

    if (await this.isGitRepo()) {
      await this.execGit('config diff.ignoreSubmodules all');
      await this.execGit('config status.submodulesummary 0');

      // If .sessions_index_cache.json is tracked by Git, untrack it so it stays local-only
      const trackedCheck = await this.execGit('ls-files .sessions_index_cache.json');
      if (trackedCheck.code === 0 && trackedCheck.stdout.includes('.sessions_index_cache.json')) {
        console.log('Untracking .sessions_index_cache.json from Git index...');
        await this.execGit('rm --cached .sessions_index_cache.json');
      }
    }
  }

  public async setupGitRepo(remoteUrl: string): Promise<boolean> {
    const brainDir = this.getBrainDir();
    if (!fs.existsSync(brainDir)) {
      fs.mkdirSync(brainDir, { recursive: true });
    }

    await this.ensureGitIgnore();

    if (!(await this.isGitRepo())) {
      const initRes = await this.execGit('init');
      if (initRes.code !== 0) {
        vscode.window.showErrorMessage(`Git init failed: ${initRes.stderr}`);
        return false;
      }
    }

    const remoteCheck = await this.execGit(['remote', 'get-url', 'origin']);
    if (remoteCheck.code === 0) {
      await this.execGit(['remote', 'set-url', 'origin', remoteUrl]);
    } else {
      await this.execGit(['remote', 'add', 'origin', remoteUrl]);
    }

    const headCheck = await this.execGit(['rev-parse', '--verify', 'HEAD']);
    if (headCheck.code !== 0) {
      // Unborn repository (0 commits): align HEAD with remote default branch if available
      let targetBranch = 'main';
      const lsRemote = await this.execGit(['ls-remote', '--symref', 'origin', 'HEAD']);
      if (lsRemote.code === 0 && lsRemote.stdout) {
        const refMatch = lsRemote.stdout.match(/ref:\s*refs\/heads\/([^\s]+)\s+HEAD/);
        if (refMatch && refMatch[1]) {
          targetBranch = refMatch[1].trim();
        }
      }
      await this.execGit(['symbolic-ref', 'HEAD', `refs/heads/${targetBranch}`]);
    }

    vscode.window.showInformationMessage(`GitHub Remote URL set to: ${remoteUrl}`);
    return true;
  }

  private getSyncStateFilePath(): string {
    const brainDir = this.getBrainDir();
    const gitDir = path.join(brainDir, '.git');
    if (fs.existsSync(gitDir)) {
      return path.join(gitDir, 'antigravity_sync_state.json');
    }
    return path.join(brainDir, '.antigravity_sync_state.json');
  }

  private readSyncState(): { lastSyncTimestamp: number; lastSyncTimeStr: string; inProgress: boolean; lockExpiresAt: number; syncedByPid: number } {
    const filePath = this.getSyncStateFilePath();
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf8');
        const data = JSON.parse(raw);
        const pid = Number(data.syncedByPid) || 0;
        const lockExpiresAt = Number(data.lockExpiresAt) || 0;
        let inProgress = !!data.inProgress;

        if (inProgress) {
          if (lockExpiresAt > 0 && Date.now() > lockExpiresAt) {
            inProgress = false;
          } else if (pid > 0 && !SessionScanner.getInstance().isProcessAlive(pid)) {
            console.log(`Clearing stale git sync lock from dead PID ${pid}`);
            inProgress = false;
          }
        }

        return {
          lastSyncTimestamp: Number(data.lastSyncTimestamp) || 0,
          lastSyncTimeStr: data.lastSyncTimeStr || '',
          inProgress,
          lockExpiresAt,
          syncedByPid: pid
        };
      }
    } catch {}
    return {
      lastSyncTimestamp: 0,
      lastSyncTimeStr: '',
      inProgress: false,
      lockExpiresAt: 0,
      syncedByPid: 0
    };
  }

  private writeSyncState(update: Partial<{ lastSyncTimestamp: number; lastSyncTimeStr: string; inProgress: boolean; lockExpiresAt: number; syncedByPid: number }>): void {
    const filePath = this.getSyncStateFilePath();
    try {
      const current = this.readSyncState();
      const next = {
        ...current,
        ...update,
        syncedByPid: process.pid
      };
      const parentDir = path.dirname(filePath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }
      fs.writeFileSync(filePath, JSON.stringify(next, null, 2), 'utf8');
    } catch (err) {
      console.warn('Failed to write sync state:', err);
    }
  }

  public async syncSilently(minCooldownMinutes?: number): Promise<boolean> {
    if (this.isSyncing) {
      return false;
    }

    const brainDir = this.getBrainDir();
    if (!fs.existsSync(brainDir) || !(await this.isGitRepo())) {
      return false;
    }

    this.ensureCleanIndexLock();
    await this.recoverZombieRebase();

    const state = this.readSyncState();
    const now = Date.now();

    // Cross-window active lock check (TTL: 90s)
    if (state.inProgress && now < state.lockExpiresAt) {
      console.log('Skipping background sync: Another IDE window or process is currently executing Git sync.');
      return false;
    }

    // Cross-window cooldown check: Skip if ANY window has already completed sync recently
    if (minCooldownMinutes && minCooldownMinutes > 0) {
      const cooldownMs = minCooldownMinutes * 60 * 1000;
      if (state.lastSyncTimestamp > 0 && now - state.lastSyncTimestamp < cooldownMs) {
        const elapsedSec = Math.round((now - state.lastSyncTimestamp) / 1000);
        console.log(`Skipping background sync: Already synced by another window ${elapsedSec}s ago (cooldown: ${minCooldownMinutes}m).`);
        return false;
      }
    }

    const status = await this.getStatus();
    if (!status.isRepo || !status.hasRemote) {
      return false;
    }

    this.isSyncing = true;
    this.writeSyncState({ inProgress: true, lockExpiresAt: now + 90000 });

    try {
      await this.ensureGitIgnore();
      await this.stampPendingSessionsBeforeSync();
      await this.execGit(['add', '.']);

      const statusCheck = await this.getStatus();
      const nowStr = new Date().toLocaleString();
      if (statusCheck.hasUncommittedChanges) {
        await this.execGit(['commit', '-m', `chore: auto background sync ${nowStr}`]);
      }

      const branch = await this.resolveActiveBranch();
      const pullResult = await this.pullAndMergeBranch(branch);
      if (!pullResult.ok) {
        console.warn('Background git pull/merge failed:', pullResult.error);
        this.writeSyncState({
          inProgress: false,
          lockExpiresAt: 0
        });
        return false;
      }

      const pushRes = await this.execGit(['push', '-u', 'origin', branch]);
      if (pushRes.code !== 0) {
        console.warn('Background git push failed:', pushRes.stderr || pushRes.stdout);
        this.writeSyncState({
          inProgress: false,
          lockExpiresAt: 0
        });
        return false;
      }

      this.writeSyncState({
        inProgress: false,
        lockExpiresAt: 0,
        lastSyncTimestamp: Date.now(),
        lastSyncTimeStr: nowStr
      });
      this._onDidSync.fire();
      return true;
    } catch (err) {
      console.warn('Background git sync failed:', err);
      this.writeSyncState({ inProgress: false, lockExpiresAt: 0 });
      return false;
    } finally {
      this.isSyncing = false;
    }
  }

  public async syncWithRemote(): Promise<void> {
    if (this.isSyncing) {
      vscode.window.showInformationMessage('A Git sync operation is already in progress.');
      return;
    }

    const brainDir = this.getBrainDir();
    if (!fs.existsSync(brainDir)) {
      vscode.window.showErrorMessage('Brain directory does not exist.');
      return;
    }

    this.ensureCleanIndexLock();
    await this.recoverZombieRebase();

    const status = await this.getStatus();
    if (!status.isRepo || !status.hasRemote) {
      const setupOption = await vscode.window.showInformationMessage(
        'GitHub backup repository is not configured for your chat history yet.',
        'Setup GitHub Sync',
        'Cancel'
      );
      if (setupOption === 'Setup GitHub Sync') {
        await this.promptSetup();
      }
      return;
    }

    this.isSyncing = true;
    this.writeSyncState({ inProgress: true, lockExpiresAt: Date.now() + 90000 });

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Syncing Antigravity Sessions with GitHub...',
        cancellable: false
      },
      async (progress) => {
        try {
          await this.ensureGitIgnore();
          await this.stampPendingSessionsBeforeSync();

          progress.report({ message: 'Staging new and updated sessions...' });
          await this.execGit(['add', '.']);

          const statusCheck = await this.getStatus();
          const nowStr = new Date().toLocaleString();
          if (statusCheck.hasUncommittedChanges) {
            progress.report({ message: 'Committing local history...' });
            await this.execGit(['commit', '-m', `chore: sync antigravity sessions ${nowStr}`]);
          }

          progress.report({ message: 'Merging remote sessions from other machines...' });
          const branch = await this.resolveActiveBranch();
          const pullResult = await this.pullAndMergeBranch(branch);
          if (!pullResult.ok) {
            vscode.window.showErrorMessage(`Git pull/merge failed: ${pullResult.error}`);
            this.writeSyncState({
              inProgress: false,
              lockExpiresAt: 0
            });
            return;
          }

          progress.report({ message: 'Pushing merged history to GitHub...' });
          const pushRes = await this.execGit(['push', '-u', 'origin', branch]);

          if (pushRes.code !== 0) {
            vscode.window.showErrorMessage(`Git push failed: ${pushRes.stderr || pushRes.stdout}`);
            this.writeSyncState({
              inProgress: false,
              lockExpiresAt: 0
            });
            return;
          } else {
            vscode.window.showInformationMessage(`Antigravity sessions merged and synced successfully! (${nowStr})`);
          }

          this.writeSyncState({
            inProgress: false,
            lockExpiresAt: 0,
            lastSyncTimestamp: Date.now(),
            lastSyncTimeStr: nowStr
          });
          this._onDidSync.fire();
        } finally {
          this.isSyncing = false;
        }
      }
    );
  }

  public startAutoSyncTimer(intervalMinutes: number): void {
    this.stopAutoSyncTimer();

    if (intervalMinutes <= 0) {
      return;
    }

    const intervalMs = intervalMinutes * 60 * 1000;
    const cooldownMinutes = Math.max(1, intervalMinutes - 2);

    this.autoSyncTimer = setInterval(async () => {
      console.log(`Checking scheduled background Git Sync (${intervalMinutes}m)...`);
      await this.syncSilently(cooldownMinutes);
    }, intervalMs);
  }

  public stopAutoSyncTimer(): void {
    if (this.autoSyncTimer) {
      clearInterval(this.autoSyncTimer);
      this.autoSyncTimer = undefined;
    }
  }

  public async promptSetup(): Promise<void> {
    const remoteUrl = await vscode.window.showInputBox({
      title: 'Setup Brain Hub for Antigravity GitHub Backup',
      prompt: 'Enter your Private GitHub Repository URL (HTTPS or SSH)',
      placeHolder: 'https://github.com/username/antigravity-brain-backup.git',
      ignoreFocusOut: true,
      validateInput: (val) => {
        if (!val || (!val.startsWith('https://') && !val.startsWith('git@'))) {
          return 'Please enter a valid Git URL (e.g. https://github.com/username/repo.git or git@github.com:username/repo.git)';
        }
        return null;
      }
    });

    if (!remoteUrl) {
      return;
    }

    const success = await this.setupGitRepo(remoteUrl.trim());
    if (success) {
      const doSync = await vscode.window.showInformationMessage(
        'Git repository initialized successfully! Do you want to push your current chat history to GitHub now?',
        'Push to GitHub Now',
        'Later'
      );
      if (doSync === 'Push to GitHub Now') {
        await this.syncWithRemote();
      }
    }
  }

  public getLastSyncInfo(): { lastSyncTimestamp: number; lastSyncTimeStr: string } {
    const state = this.readSyncState();
    return {
      lastSyncTimestamp: state.lastSyncTimestamp,
      lastSyncTimeStr: state.lastSyncTimeStr
    };
  }
}
