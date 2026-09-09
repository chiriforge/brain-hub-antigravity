import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';
import { ChatMessage, ChatSession, ConversationThread, ToolCallInfo } from '../models/types';

interface CachedSessionEntry {
  session: ChatSession;
  mtime: number;
  fileMtime?: number;
  fileSize?: number;
  targetFilePath?: string;
}

export class SessionScanner {
  private static instance: SessionScanner;
  private sessionCache: Map<string, CachedSessionEntry> = new Map();
  private persistentStoragePath?: string;
  private isCacheLoadedFromDisk: boolean = false;
  private lastDiskCacheMtime: number = 0;
  private brainWatchers: fs.FSWatcher[] = [];
  private watcherDebounceTimer?: NodeJS.Timeout;
  private backgroundScanTimer?: NodeJS.Timeout;
  private activeScanPromise?: Promise<ChatSession[]>;
  private saveCacheDebounceTimer?: NodeJS.Timeout;

  private constructor() {}

  public saveCacheToDiskDebounced(delayMs: number = 800): void {
    if (this.saveCacheDebounceTimer) {
      clearTimeout(this.saveCacheDebounceTimer);
    }
    this.saveCacheDebounceTimer = setTimeout(() => {
      this.saveCacheToDisk();
      this.saveCacheDebounceTimer = undefined;
    }, delayMs);
  }

  public invalidateSessionCache(sessionId: string): void {
    for (const [key, entry] of this.sessionCache.entries()) {
      if (entry && entry.session && entry.session.id === sessionId) {
        this.sessionCache.delete(key);
      }
    }
  }

  public static getInstance(): SessionScanner {
    if (!SessionScanner.instance) {
      SessionScanner.instance = new SessionScanner();
    }
    return SessionScanner.instance;
  }

  public setStoragePath(storagePath: string): void {
    this.persistentStoragePath = storagePath;
    this.loadCacheFromDisk();
  }

  private getCacheFilePath(): string {
    if (this.persistentStoragePath) {
      if (!fs.existsSync(this.persistentStoragePath)) {
        try {
          fs.mkdirSync(this.persistentStoragePath, { recursive: true });
        } catch {
          // ignore
        }
      }
      return path.join(this.persistentStoragePath, 'sessions_index_cache.json');
    }
    return path.join(this.getDefaultBrainDirectory(), '.sessions_index_cache.json');
  }

  private getScanLockFilePath(): string {
    if (this.persistentStoragePath) {
      return path.join(this.persistentStoragePath, 'sessions_scan.lock');
    }
    return path.join(this.getDefaultBrainDirectory(), '.sessions_scan.lock');
  }

  private acquireScanLock(ttlMs: number = 15000): boolean {
    const lockFile = this.getScanLockFilePath();
    const now = Date.now();
    try {
      if (fs.existsSync(lockFile)) {
        const raw = fs.readFileSync(lockFile, 'utf8');
        const lockData = JSON.parse(raw);
        if (lockData && lockData.expiresAt && now < lockData.expiresAt && lockData.pid !== process.pid) {
          // Another window is actively scanning
          return false;
        }
      }
      const parentDir = path.dirname(lockFile);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }
      fs.writeFileSync(
        lockFile,
        JSON.stringify({
          pid: process.pid,
          timestamp: now,
          expiresAt: now + ttlMs
        }),
        'utf8'
      );
      return true;
    } catch {
      return true;
    }
  }

  private releaseScanLock(): void {
    const lockFile = this.getScanLockFilePath();
    try {
      if (fs.existsSync(lockFile)) {
        const raw = fs.readFileSync(lockFile, 'utf8');
        const lockData = JSON.parse(raw);
        if (lockData && lockData.pid === process.pid) {
          fs.unlinkSync(lockFile);
        }
      }
    } catch {}
  }

  private getCandidateCacheFilePaths(): string[] {
    const candidates: string[] = [];
    if (this.persistentStoragePath) {
      candidates.push(path.join(this.persistentStoragePath, 'sessions_index_cache.json'));
    }
    const brainDir = this.getDefaultBrainDirectory();
    if (brainDir) {
      candidates.push(path.join(brainDir, '.sessions_index_cache.json'));
    }
    const appData = process.env.APPDATA;
    if (appData) {
      candidates.push(path.join(appData, 'Antigravity IDE', 'User', 'globalStorage', 'hungle-vn.brain-hub-antigravity', 'sessions_index_cache.json'));
      candidates.push(path.join(appData, 'Code', 'User', 'globalStorage', 'hungle-vn.brain-hub-antigravity', 'sessions_index_cache.json'));
      candidates.push(path.join(appData, 'Code - Insiders', 'User', 'globalStorage', 'hungle-vn.brain-hub-antigravity', 'sessions_index_cache.json'));
      candidates.push(path.join(appData, 'Cursor', 'User', 'globalStorage', 'hungle-vn.brain-hub-antigravity', 'sessions_index_cache.json'));
    }
    const userHome = process.env.USERPROFILE || process.env.HOME;
    if (userHome) {
      candidates.push(path.join(userHome, '.gemini', 'antigravity-ide', 'brain', '.sessions_index_cache.json'));
      candidates.push(path.join(userHome, '.config', 'Antigravity IDE', 'User', 'globalStorage', 'hungle-vn.brain-hub-antigravity', 'sessions_index_cache.json'));
      candidates.push(path.join(userHome, '.config', 'Code', 'User', 'globalStorage', 'hungle-vn.brain-hub-antigravity', 'sessions_index_cache.json'));
      candidates.push(path.join(userHome, 'Library', 'Application Support', 'Antigravity IDE', 'User', 'globalStorage', 'hungle-vn.brain-hub-antigravity', 'sessions_index_cache.json'));
      candidates.push(path.join(userHome, 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'hungle-vn.brain-hub-antigravity', 'sessions_index_cache.json'));
    }
    return Array.from(new Set(candidates.filter(Boolean)));
  }

  public loadCacheFromDisk(forceReload: boolean = false): void {
    try {
      const candidates = this.getCandidateCacheFilePaths();
      let chosenFile: string | null = null;
      let chosenData: any[] | null = null;
      let chosenStats: fs.Stats | null = null;

      const primaryFile = this.getCacheFilePath();
      if (fs.existsSync(primaryFile)) {
        try {
          const stats = fs.statSync(primaryFile);
          if (!forceReload && this.isCacheLoadedFromDisk && stats.mtimeMs <= this.lastDiskCacheMtime) {
            return;
          }
          const raw = fs.readFileSync(primaryFile, 'utf8');
          const data = JSON.parse(raw);
          if (Array.isArray(data) && data.length > 0) {
            chosenFile = primaryFile;
            chosenData = data;
            chosenStats = stats;
          }
        } catch {}
      }

      // If primary cache is missing or empty, search all candidate paths
      if (!chosenData || chosenData.length === 0) {
        let maxCount = -1;
        for (const cand of candidates) {
          if (cand === primaryFile || !fs.existsSync(cand)) continue;
          try {
            const raw = fs.readFileSync(cand, 'utf8');
            const data = JSON.parse(raw);
            if (Array.isArray(data) && data.length > maxCount) {
              maxCount = data.length;
              chosenFile = cand;
              chosenData = data;
              chosenStats = fs.statSync(cand);
            }
          } catch {}
        }
      }

      if (!chosenData || !chosenStats) {
        return;
      }

      if (forceReload || (chosenStats && chosenStats.mtimeMs > this.lastDiskCacheMtime)) {
        this.sessionCache.clear();
      }

      for (const item of chosenData) {
        if (item && item.session && item.session.id && item.mtime) {
          // Invalidate cached session if its workspaceName or workspacePath is invalid
          if (item.session.workspacePath && !this.isValidWorkspacePath(item.session.workspacePath)) {
            continue;
          }
          if (item.session.workspaceName && (!item.session.workspacePath || !this.isValidWorkspacePath(item.session.workspacePath))) {
            continue;
          }
          if (item.session.machineName && !this.isValidMachineName(item.session.machineName)) {
            item.session.machineName = this.getLocalMachineName();
          }
          item.session.lastModified = new Date(item.session.lastModified);
          if (item.session.createdAt) {
            item.session.createdAt = new Date(item.session.createdAt);
          }
          const key = `${item.session.id}_${item.session.path}`;
          this.sessionCache.set(key, item);
        }
      }
      this.lastDiskCacheMtime = chosenStats.mtimeMs;
      this.isCacheLoadedFromDisk = true;

      // Seed primary cache immediately if we loaded from a fallback candidate
      if (chosenFile !== primaryFile && this.sessionCache.size > 0) {
        this.saveCacheToDisk();
      }
    } catch (err) {
      console.warn('Could not load persistent session cache from disk:', err);
    }
  }

  public hasValidCache(): boolean {
    if (!this.isCacheLoadedFromDisk) {
      this.loadCacheFromDisk();
    }
    return this.sessionCache.size > 0;
  }

  public getCachedSessions(includeEmpty?: boolean): ChatSession[] {
    if (!this.isCacheLoadedFromDisk) {
      this.loadCacheFromDisk();
    }
    const sessionMap = new Map<string, ChatSession>();
    for (const item of this.sessionCache.values()) {
      if (item && item.session) {
        const existing = sessionMap.get(item.session.id);
        if (!existing || item.session.lastModified.getTime() > existing.lastModified.getTime()) {
          sessionMap.set(item.session.id, item.session);
        }
      }
    }
    const sessions = Array.from(sessionMap.values());
    return this.filterAndSortSessions(sessions, includeEmpty);
  }

  public saveCacheToDisk(): void {
    if (this.saveCacheDebounceTimer) {
      clearTimeout(this.saveCacheDebounceTimer);
      this.saveCacheDebounceTimer = undefined;
    }
    try {
      const cacheFile = this.getCacheFilePath();
      const parentDir = path.dirname(cacheFile);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }
      const entries = Array.from(this.sessionCache.values());
      const rawData = JSON.stringify(entries);
      const tmpFile = `${cacheFile}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(tmpFile, rawData, 'utf8');
      try {
        fs.renameSync(tmpFile, cacheFile);
      } catch {
        fs.writeFileSync(cacheFile, rawData, 'utf8');
        try {
          if (fs.existsSync(tmpFile)) {
            fs.unlinkSync(tmpFile);
          }
        } catch {}
      }
      if (fs.existsSync(cacheFile)) {
        this.lastDiskCacheMtime = fs.statSync(cacheFile).mtimeMs;
      }

      // Also mirror to shared brain root cache file so all IDE instances stay in sync
      const brainDir = this.getDefaultBrainDirectory();
      if (brainDir) {
        const brainCacheFile = path.join(brainDir, '.sessions_index_cache.json');
        if (brainCacheFile !== cacheFile) {
          try {
            fs.writeFileSync(brainCacheFile, rawData, 'utf8');
          } catch {}
        }
      }
    } catch (err) {
      console.warn('Could not save persistent session cache to disk:', err);
    }
  }

  public startRealtimeWatcher(onChangedCallback: () => void): void {
    this.stopRealtimeWatcher();
    const dirs = this.getAllTargetDirectories();
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        continue;
      }
      try {
        const watcher = fs.watch(dir, { persistent: false }, (eventType, filename) => {
          if (filename && (filename.startsWith('.') || filename === 'tempmediaStorage')) {
            return;
          }
          if (this.watcherDebounceTimer) {
            clearTimeout(this.watcherDebounceTimer);
          }
          this.watcherDebounceTimer = setTimeout(async () => {
            await this.scanSessions(false);
            onChangedCallback();
          }, 2500);
        });
        this.brainWatchers.push(watcher);
      } catch (err) {
        console.warn(`Could not start shallow brain watcher for ${dir}:`, err);
      }
    }
  }

  public stopRealtimeWatcher(): void {
    if (this.watcherDebounceTimer) {
      clearTimeout(this.watcherDebounceTimer);
      this.watcherDebounceTimer = undefined;
    }
    for (const w of this.brainWatchers) {
      try {
        w.close();
      } catch {}
    }
    this.brainWatchers = [];
  }

  public startBackgroundScanTimer(intervalMinutes: number, onChangedCallback: () => void): void {
    this.stopBackgroundScanTimer();
    if (intervalMinutes <= 0) {
      return;
    }
    const intervalMs = intervalMinutes * 60 * 1000;
    this.backgroundScanTimer = setInterval(async () => {
      await this.scanSessions(false);
      onChangedCallback();
    }, intervalMs);
  }

  public stopBackgroundScanTimer(): void {
    if (this.backgroundScanTimer) {
      clearInterval(this.backgroundScanTimer);
      this.backgroundScanTimer = undefined;
    }
  }

  public getLocalMachineName(): string {
    const configuredName = vscode.workspace.getConfiguration('brainHub').get<string>('machineName');
    if (configuredName && configuredName.trim().length > 0) {
      return configuredName.trim();
    }
    return os.hostname() || 'Local-PC';
  }

  public getDefaultBrainDirectory(): string {
    const home = os.homedir();
    return path.join(home, '.gemini', 'antigravity-ide', 'brain');
  }

  public getBrainDirectory(): string {
    const configPath = vscode.workspace.getConfiguration('brainHub').get<string>('brainPath');
    if (configPath && configPath.trim().length > 0) {
      return path.resolve(configPath.trim());
    }
    return this.getDefaultBrainDirectory();
  }

  public getAllTargetDirectories(): string[] {
    const dirs: Set<string> = new Set();
    const home = os.homedir();

    // 1. Check environment variables
    const envVars = ['ANTIGRAVITY_BRAIN_DIR', 'ANTIGRAVITY_DATA_DIR', 'AGY_DATA_DIR', 'GEMINI_DATA_DIR', 'GEMINI_HOME'];
    for (const ev of envVars) {
      const val = process.env[ev];
      if (val && val.trim().length > 0) {
        const p = path.resolve(val.trim());
        const brainCandidate = path.basename(p) === 'brain' ? p : path.join(p, 'brain');
        if (fs.existsSync(brainCandidate)) {
          dirs.add(brainCandidate);
        }
      }
    }

    // 2. Well-known multi-runtime directories
    const wellKnownPaths = [
      path.join(home, '.gemini', 'antigravity-ide', 'brain'),
      path.join(home, '.gemini', 'antigravity', 'brain'),
      path.join(home, '.gemini', 'antigravity-2.0', 'brain'),
      path.join(home, '.gemini', 'antigravity-app', 'brain'),
      path.join(home, '.gemini', 'antigravity-cli', 'brain'),
      path.join(home, '.gemini', 'agy', 'brain')
    ];

    for (const wp of wellKnownPaths) {
      if (fs.existsSync(wp)) {
        dirs.add(wp);
      }
    }

    // 3. User configured brain path
    const customBrainPath = vscode.workspace.getConfiguration('brainHub').get<string>('brainPath');
    if (customBrainPath && customBrainPath.trim().length > 0) {
      const resolved = path.resolve(customBrainPath.trim());
      if (fs.existsSync(resolved)) {
        dirs.add(resolved);
      }
    }

    // 4. Additional configured paths
    const additionalPaths = vscode.workspace.getConfiguration('brainHub').get<string[]>('additionalBrainPaths', []);
    if (Array.isArray(additionalPaths)) {
      for (const p of additionalPaths) {
        if (p && p.trim().length > 0) {
          const resolved = path.resolve(p.trim());
          if (fs.existsSync(resolved)) {
            dirs.add(resolved);
          }
        }
      }
    }

    return Array.from(dirs);
  }

  public getTranscriptFilePath(sessionPath: string, preferFull: boolean = false): string | null {
    const logsDir = path.join(sessionPath, '.system_generated', 'logs');
    const transcriptPath = path.join(logsDir, 'transcript.jsonl');
    const fullTranscriptPath = path.join(logsDir, 'transcript_full.jsonl');

    if (preferFull) {
      if (fs.existsSync(fullTranscriptPath)) {
        return fullTranscriptPath;
      }
      if (fs.existsSync(transcriptPath)) {
        return transcriptPath;
      }
      return null;
    }

    // Prefer compact transcript.jsonl first for high performance and live updates during fast scanning
    if (fs.existsSync(transcriptPath)) {
      return transcriptPath;
    }
    if (fs.existsSync(fullTranscriptPath)) {
      return fullTranscriptPath;
    }
    return null;
  }

  public isSessionEmpty(session: ChatSession): boolean {
    if (session.hasArtifacts) {
      return false;
    }
    if (session.messageCount > 0 || session.userPromptCount > 0) {
      return false;
    }
    if (session.firstPrompt && session.firstPrompt !== '(No user prompt recorded)') {
      return false;
    }
    return true;
  }

  public async scanSessions(forceRefresh: boolean = false, includeEmpty?: boolean): Promise<ChatSession[]> {
    if (this.activeScanPromise) {
      return this.activeScanPromise;
    }

    this.activeScanPromise = (async () => {
      try {
        return await this.performScan(forceRefresh, includeEmpty);
      } finally {
        this.activeScanPromise = undefined;
      }
    })();

    return this.activeScanPromise;
  }

  private async performScan(forceRefresh: boolean = false, includeEmpty?: boolean): Promise<ChatSession[]> {
    // 1. Cross-Window Mutex Lock check for scanning (different from git sync lock)
    const hasLock = this.acquireScanLock(15000);
    if (!hasLock && !forceRefresh) {
      // Another IDE window is already scanning. Wait 400ms and load the updated cache from disk.
      await new Promise((resolve) => setTimeout(resolve, 400));
      this.loadCacheFromDisk(true);
      const cachedSessions = Array.from(this.sessionCache.values()).map((e) => e.session);
      return this.filterAndSortSessions(cachedSessions, includeEmpty);
    }

    try {
      this.loadCacheFromDisk(forceRefresh);

      if (forceRefresh) {
        this.sessionCache.clear();
      }

      const targetDirs = this.getAllTargetDirectories();
      if (targetDirs.length === 0) {
        return [];
      }

      const sessionMap: Map<string, ChatSession> = new Map();
      let hasNewOrUpdatedSessions = false;

      for (const brainDir of targetDirs) {
        try {
          const entries = await fs.promises.readdir(brainDir, { withFileTypes: true });
          const sessionDirs = entries.filter((entry) => {
            if (!entry.isDirectory()) {
              return false;
            }
            if (entry.name === 'tempmediaStorage' || entry.name.startsWith('.')) {
              return false;
            }
            return true;
          });

          for (const dir of sessionDirs) {
            const sessionPath = path.join(brainDir, dir.name);
            try {
              const cacheKey = `${dir.name}_${sessionPath}`;
              const cached = this.sessionCache.get(cacheKey);

              const targetFile = this.getTranscriptFilePath(sessionPath);
              let targetMtime = 0;
              let targetSize = 0;
              let hasTranscript = false;

              if (targetFile) {
                try {
                  const tStat = await fs.promises.stat(targetFile);
                  targetMtime = tStat.mtimeMs;
                  targetSize = tStat.size;
                  hasTranscript = true;
                } catch {}
              }

              let session: ChatSession | null = null;
              const isCacheHit =
                !forceRefresh &&
                cached &&
                cached.session &&
                cached.session.searchKeywords !== undefined &&
                (hasTranscript
                  ? cached.fileMtime === targetMtime && cached.fileSize === targetSize
                  : cached.mtime !== undefined);

              if (isCacheHit && cached) {
                session = cached.session;
              } else {
                let dirMtime = new Date();
                let dirMtimeMs = 0;
                try {
                  const dirStat = await fs.promises.stat(sessionPath);
                  dirMtime = dirStat.mtime;
                  dirMtimeMs = dirStat.mtimeMs;
                } catch {}

                session = await this.parseSessionMetadata(dir.name, sessionPath, dirMtime, targetFile);
                if (session) {
                  this.sessionCache.set(cacheKey, {
                    session,
                    mtime: dirMtimeMs,
                    fileMtime: targetMtime,
                    fileSize: targetSize,
                    targetFilePath: targetFile || undefined
                  });
                  hasNewOrUpdatedSessions = true;
                }
              }

              if (session) {
                const existing = sessionMap.get(dir.name);
                if (!existing || session.lastModified.getTime() > existing.lastModified.getTime()) {
                  sessionMap.set(dir.name, session);
                }
              }
            } catch {
              // Ignore individual error
            }
          }
        } catch (err) {
          console.error(`Error scanning directory ${brainDir}:`, err);
        }
      }

      if (hasNewOrUpdatedSessions || forceRefresh) {
        this.saveCacheToDiskDebounced(100);
      }

      const sessions = Array.from(sessionMap.values());
      return this.filterAndSortSessions(sessions, includeEmpty);
    } finally {
      this.releaseScanLock();
    }
  }

  private filterAndSortSessions(sessions: ChatSession[], includeEmpty?: boolean): ChatSession[] {
    this.resolveLineages(sessions);

    const hideEmptyConfig = vscode.workspace.getConfiguration('brainHub').get<boolean>('hideEmptySessions', true);
    const shouldHideEmpty = includeEmpty !== undefined ? !includeEmpty : hideEmptyConfig;

    let result = sessions;
    if (shouldHideEmpty) {
      result = result.filter((s) => !this.isSessionEmpty(s));
    }

    const sortBy = vscode.workspace.getConfiguration('brainHub').get<string>('sessionSortBy', 'lastModified');
    if (sortBy === 'createdAt') {
      result.sort((a, b) => (b.createdAt || b.lastModified).getTime() - (a.createdAt || a.lastModified).getTime());
    } else {
      result.sort((a, b) => (b.lastModified || b.createdAt || new Date(0)).getTime() - (a.lastModified || a.createdAt || new Date(0)).getTime());
    }

    return result;
  }

  public async deleteSession(sessionId: string): Promise<boolean> {
    const targetDirs = this.getAllTargetDirectories();
    let deletedAny = false;

    for (const dir of targetDirs) {
      const sessionPath = path.join(dir, sessionId);
      if (fs.existsSync(sessionPath)) {
        try {
          await fs.promises.rm(sessionPath, { recursive: true, force: true });
          deletedAny = true;
        } catch (err) {
          console.error(`Failed to delete session directory ${sessionPath}:`, err);
        }
      }
    }

    // Remove from in-memory cache
    for (const [key, entry] of this.sessionCache.entries()) {
      if (entry.session && entry.session.id === sessionId) {
        this.sessionCache.delete(key);
      }
    }
    this.saveCacheToDisk();

    return deletedAny;
  }

  public async findEmptySessionDirs(): Promise<Array<{ id: string; path: string }>> {
    const targetDirs = this.getAllTargetDirectories();
    const emptyDirs: Array<{ id: string; path: string }> = [];

    for (const brainDir of targetDirs) {
      try {
        const entries = await fs.promises.readdir(brainDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory() || entry.name === 'tempmediaStorage' || entry.name.startsWith('.')) {
            continue;
          }
          const sessionPath = path.join(brainDir, entry.name);
          try {
            const files = await fs.promises.readdir(sessionPath);
            if (files.length === 0) {
              emptyDirs.push({ id: entry.name, path: sessionPath });
              continue;
            }

            const targetFile = this.getTranscriptFilePath(sessionPath);
            const planPath = path.join(sessionPath, 'implementation_plan.md');
            const walkthroughPath = path.join(sessionPath, 'walkthrough.md');
            const hasArtifacts = fs.existsSync(planPath) || fs.existsSync(walkthroughPath);

            if (!targetFile && !hasArtifacts) {
              emptyDirs.push({ id: entry.name, path: sessionPath });
              continue;
            }

            if (targetFile && !hasArtifacts) {
              try {
                const stat = await fs.promises.stat(targetFile);
                if (stat.size === 0) {
                  emptyDirs.push({ id: entry.name, path: sessionPath });
                }
              } catch {
                emptyDirs.push({ id: entry.name, path: sessionPath });
              }
            }
          } catch {
            // ignore
          }
        }
      } catch (err) {
        console.error(`Error inspecting directory ${brainDir} for empty sessions:`, err);
      }
    }

    return emptyDirs;
  }

  public async cleanEmptySessions(): Promise<{ totalFound: number; deletedCount: number; failedCount: number }> {
    const emptyDirs = await this.findEmptySessionDirs();
    let deletedCount = 0;
    let failedCount = 0;

    for (const item of emptyDirs) {
      try {
        if (fs.existsSync(item.path)) {
          await fs.promises.rm(item.path, { recursive: true, force: true });
          deletedCount++;
        }
        for (const [key, entry] of this.sessionCache.entries()) {
          if (entry.session && entry.session.id === item.id) {
            this.sessionCache.delete(key);
          }
        }
      } catch (err) {
        console.error(`Failed to clean empty session ${item.path}:`, err);
        failedCount++;
      }
    }

    if (deletedCount > 0) {
      this.saveCacheToDisk();
    }

    return {
      totalFound: emptyDirs.length,
      deletedCount,
      failedCount
    };
  }

  private resolveLineages(sessions: ChatSession[]): void {
    const map = new Map<string, ChatSession>();
    sessions.forEach((s) => {
      s.childIds = [];
      map.set(s.id, s);
    });

    for (const session of sessions) {
      if (session.parentId && map.has(session.parentId)) {
        const parent = map.get(session.parentId)!;
        // Verify workspace matching: if both sessions have detected workspace paths, they MUST match
        // to prevent false cross-project linking (e.g. between Project-A and Project-B)
        const sessionWs = (session.workspacePath || '').trim().replace(/\\/g, '/').toLowerCase();
        const parentWs = (parent.workspacePath || '').trim().replace(/\\/g, '/').toLowerCase();
        const sameWorkspace = !sessionWs || !parentWs || sessionWs === parentWs;

        if (sameWorkspace) {
          if (!parent.childIds) {
            parent.childIds = [];
          }
          if (!parent.childIds.includes(session.id)) {
            parent.childIds.push(session.id);
          }
        } else {
          // If workspaces differ, clear invalid cross-workspace parentId
          session.parentId = undefined;
        }
      }
    }

    for (const session of sessions) {
      let curr = session;
      const visited = new Set<string>([curr.id]);

      while (curr.parentId && map.has(curr.parentId)) {
        const p = map.get(curr.parentId)!;
        if (visited.has(p.id)) {
          break;
        }
        visited.add(p.id);
        curr = p;
      }

      session.rootId = curr.id;
      session.threadTitle = curr.title;
    }
  }

  private isToolResultType(t: string): boolean {
    return (
      t === 'RUN_COMMAND' ||
      t === 'CODE_ACTION' ||
      t === 'VIEW_FILE' ||
      t === 'LIST_DIRECTORY' ||
      t === 'GREP_SEARCH' ||
      t === 'SEARCH_WEB' ||
      t === 'GENERATE_IMAGE' ||
      t === 'READ_URL_CONTENT' ||
      t === 'MANAGE_TASK' ||
      t === 'SCHEDULE' ||
      t === 'ASK_QUESTION' ||
      t === 'BROWSER_SUBAGENT' ||
      t === 'ERROR_MESSAGE' ||
      t === 'GENERIC'
    );
  }

  public parseTranscriptFile(targetFile: string, sessionId: string, metadataOnly: boolean = false): {
    messages: ChatMessage[];
    firstPrompt: string;
    allPrompts: string[];
    searchKeywords: string;
    userPromptCount: number;
    detectedWorkspace?: string;
    detectedMachine?: string;
    createdAt?: Date;
    lastMsgTime?: Date;
    detectedParentId?: string;
  } {
    let effectiveTargetFile = targetFile;
    if (!metadataOnly && targetFile.endsWith('transcript.jsonl')) {
      const fullTranscriptPath = path.join(path.dirname(targetFile), 'transcript_full.jsonl');
      if (fs.existsSync(fullTranscriptPath)) {
        try {
          const st = fs.statSync(fullTranscriptPath);
          if (st.size > 0) {
            effectiveTargetFile = fullTranscriptPath;
          }
        } catch {}
      }
    }

    const rawContent = fs.readFileSync(effectiveTargetFile, 'utf8');
    const lines = rawContent.split(/\r?\n/);

    const rawSteps: any[] = [];
    let firstPrompt = '';
    const allPrompts: string[] = [];
    const searchKeywordsSet = new Set<string>();
    let userPromptCount = 0;
    let detectedWorkspace: string | undefined = undefined;
    let detectedMachine: string | undefined = undefined;
    let createdAt: Date | undefined = undefined;
    let lastMsgTime: Date | undefined = undefined;
    let detectedParentId: string | undefined = undefined;

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      try {
        const data = JSON.parse(line);
        rawSteps.push(data);

        if (data.created_at) {
          const t = new Date(data.created_at);
          if (!createdAt) {
            createdAt = t;
          }
          lastMsgTime = t;
        }

        if (data.type === 'USER_INPUT' && data.content) {
          userPromptCount++;
          const cleanPrompt = this.extractCleanUserPrompt(data.content);
          if (cleanPrompt) {
            allPrompts.push(cleanPrompt);
            searchKeywordsSet.add(cleanPrompt.substring(0, 300));
          }
          if (!firstPrompt) {
            firstPrompt = cleanPrompt;
            detectedWorkspace = this.extractWorkspaceFromContent(data.content);
            detectedMachine = this.extractMachineFromContent(data.content);
          }
          if (!detectedParentId) {
            detectedParentId = this.extractReferencedSessionId(data.content, sessionId);
          }
        }

        if (data.type === 'PLANNER_RESPONSE' && data.content) {
          const headingMatches = data.content.match(/^[#]{1,4}\s+[^\r\n]+/gm);
          if (headingMatches) {
            for (const h of headingMatches) {
              searchKeywordsSet.add(h.replace(/^[#]+\s*/, '').trim());
            }
          }
        }

        if (!detectedWorkspace && data.content) {
          detectedWorkspace = this.extractWorkspaceFromContent(data.content);
        }

        if (data.tool_calls && Array.isArray(data.tool_calls)) {
          for (const tc of data.tool_calls) {
            if (tc && tc.args) {
              const args = typeof tc.args === 'string' ? (() => { try { return JSON.parse(tc.args); } catch { return {}; } })() : tc.args;
              if (args.Cwd && this.isValidWorkspacePath(args.Cwd)) {
                if (!detectedWorkspace) {
                  detectedWorkspace = this.cleanWorkspacePath(args.Cwd);
                }
              }
              const targetFile = args.TargetFile || args.AbsolutePath || args.SearchPath || args.DirectoryPath;
              if (targetFile) {
                searchKeywordsSet.add(path.basename(targetFile));
                if (!detectedWorkspace && this.isValidWorkspacePath(targetFile)) {
                  const projRoot = this.deriveProjectRootFromFilePath(targetFile);
                  if (projRoot && this.isValidWorkspacePath(projRoot)) {
                    detectedWorkspace = this.cleanWorkspacePath(projRoot);
                  }
                }
              }
            }
          }
        }

        if (!detectedMachine && data.content) {
          detectedMachine = this.extractMachineFromContent(data.content);
        }
        if (!detectedParentId && data.content) {
          detectedParentId = this.extractReferencedSessionId(data.content, sessionId);
        }
      } catch {
        // Skip invalid JSON line
      }
    }

    if (metadataOnly) {
      return {
        messages: [],
        firstPrompt,
        allPrompts,
        searchKeywords: Array.from(searchKeywordsSet).join(' '),
        userPromptCount,
        detectedWorkspace,
        detectedMachine,
        createdAt,
        lastMsgTime,
        detectedParentId
      };
    }

    const messages: ChatMessage[] = [];
    let stepIndex = 0;
    let userMsgCounter = 0;
    const consumedIndices = new Set<number>();

    for (let i = 0; i < rawSteps.length; i++) {
      if (consumedIndices.has(i)) {
        continue;
      }

      const step = rawSteps[i];
      const source = step.source || 'SYSTEM';
      const type = step.type || 'UNKNOWN';
      const stepContent = step.content || '';
      const thinking = step.thinking || '';
      const stepCreatedAt = step.created_at;

      // Skip tool results that get attached to toolCalls
      if (this.isToolResultType(type) || source === 'TOOL') {
        continue;
      }

      let cleanContent = stepContent;
      let systemPayloads: string[] | undefined = undefined;
      let currentUserIndex: number | undefined = undefined;
      if (type === 'USER_INPUT') {
        cleanContent = this.extractCleanUserPrompt(stepContent);
        userMsgCounter++;
        currentUserIndex = userMsgCounter;
      } else if (type === 'PLANNER_RESPONSE' || source === 'MODEL') {
        const extracted = this.extractModelContentAndPayloads(stepContent);
        cleanContent = extracted.cleanContent;
        if (extracted.systemPayloads.length > 0) {
          systemPayloads = extracted.systemPayloads;
        }
      }

      const toolCalls: ToolCallInfo[] = [];

      if (step.tool_calls && Array.isArray(step.tool_calls)) {
        let lookaheadIndex = i + 1;
        for (const tc of step.tool_calls) {
          const toolCallInfo: ToolCallInfo = {
            name: tc.name || 'tool',
            args: tc.args
          };

          while (lookaheadIndex < rawSteps.length) {
            const nextStep = rawSteps[lookaheadIndex];
            if (nextStep.type === 'USER_INPUT' || nextStep.type === 'PLANNER_RESPONSE' || nextStep.type === 'CHECKPOINT' || nextStep.type === 'SUBAGENT_NOTIFICATION') {
              break;
            }
            if (this.isToolResultType(nextStep.type) || nextStep.source === 'TOOL' || nextStep.source === 'SYSTEM' || (nextStep.source === 'MODEL' && nextStep.content)) {
              toolCallInfo.output = nextStep.content;
              toolCallInfo.exitCode = nextStep.exit_code || (nextStep.type === 'ERROR_MESSAGE' ? 1 : 0);
              toolCallInfo.status = nextStep.status || (nextStep.type === 'ERROR_MESSAGE' ? 'ERROR' : 'DONE');
              consumedIndices.add(lookaheadIndex);
              lookaheadIndex++;
              break;
            }
            lookaheadIndex++;
          }

          toolCalls.push(toolCallInfo);
        }
      }

      messages.push({
        index: step.step_index ?? stepIndex++,
        userIndex: currentUserIndex,
        source,
        type,
        status: step.status,
        content: stepContent,
        cleanContent,
        systemPayloads,
        thinking: thinking ? thinking.trim() : undefined,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        createdAt: stepCreatedAt,
        timestamp: stepCreatedAt ? new Date(stepCreatedAt) : undefined,
        truncatedFields: step.truncated_fields,
        sessionOriginId: sessionId
      });
    }

    // Sort messages strictly in numerical order by step index
    messages.sort((a, b) => a.index - b.index);

    const searchKeywords = Array.from(searchKeywordsSet).join(' ');

    return {
      messages,
      firstPrompt,
      allPrompts,
      searchKeywords,
      userPromptCount: userMsgCounter || userPromptCount,
      detectedWorkspace,
      detectedMachine,
      createdAt,
      lastMsgTime,
      detectedParentId
    };
  }

  public buildSessionFromParsed(
    sessionId: string,
    sessionPath: string,
    mtime: Date,
    parsed: {
      messages?: ChatMessage[];
      firstPrompt: string;
      allPrompts: string[];
      searchKeywords: string;
      userPromptCount: number;
      detectedWorkspace?: string;
      detectedMachine?: string;
      createdAt?: Date;
      lastMsgTime?: Date;
      detectedParentId?: string;
    }
  ): ChatSession {
    const planPath = path.join(sessionPath, 'implementation_plan.md');
    const walkthroughPath = path.join(sessionPath, 'walkthrough.md');
    const hasPlan = fs.existsSync(planPath);
    const hasWalkthrough = fs.existsSync(walkthroughPath);

    const title = parsed.firstPrompt ? this.generateSessionTitle(parsed.firstPrompt) : `Session ${sessionId.substring(0, 8)}`;
    const finalMachineName = parsed.detectedMachine || this.getLocalMachineName();
    const messageCount = parsed.userPromptCount || (parsed.messages && parsed.messages.length > 0 ? parsed.messages.length : 0);
    const isEmpty =
      messageCount === 0 &&
      parsed.userPromptCount === 0 &&
      !hasPlan &&
      !hasWalkthrough &&
      (!parsed.firstPrompt || parsed.firstPrompt === '(No user prompt recorded)');

    let runtime: 'IDE' | 'CLI' | 'Desktop' | 'Custom' = 'IDE';
    const normPath = sessionPath.toLowerCase().replace(/\\/g, '/');
    if (normPath.includes('antigravity-cli') || normPath.includes('/agy/')) {
      runtime = 'CLI';
    } else if (
      normPath.includes('antigravity-app') ||
      normPath.includes('antigravity-2.0') ||
      (normPath.includes('/.gemini/antigravity/') && !normPath.includes('antigravity-ide'))
    ) {
      runtime = 'Desktop';
    } else if (normPath.includes('antigravity-ide')) {
      runtime = 'IDE';
    } else {
      runtime = 'Custom';
    }

    return {
      id: sessionId,
      path: sessionPath,
      title,
      firstPrompt: parsed.firstPrompt || '(No user prompt recorded)',
      allPrompts: parsed.allPrompts,
      searchKeywords: parsed.searchKeywords,
      lastModified: parsed.lastMsgTime || mtime,
      createdAt: parsed.createdAt || mtime,
      messageCount,
      userPromptCount: parsed.userPromptCount,
      workspaceName: parsed.detectedWorkspace ? path.basename(parsed.detectedWorkspace) : undefined,
      workspacePath: parsed.detectedWorkspace,
      machineName: finalMachineName,
      hasArtifacts: hasPlan || hasWalkthrough,
      planPath: hasPlan ? planPath : undefined,
      walkthroughPath: hasWalkthrough ? walkthroughPath : undefined,
      parentId: parsed.detectedParentId,
      isEmpty,
      runtime
    };
  }

  public async parseSessionMetadata(
    sessionId: string,
    sessionPath: string,
    mtime: Date,
    explicitTargetFile?: string | null
  ): Promise<ChatSession | null> {
    const targetFile = explicitTargetFile !== undefined ? explicitTargetFile : this.getTranscriptFilePath(sessionPath);

    let parsed: ReturnType<typeof this.parseTranscriptFile> = {
      messages: [],
      firstPrompt: '',
      allPrompts: [],
      searchKeywords: '',
      userPromptCount: 0,
      detectedWorkspace: undefined,
      detectedMachine: undefined,
      createdAt: undefined,
      lastMsgTime: undefined,
      detectedParentId: undefined
    };

    if (targetFile) {
      try {
        parsed = this.parseTranscriptFile(targetFile, sessionId, true);
      } catch (err) {
        console.warn(`Could not read transcript for session ${sessionId}:`, err);
      }
    }

    return this.buildSessionFromParsed(sessionId, sessionPath, mtime, parsed);
  }

  public isValidMachineName(name?: string): boolean {
    if (!name || typeof name !== 'string') {
      return false;
    }
    const trimmed = name.trim();
    if (trimmed.length < 2 || trimmed.length > 50) {
      return false;
    }
    // Must NOT contain regex/code artifacts or special syntax
    if (/[\*\[\]\(\)\|\?;'"<>`=\$\^\\\/]/.test(trimmed)) {
      return false;
    }
    if (/\\s\*|\\r|\\n|match\(|regex|hostname|machine name|app data/i.test(trimmed)) {
      return false;
    }
    return true;
  }

  public extractMachineFromContent(content: string): string | undefined {
    if (!content) {
      return undefined;
    }

    const hostMatch = content.match(/Machine Name:\s*([a-zA-Z0-9_\-\. ]+)/i) || content.match(/Hostname:\s*([a-zA-Z0-9_\-\. ]+)/i);
    if (hostMatch) {
      const candidate = hostMatch[1].trim();
      if (this.isValidMachineName(candidate)) {
        return candidate;
      }
    }

    const appDataMatch = content.match(/App Data Directory:\s*([a-zA-Z]:[\\\/]Users[\\\/]([a-zA-Z0-9_\-\.]+))/i);
    if (appDataMatch && appDataMatch[2]) {
      const username = appDataMatch[2];
      const localUser = os.userInfo ? os.userInfo().username : '';
      if (username.toLowerCase() === localUser.toLowerCase()) {
        return this.getLocalMachineName();
      }
      const pcName = `${username}-PC`;
      if (this.isValidMachineName(pcName)) {
        return pcName;
      }
    }

    return undefined;
  }

  public extractReferencedSessionId(content: string, currentSessionId: string): string | undefined {
    if (!content) {
      return undefined;
    }

    // 1. Strip system-generated blocks, context metadata, and history summaries
    let clean = content
      .replace(/<conversation_summaries>[\s\S]*?<\/conversation_summaries>/gi, '')
      .replace(/#\s*Conversation History[\s\S]*?(?=<USER_REQUEST>|$)/gi, '')
      .replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/gi, '')
      .replace(/<USER_SETTINGS_CHANGE>[\s\S]*?<\/USER_SETTINGS_CHANGE>/gi, '')
      .replace(/<system_instructions>[\s\S]*?<\/system_instructions>/gi, '')
      .replace(/<conversation_transcript>[\s\S]*?<\/conversation_transcript>/gi, '')
      .replace(/<knowledge_items>[\s\S]*?<\/knowledge_items>/gi, '')
      .replace(/<customizations>[\s\S]*?<\/customizations>/gi, '')
      .replace(/<artifacts>[\s\S]*?<\/artifacts>/gi, '')
      .replace(/<planning_mode>[\s\S]*?<\/planning_mode>/gi, '')
      .replace(/<identity>[\s\S]*?<\/identity>/gi, '')
      .replace(/<slash_commands>[\s\S]*?<\/slash_commands>/gi, '')
      .replace(/<web_application_development>[\s\S]*?<\/web_application_development>/gi, '')
      .replace(/<user_rules>[\s\S]*?<\/user_rules>/gi, '')
      .replace(/<user_information>[\s\S]*?<\/user_information>/gi, '');

    // Focus on actual user request if present
    const userReqMatch = clean.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/i);
    const targetText = userReqMatch ? userReqMatch[1] : clean;

    if (!targetText || !targetText.trim()) {
      return undefined;
    }

    // Pattern 1: Session ID explicit label (e.g. from copyResumePrompt: "Session ID: `...`")
    const sessionExplicitMatch = targetText.match(/(?:Session ID|SessionId|Conversation ID|Session):\s*[`"']?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})[`"']?/i);
    if (sessionExplicitMatch) {
      const candidate = sessionExplicitMatch[1].toLowerCase();
      if (candidate !== currentSessionId.toLowerCase()) {
        return candidate;
      }
    }

    // Pattern 2: resume/continue/tiếp tục from session
    const resumeMatch = targetText.match(/(?:resume|continu(?:e|ing)|tiếp tục|phiên trước|previous session|parent session)[\s\S]{0,80}?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    if (resumeMatch) {
      const candidate = resumeMatch[1].toLowerCase();
      if (candidate !== currentSessionId.toLowerCase()) {
        return candidate;
      }
    }

    // Pattern 3: @session:... / @conversation:...
    const tagMatch = targetText.match(/@(?:session|conversation|chat)[:=]([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    if (tagMatch) {
      const candidate = tagMatch[1].toLowerCase();
      if (candidate !== currentSessionId.toLowerCase()) {
        return candidate;
      }
    }

    return undefined;
  }

  public async loadFullSession(sessionId: string): Promise<{ session: ChatSession; messages: ChatMessage[] } | null> {
    const targetDirs = this.getAllTargetDirectories();

    let sessionPath: string | null = null;
    let foundStats: fs.Stats | null = null;

    // Check cache first for existing valid session path
    for (const entry of this.sessionCache.values()) {
      if (entry && entry.session && entry.session.id === sessionId && entry.session.path) {
        if (fs.existsSync(entry.session.path)) {
          sessionPath = entry.session.path;
          try {
            foundStats = await fs.promises.stat(sessionPath);
            break;
          } catch {
            // ignore
          }
        }
      }
    }

    if (!sessionPath) {
      for (const dir of targetDirs) {
        const candidate = path.join(dir, sessionId);
        if (fs.existsSync(candidate)) {
          sessionPath = candidate;
          try {
            foundStats = await fs.promises.stat(candidate);
            break;
          } catch {
            // ignore
          }
        }
      }
    }

    if (!sessionPath || !foundStats) {
      return null;
    }

    const targetFile = this.getTranscriptFilePath(sessionPath, true);
    if (!targetFile) {
      const session = await this.parseSessionMetadata(sessionId, sessionPath, foundStats.mtime);
      return session ? { session, messages: [] } : null;
    }

    let fileStat: fs.Stats | undefined;
    try {
      fileStat = await fs.promises.stat(targetFile);
    } catch {}

    // Single-pass parse for full messages and metadata
    const parsed = this.parseTranscriptFile(targetFile, sessionId, false);
    const session = this.buildSessionFromParsed(sessionId, sessionPath, foundStats.mtime, parsed);
    session.messageCount = parsed.messages.length;

    this.attachUserMedia(sessionPath, parsed.messages);

    const cacheKey = `${sessionId}_${sessionPath}`;
    this.sessionCache.set(cacheKey, {
      session,
      mtime: foundStats.mtimeMs,
      fileMtime: fileStat?.mtimeMs,
      fileSize: fileStat?.size,
      targetFilePath: targetFile
    });
    this.saveCacheToDiskDebounced(500);

    return { session, messages: parsed.messages };
  }

  public attachUserMedia(sessionPath: string, messages: ChatMessage[]): void {
    const mediaDir = path.join(sessionPath, '.user_uploaded');
    if (!fs.existsSync(mediaDir)) {
      return;
    }

    try {
      const files = fs.readdirSync(mediaDir);
      const mediaFiles = files
        .filter((f) => /\.(png|jpe?g|webp|gif|svg)$/i.test(f))
        .map((f) => {
          const match = f.match(/media_(\d+)/i);
          let ts = 0;
          if (match) {
            ts = parseInt(match[1], 10);
          } else {
            try {
              ts = fs.statSync(path.join(mediaDir, f)).mtimeMs;
            } catch {
              ts = 0;
            }
          }
          return { filename: f, filePath: path.join(mediaDir, f), timestamp: ts };
        })
        .sort((a, b) => a.timestamp - b.timestamp);

      if (mediaFiles.length === 0) {
        return;
      }

      const userMsgs = messages.filter((m) => m.type === 'USER_INPUT');
      userMsgs.sort((a, b) => {
        const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return ta - tb;
      });

      mediaFiles.forEach((media) => {
        const targetMsg =
          userMsgs.find((m, i) => {
            const mTime = m.createdAt ? new Date(m.createdAt).getTime() : 0;
            const prevTime = i > 0 && userMsgs[i - 1].createdAt ? new Date(userMsgs[i - 1].createdAt!).getTime() : 0;
            return media.timestamp > prevTime && media.timestamp <= mTime + 10000;
          }) ||
          userMsgs.find((m) => {
            const mTime = m.createdAt ? new Date(m.createdAt).getTime() : 0;
            return Math.abs(mTime - media.timestamp) < 60000;
          });

        if (targetMsg) {
          try {
            const buf = fs.readFileSync(media.filePath);
            const ext = path.extname(media.filename).toLowerCase().replace('.', '') || 'png';
            const mime = ext === 'jpg' ? 'jpeg' : ext;
            const dataUri = `data:image/${mime};base64,${buf.toString('base64')}`;
            targetMsg.mediaAttachments = targetMsg.mediaAttachments || [];
            targetMsg.mediaAttachments.push(dataUri);
          } catch (e) {
            console.warn('Failed to read user uploaded media:', media.filePath, e);
          }
        }
      });
    } catch (err) {
      console.warn('Error processing user uploaded media in', sessionPath, err);
    }
  }

  public async loadFullThread(sessionId: string): Promise<{ threadSessions: ChatSession[]; allMessages: ChatMessage[] } | null> {
    const allSessions = await this.scanSessions();
    const sessionMap = new Map<string, ChatSession>();
    allSessions.forEach((s) => sessionMap.set(s.id, s));

    const targetSession = sessionMap.get(sessionId);
    if (!targetSession) {
      return null;
    }

    const rootId = targetSession.rootId || targetSession.id;
    const threadSessions = allSessions.filter((s) => (s.rootId || s.id) === rootId || s.id === rootId);
    threadSessions.sort((a, b) => (a.createdAt || a.lastModified).getTime() - (b.createdAt || b.lastModified).getTime());

    const allMessages: ChatMessage[] = [];
    for (const s of threadSessions) {
      const data = await this.loadFullSession(s.id);
      if (data && data.messages.length > 0) {
        allMessages.push(...data.messages);
      }
    }

    return { threadSessions, allMessages };
  }

  public extractModelContentAndPayloads(rawContent: string): { cleanContent: string; systemPayloads: string[] } {
    if (!rawContent) {
      return { cleanContent: '', systemPayloads: [] };
    }

    const systemPayloads: string[] = [];

    // 1. Extract all <SYSTEM_MESSAGE>...</SYSTEM_MESSAGE> blocks
    const fullSysRegex = /(?:The following is a <SYSTEM_MESSAGE>[\s\S]*?)?<SYSTEM_MESSAGE>([\s\S]*?)<\/SYSTEM_MESSAGE>/gi;
    let match: RegExpExecArray | null;
    while ((match = fullSysRegex.exec(rawContent)) !== null) {
      const payload = match[1].trim();
      if (payload) {
        systemPayloads.push(payload);
      }
    }

    // 2. Clean out system blocks from working string
    let working = rawContent.replace(/(?:The following is a <SYSTEM_MESSAGE>[\s\S]*?)?<SYSTEM_MESSAGE>[\s\S]*?<\/SYSTEM_MESSAGE>\s*\}?/gi, '');
    
    // Clean up any remaining intro sentences if unmatched
    working = working.replace(/The following is a <SYSTEM_MESSAGE> not actually sent by the user[\s\S]*?to pay attention to\.\s*/gi, '');

    // 3. Extract leading transient status messages
    const waitMatch = working.match(/^(Waiting for [\s\S]*?\.\.\.\s*|The [\s\S]*?has been launched[\s\S]*?\.\s*)/i);
    if (waitMatch) {
      const waitText = waitMatch[1].trim();
      if (waitText) {
        systemPayloads.unshift(waitText);
      }
      working = working.slice(waitMatch[0].length);
    }

    // Strip stray leading delimiters or braces
    working = working.replace(/^[\s\}]+/, '');

    const cleanContent = working.trim();
    return { cleanContent, systemPayloads };
  }

  public extractCleanUserPrompt(raw: string): string {
    if (!raw) {
      return '';
    }

    const userReqMatch = raw.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/i);
    let prompt = userReqMatch ? userReqMatch[1] : raw;

    prompt = prompt.replace(/<USER_REQUEST>|<\/USER_REQUEST>/gi, '');
    prompt = prompt.replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/gi, '');
    prompt = prompt.replace(/<USER_SETTINGS_CHANGE>[\s\S]*?<\/USER_SETTINGS_CHANGE>/gi, '');
    prompt = prompt.replace(/<SYSTEM_MESSAGE>[\s\S]*?<\/SYSTEM_MESSAGE>/gi, '');

    return prompt.trim();
  }

  public isValidWorkspacePath(candidate?: string): boolean {
    if (!candidate || typeof candidate !== 'string') {
      return false;
    }

    const trimmed = candidate.trim().replace(/^["']|["']$/g, '');
    if (trimmed.length < 3) {
      return false;
    }

    // Check for code, regex, or special syntax characters that cannot exist in valid file paths
    if (/[\*\[\]\(\)\|\?;'"<>`=\$\^]/.test(trimmed)) {
      return false;
    }
    if (/\\s\*|\\r|\\n|match\(|regex|hostname|app data directory/i.test(trimmed)) {
      return false;
    }

    // Normalize path for checks
    const normalized = trimmed.replace(/\\/g, '/').toLowerCase();

    // Must have a valid path shape (e.g. c:/... or /...)
    if (!/^[a-z]:\//i.test(normalized) && !normalized.startsWith('/')) {
      return false;
    }

    // Ignore Windows / System directories
    if (normalized.startsWith('c:/windows') || normalized.startsWith('c:/program files') || normalized.startsWith('c:/programdata')) {
      return false;
    }

    // Ignore temporary directories
    if (normalized.startsWith('/tmp') || normalized.startsWith('/var') || normalized.includes('/tempmediastorage')) {
      return false;
    }

    // Check for User Home / AppData / .gemini internal directories
    // e.g. C:/Users/username (user root without project), C:/Users/username/.gemini, C:/Users/username/AppData
    const userMatch = normalized.match(/^[a-z]:\/users\/([^\/]+)(.*)$/i) || normalized.match(/^\/home\/([^\/]+)(.*)$/i) || normalized.match(/^\/users\/([^\/]+)(.*)$/i);
    if (userMatch) {
      const rest = (userMatch[2] || '').trim();
      // If path is just C:/Users/username with no subfolder -> invalid
      if (!rest || rest === '/') {
        return false;
      }
      // If inside .gemini, AppData, AppData/Local, etc. -> invalid
      if (rest.startsWith('/.gemini') || rest.startsWith('/appdata') || rest.startsWith('/.vscode') || rest.startsWith('/.git')) {
        return false;
      }
    }

    return true;
  }

  public cleanWorkspacePath(candidate: string): string {
    let cleaned = candidate.trim().replace(/^["']|["']$/g, '');
    cleaned = cleaned.replace(/\s*\([^)]*\)$/, '').trim();
    if (cleaned.includes('\\')) {
      cleaned = cleaned.replace(/[\/\\]+/g, '\\').replace(/\\$/, '');
    } else {
      cleaned = cleaned.replace(/\/+$/, '');
    }
    return cleaned;
  }

  public deriveProjectRootFromFilePath(filePath: string): string | undefined {
    if (!filePath || !this.isValidWorkspacePath(filePath)) {
      return undefined;
    }

    const normalized = filePath.replace(/[\/\\]+/g, '/').replace(/\/$/, '');
    const segments = normalized.split('/');

    let dirSegments = segments;
    if (path.extname(segments[segments.length - 1])) {
      dirSegments = segments.slice(0, -1);
    }

    // Check for common source folder keywords: source-code, projects, repos, workspace, dev, github
    const sourceKeywords = ['source-code', 'source_code', 'sources', 'projects', 'project', 'repos', 'repository', 'workspace', 'workspaces', 'dev', 'development', 'github'];
    for (let i = 0; i < dirSegments.length; i++) {
      const segLower = dirSegments[i].toLowerCase();
      if (sourceKeywords.includes(segLower)) {
        if (i + 1 < dirSegments.length) {
          const candidate = dirSegments.slice(0, i + 2).join(path.sep);
          if (this.isValidWorkspacePath(candidate)) {
            return candidate;
          }
        }
      }
    }

    // Check for standard project subdirectories: src, dist, build, public, assets, node_modules, app
    const subDirKeywords = ['src', 'dist', 'build', 'public', 'assets', 'node_modules', 'app', 'components', 'scripts', 'test', 'tests'];
    for (let i = 0; i < dirSegments.length; i++) {
      const segLower = dirSegments[i].toLowerCase();
      if (subDirKeywords.includes(segLower) && i > 0) {
        const candidate = dirSegments.slice(0, i).join(path.sep);
        if (this.isValidWorkspacePath(candidate)) {
          return candidate;
        }
      }
    }

    // Fallback: if at least 3 segments (e.g. D:/Folder/Subfolder) and not in user root
    if (dirSegments.length >= 3) {
      const candidate = dirSegments.slice(0, 3).join(path.sep);
      if (this.isValidWorkspacePath(candidate)) {
        return candidate;
      }
    }

    const fullDir = dirSegments.join(path.sep);
    return this.isValidWorkspacePath(fullDir) ? fullDir : undefined;
  }

  public extractWorkspaceFromContent(content: string): string | undefined {
    if (!content) {
      return undefined;
    }

    // Layer 1: Look for explicit active workspaces mapping in <user_information>:
    // e.g. "d:/my-workspace -> project-repo"
    const userInfoMatch = content.match(/<user_information>([\s\S]*?)<\/user_information>/i);
    const searchScope = userInfoMatch ? userInfoMatch[1] : content;

    const mappingMatch = searchScope.match(/([a-zA-Z]:[\\\/][^\r\n->]+?)\s*->/);
    if (mappingMatch && this.isValidWorkspacePath(mappingMatch[1])) {
      return this.cleanWorkspacePath(mappingMatch[1]);
    }

    const posixMappingMatch = searchScope.match(/(\/[a-zA-Z0-9_\-\.\/]+)\s*->/);
    if (posixMappingMatch && this.isValidWorkspacePath(posixMappingMatch[1])) {
      return this.cleanWorkspacePath(posixMappingMatch[1]);
    }

    // Layer 2: Look for CWD in <ADDITIONAL_METADATA> or tool execution
    const cwdMatch = content.match(/CWD:\s*([a-zA-Z]:[\\\/][^\r\n<]+|\/[a-zA-Z0-9_\-\.\/]+)/i);
    if (cwdMatch && this.isValidWorkspacePath(cwdMatch[1])) {
      return this.cleanWorkspacePath(cwdMatch[1]);
    }

    const toolCwdMatch = content.match(/"Cwd":\s*"([a-zA-Z]:(?:\\\\|\/)[^"]+|\/[^"]+)"/i);
    if (toolCwdMatch && this.isValidWorkspacePath(toolCwdMatch[1])) {
      return this.cleanWorkspacePath(toolCwdMatch[1].replace(/\\\\/g, '\\'));
    }

    // Layer 3: Look for active workspace / working directory declarations
    const activeWsMatch = content.match(/(?:Active Workspace|Working Directory|Workspace Root):\s*([a-zA-Z]:[\\\/][^\r\n<]+|\/[a-zA-Z0-9_\-\.\/]+)/i);
    if (activeWsMatch && this.isValidWorkspacePath(activeWsMatch[1])) {
      return this.cleanWorkspacePath(activeWsMatch[1]);
    }

    // Layer 4: Look for <OPEN_EDITORS> file paths, and derive project root directory
    const openEditorsMatch = content.match(/<OPEN_EDITORS>([\s\S]*?)<\/OPEN_EDITORS>/i);
    if (openEditorsMatch) {
      const fileLines = openEditorsMatch[1].split(/\r?\n/);
      for (const line of fileLines) {
        const fileMatch = line.match(/-\s+([a-zA-Z]:[\\\/][^\r\n\(\)]+|\/[a-zA-Z0-9_\-\.\/]+)/);
        if (fileMatch) {
          const rawFilePath = fileMatch[1].trim();
          const projDir = this.deriveProjectRootFromFilePath(rawFilePath);
          if (projDir && this.isValidWorkspacePath(projDir)) {
            return this.cleanWorkspacePath(projDir);
          }
        }
      }
    }

    return undefined;
  }

  public generateSessionTitle(prompt: string): string {
    if (!prompt) {
      return 'Untitled Session';
    }

    let singleLine = prompt.replace(/<USER_REQUEST>|<\/USER_REQUEST>/gi, '');
    singleLine = singleLine.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
    singleLine = singleLine.replace(/^\/[a-zA-Z0-9_-]+\s*/, '');

    if (singleLine.length > 400) {
      return singleLine.substring(0, 397) + '...';
    }
    return singleLine || 'Untitled Session';
  }

  public async searchSessionsContent(query: string): Promise<string[]> {
    if (!query || query.trim().length === 0) {
      return [];
    }
    const q = query.toLowerCase().trim();
    const sessions = await this.scanSessions(false);
    const matchedIds = new Set<string>();

    // 1. In-memory fast match against title, firstPrompt, allPrompts, searchKeywords, workspace, machine, id
    for (const s of sessions) {
      if (
        s.id.toLowerCase().includes(q) ||
        s.title.toLowerCase().includes(q) ||
        (s.firstPrompt && s.firstPrompt.toLowerCase().includes(q)) ||
        (s.searchKeywords && s.searchKeywords.toLowerCase().includes(q)) ||
        (s.allPrompts && s.allPrompts.some((p) => p.toLowerCase().includes(q))) ||
        (s.workspaceName && s.workspaceName.toLowerCase().includes(q)) ||
        (s.machineName && s.machineName.toLowerCase().includes(q))
      ) {
        matchedIds.add(s.id);
      }
    }

    // 2. Parallel async search across remaining session transcript files and artifact docs
    const remainingSessions = sessions.filter((s) => !matchedIds.has(s.id));
    await Promise.all(
      remainingSessions.map(async (s) => {
        try {
          const transcriptPath = this.getTranscriptFilePath(s.path);
          if (transcriptPath && fs.existsSync(transcriptPath)) {
            const content = await fs.promises.readFile(transcriptPath, 'utf8');
            if (content.toLowerCase().includes(q)) {
              matchedIds.add(s.id);
              return;
            }
          }

          if (s.hasArtifacts) {
            const planPath = path.join(s.path, 'implementation_plan.md');
            if (fs.existsSync(planPath)) {
              const planContent = await fs.promises.readFile(planPath, 'utf8');
              if (planContent.toLowerCase().includes(q)) {
                matchedIds.add(s.id);
                return;
              }
            }
            const walkthroughPath = path.join(s.path, 'walkthrough.md');
            if (fs.existsSync(walkthroughPath)) {
              const wtContent = await fs.promises.readFile(walkthroughPath, 'utf8');
              if (wtContent.toLowerCase().includes(q)) {
                matchedIds.add(s.id);
                return;
              }
            }
          }
        } catch {}
      })
    );

    return Array.from(matchedIds);
  }
}
