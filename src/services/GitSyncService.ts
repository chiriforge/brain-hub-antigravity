import * as fs from 'fs';
import * as path from 'path';
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
  private autoSyncTimer?: NodeJS.Timeout;
  private _onDidSync: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
  public readonly onDidSync: vscode.Event<void> = this._onDidSync.event;

  private constructor() {}

  public static getInstance(): GitSyncService {
    if (!GitSyncService.instance) {
      GitSyncService.instance = new GitSyncService();
    }
    return GitSyncService.instance;
  }

  private getBrainDir(): string {
    return SessionScanner.getInstance().getBrainDirectory();
  }

  private execGit(command: string, cwd?: string): Promise<{ stdout: string; stderr: string; code: number }> {
    const targetCwd = cwd || this.getBrainDir();
    return new Promise((resolve) => {
      const gitEnv = {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_ASKPASS: '',
        GIT_PAGER: 'cat'
      };
      cp.exec(
        `git ${command}`,
        {
          cwd: targetCwd,
          encoding: 'utf8',
          timeout: 45000,
          maxBuffer: 50 * 1024 * 1024,
          killSignal: 'SIGKILL',
          env: gitEnv
        },
        (error, stdout, stderr) => {
          resolve({
            stdout: stdout ? stdout.trim() : '',
            stderr: stderr ? stderr.trim() : '',
            code: error ? (error.code ?? 1) : 0
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

    const rebaseMergeDir = path.join(gitDir, 'rebase-merge');
    const rebaseApplyDir = path.join(gitDir, 'rebase-apply');

    if (fs.existsSync(rebaseMergeDir) || fs.existsSync(rebaseApplyDir)) {
      console.log('Detected zombie or unfinished git rebase directory. Recovering...');
      try {
        await this.execGit('rebase --quit');
      } catch {}
      try {
        if (fs.existsSync(rebaseMergeDir)) fs.rmSync(rebaseMergeDir, { recursive: true, force: true });
        if (fs.existsSync(rebaseApplyDir)) fs.rmSync(rebaseApplyDir, { recursive: true, force: true });
        return true;
      } catch (err) {
        console.warn('Failed to prune rebase directory:', err);
      }
    }
    return false;
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
      const branchRes = await this.execGit('branch --show-current');
      const remoteRes = await this.execGit('remote get-url origin');
      const statusRes = await this.execGit('status --porcelain');

      const lines = statusRes.stdout ? statusRes.stdout.split('\n').filter((l) => l.trim()) : [];

      return {
        isRepo: true,
        branch: branchRes.stdout || 'main',
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

    await this.execGit('branch -M main');

    const remoteCheck = await this.execGit('remote get-url origin');
    if (remoteCheck.code === 0) {
      await this.execGit(`remote set-url origin "${remoteUrl}"`);
    } else {
      await this.execGit(`remote add origin "${remoteUrl}"`);
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
      await this.execGit('add .');

      const statusCheck = await this.getStatus();
      const nowStr = new Date().toLocaleString();
      if (statusCheck.hasUncommittedChanges) {
        await this.execGit(`commit -m "chore: auto background sync ${nowStr}"`);
      }

      let pullRes = await this.execGit('pull origin main --no-rebase -X ours');
      if (pullRes.code !== 0) {
        pullRes = await this.execGit('pull origin main --no-edit --allow-unrelated-histories');
      }

      const pushRes = await this.execGit('push -u origin main');
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

          progress.report({ message: 'Staging new and updated sessions...' });
          await this.execGit('add .');

          const statusCheck = await this.getStatus();
          const nowStr = new Date().toLocaleString();
          if (statusCheck.hasUncommittedChanges) {
            progress.report({ message: 'Committing local history...' });
            await this.execGit(`commit -m "chore: sync antigravity sessions ${nowStr}"`);
          }

          progress.report({ message: 'Merging remote sessions from other machines...' });
          let pullRes = await this.execGit('pull origin main --no-rebase -X ours');

          if (pullRes.code !== 0) {
            pullRes = await this.execGit('pull origin main --no-edit --allow-unrelated-histories');
          }

          progress.report({ message: 'Pushing merged history to GitHub...' });
          const pushRes = await this.execGit('push -u origin main');

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
