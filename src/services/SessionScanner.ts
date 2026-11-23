import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';
import {
  ChatMessage,
  ChatSession,
  ConversationThread,
  ExecutorLiveStatus,
  ExecutorSessionRef,
  InterAgentMessageMeta,
  ModelTokenTotals,
  SessionArtifactItem,
  SwarmBoardMessage,
  SwarmMemberInfo,
  SwarmOverviewData,
  SwarmSessionData,
  SwarmSessionSummary,
  SwarmWorkstreamInfo,
  TokenStepMetric,
  TokenUsageSummary,
  ToolCallInfo,
  TreeTokenRollup
} from '../models/types';

interface ParsedTranscriptResult {
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
  totalStepCount?: number;
  tokenUsage?: TokenUsageSummary;
  detectedExecutorRefs?: ExecutorSessionRef[];
  detectedExecutorParentId?: string;
  executorStatus?: ExecutorLiveStatus;
  latestAction?: string;
  firstTaskTitle?: string;
}

export interface SessionOriginMeta {
  schemaVersion: number;
  machineName: string;
  osUser?: string;
  platform?: string;
  recordedAt?: string;
}

interface CachedSessionEntry {
  session: ChatSession;
  mtime: number;
  fileMtime?: number;
  fileSize?: number;
  auxSignature?: string;
  targetFilePath?: string;
  schemaVersion?: number;
}

export class SessionScanner {
  private static instance: SessionScanner;
  public static readonly CACHE_SCHEMA_VERSION = 8;
  private sessionCache: Map<string, CachedSessionEntry> = new Map();
  private pullSuppressionChecker?: () => boolean;

  public static coerceNonNegativeInt(val: any): number {
    const num = Number(val);
    if (!Number.isFinite(num) || num <= 0) {
      return 0;
    }
    return Math.floor(num);
  }

  public static formatCompactTokens(count?: number): string {
    const safe = SessionScanner.coerceNonNegativeInt(count);
    if (safe === 0) {
      return '0';
    }
    if (safe < 1000) {
      return String(safe);
    }
    if (safe < 1000000) {
      const k = Math.round((safe / 1000) * 10) / 10;
      return `${k.toFixed(1)}k`;
    }
    const m = Math.round((safe / 1000000) * 100) / 100;
    return `${m.toFixed(2).replace(/\.?0+$/, '')}M`;
  }

  public static computeTokenUsageFromRawSteps(rawSteps: any[]): TokenUsageSummary {
    const stepMetrics: TokenStepMetric[] = [];
    let plannerStepCount = 0;
    let plannerContextOrdinal = 0;
    let latestStepIndex = 0;
    let latestInputTokens = 0;
    let latestCacheReadTokens = 0;
    let latestOutputTokens = 0;
    let latestContextTokens = 0;
    let latestCacheHitRatio = 0;
    let peakContextTokens = 0;
    let peakStepIndex = 0;
    let baselineContextTokens = 0;
    let totalInputTokens = 0;
    let totalCacheReadTokens = 0;
    let totalOutputTokens = 0;
    let cacheMissCount = 0;
    let hasCacheMissAtTail = false;
    let primaryModel: string | undefined = undefined;
    const modelBreakdown: Record<string, ModelTokenTotals> = {};

    for (let i = 0; i < rawSteps.length; i++) {
      const step = rawSteps[i];
      if (!step || step.type !== 'PLANNER_RESPONSE') {
        continue;
      }
      plannerStepCount++;
      const stepIdx = typeof step.step_index === 'number' ? step.step_index : i;
      const modelName = typeof step.model === 'string' && step.model.trim() ? step.model.trim() : undefined;
      if (modelName) {
        primaryModel = modelName;
      }
      const modelKey = modelName || 'unknown';
      const inputTokens = SessionScanner.coerceNonNegativeInt(step.input_tokens);
      const cacheReadTokens = SessionScanner.coerceNonNegativeInt(step.cache_read_tokens);
      const outputTokens = SessionScanner.coerceNonNegativeInt(step.output_tokens);
      const totalContextTokens = inputTokens + cacheReadTokens;
      const cacheHitRatio = totalContextTokens > 0
        ? Math.round((cacheReadTokens / totalContextTokens) * 1000) / 10
        : 0;
      const isCacheMiss = plannerContextOrdinal > 0 && cacheReadTokens === 0 && inputTokens > 25000;

      if (totalContextTokens > 0) {
        if (plannerContextOrdinal === 0) {
          baselineContextTokens = totalContextTokens;
        }
        plannerContextOrdinal++;
      }

      if (isCacheMiss) {
        cacheMissCount++;
      }

      totalInputTokens += inputTokens;
      totalCacheReadTokens += cacheReadTokens;
      totalOutputTokens += outputTokens;

      if (!modelBreakdown[modelKey]) {
        modelBreakdown[modelKey] = {
          inputTokens: 0,
          cacheReadTokens: 0,
          outputTokens: 0,
          stepCount: 0
        };
      }
      modelBreakdown[modelKey].inputTokens += inputTokens;
      modelBreakdown[modelKey].cacheReadTokens += cacheReadTokens;
      modelBreakdown[modelKey].outputTokens += outputTokens;
      modelBreakdown[modelKey].stepCount += 1;

      if (totalContextTokens > peakContextTokens) {
        peakContextTokens = totalContextTokens;
        peakStepIndex = stepIdx;
      }

      if (totalContextTokens > 0 || outputTokens > 0 || plannerStepCount === 1) {
        latestStepIndex = stepIdx;
        latestInputTokens = inputTokens;
        latestCacheReadTokens = cacheReadTokens;
        latestOutputTokens = outputTokens;
        latestContextTokens = totalContextTokens;
        latestCacheHitRatio = cacheHitRatio;
        hasCacheMissAtTail = isCacheMiss;
      }

      const toolNames: string[] = [];
      if (Array.isArray(step.tool_calls)) {
        for (const tc of step.tool_calls) {
          if (tc && typeof tc.name === 'string' && tc.name.trim()) {
            toolNames.push(tc.name.trim());
          }
        }
      }

      stepMetrics.push({
        stepIndex: stepIdx,
        inputTokens,
        cacheReadTokens,
        outputTokens,
        totalContextTokens,
        cacheHitRatio,
        isCacheMiss,
        timestamp: typeof step.created_at === 'string' ? step.created_at : undefined,
        toolNames: toolNames.length > 0 ? toolNames : undefined,
        model: modelName
      });
    }

    const totalContextSum = totalInputTokens + totalCacheReadTokens;
    const overallCacheHitRatio = totalContextSum > 0
      ? Math.round((totalCacheReadTokens / totalContextSum) * 1000) / 10
      : 0;
    const cumulativeTokens = totalInputTokens + totalCacheReadTokens + totalOutputTokens;

    return {
      plannerStepCount,
      latestStepIndex,
      latestInputTokens,
      latestCacheReadTokens,
      latestOutputTokens,
      latestContextTokens,
      latestCacheHitRatio,
      peakContextTokens,
      peakStepIndex,
      baselineContextTokens,
      totalInputTokens,
      totalCacheReadTokens,
      totalOutputTokens,
      cumulativeTokens,
      overallCacheHitRatio,
      cacheMissCount,
      hasCacheMissAtTail,
      primaryModel,
      modelBreakdown: Object.keys(modelBreakdown).length > 0 ? modelBreakdown : undefined,
      stepMetrics
    };
  }

  public static normalizeWorkspacePath(rawPath?: string): string {
    if (!rawPath || typeof rawPath !== 'string') {
      return '';
    }
    let normalized = rawPath.trim().replace(/^["']|["']$/g, '');
    normalized = normalized.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/+$/, '');
    return normalized.toLowerCase();
  }

  public static isPathBoundaryMatch(sessionPath?: string, workspacePath?: string): boolean {
    const sPath = SessionScanner.normalizeWorkspacePath(sessionPath);
    const wPath = SessionScanner.normalizeWorkspacePath(workspacePath);
    if (!sPath || !wPath) {
      return false;
    }
    return sPath === wPath || sPath.startsWith(wPath + '/') || wPath.startsWith(sPath + '/');
  }

  public static isCrossMachineOrOsPath(sessionPath: string, workspacePath: string, sessionMachine?: string, localMachine?: string): boolean {
    if (sessionMachine && localMachine && sessionMachine.trim().toLowerCase() !== localMachine.trim().toLowerCase()) {
      return true;
    }
    const getRootFormat = (p: string): string => {
      const driveMatch = p.match(/^([a-z]):\//i);
      if (driveMatch) {
        return `win:${driveMatch[1].toLowerCase()}`;
      }
      const posixRootMatch = p.match(/^\/(users|home|workspaces|mnt|opt|srv|var\/www)(?:\/|$)/i);
      if (posixRootMatch) {
        return `posix:/${posixRootMatch[1].toLowerCase()}`;
      }
      return p.startsWith('/') ? 'posix:/' : '';
    };
    const sRoot = getRootFormat(sessionPath);
    const wRoot = getRootFormat(workspacePath);
    if (sRoot && wRoot && sRoot !== wRoot) {
      return true;
    }
    const sUser = sessionPath.match(/^(?:[a-z]:\/users|\/users|\/home)\/([^\/]+)\//i)?.[1]?.toLowerCase();
    const wUser = workspacePath.match(/^(?:[a-z]:\/users|\/users|\/home)\/([^\/]+)\//i)?.[1]?.toLowerCase();
    if (sUser && wUser && sUser !== wUser) {
      return true;
    }
    return false;
  }

  public static matchSessionToWorkspaceFolder(
    session: (Pick<ChatSession, 'workspacePath' | 'workspaceName'> & { machineName?: string }) | undefined | null,
    folderPath: string,
    folderName?: string,
    localMachineName?: string
  ): 'tier1a_path' | 'tier1b_name' | null {
    if (!session || !folderPath) {
      return null;
    }
    const wPath = SessionScanner.normalizeWorkspacePath(folderPath);
    if (!wPath) {
      return null;
    }

    if (session.workspacePath && SessionScanner.isPathBoundaryMatch(session.workspacePath, wPath)) {
      return 'tier1a_path';
    }

    const derivedFolderName = (folderName || path.posix.basename(wPath) || '').trim().toLowerCase();
    const sName = (session.workspaceName || (session.workspacePath ? path.posix.basename(SessionScanner.normalizeWorkspacePath(session.workspacePath)) : '')).trim().toLowerCase();
    if (derivedFolderName && sName && sName === derivedFolderName) {
      if (!session.workspacePath) {
        return 'tier1b_name';
      }
      const sPath = SessionScanner.normalizeWorkspacePath(session.workspacePath);
      const localMachine = localMachineName || SessionScanner.getInstance().getLocalMachineName();
      if (SessionScanner.isCrossMachineOrOsPath(sPath, wPath, session.machineName, localMachine)) {
        return 'tier1b_name';
      }
    }

    return null;
  }

  public sessionMatchesCurrentWorkspace(
    session: (Pick<ChatSession, 'workspacePath' | 'workspaceName'> & { machineName?: string }) | undefined | null,
    folderPath: string,
    folderName?: string
  ): boolean {
    return SessionScanner.matchSessionToWorkspaceFolder(session, folderPath, folderName, this.getLocalMachineName()) !== null;
  }
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

  public isProcessAlive(pid: number): boolean {
    if (!pid || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (err: any) {
      return err && err.code === 'EPERM';
    }
  }

  private acquireScanLock(ttlMs: number = 15000): boolean {
    const lockFile = this.getScanLockFilePath();
    const now = Date.now();
    try {
      if (fs.existsSync(lockFile)) {
        const raw = fs.readFileSync(lockFile, 'utf8');
        if (raw && raw.trim().length > 0) {
          const lockData = JSON.parse(raw);
          if (lockData && lockData.expiresAt && now < lockData.expiresAt && lockData.pid !== process.pid) {
            if (this.isProcessAlive(lockData.pid)) {
              // Another window is actively scanning
              return false;
            }
            // Dead process PID -> prune orphaned lock immediately
            console.log(`Pruning orphaned scan lock from dead PID ${lockData.pid}`);
            try {
              fs.unlinkSync(lockFile);
            } catch {}
          }
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

  public releaseScanLock(): void {
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
      candidates.push(path.join(appData, 'Antigravity IDE', 'User', 'globalStorage', 'chiriforge.brain-hub-antigravity', 'sessions_index_cache.json'));
      candidates.push(path.join(appData, 'Code', 'User', 'globalStorage', 'chiriforge.brain-hub-antigravity', 'sessions_index_cache.json'));
      candidates.push(path.join(appData, 'Code - Insiders', 'User', 'globalStorage', 'chiriforge.brain-hub-antigravity', 'sessions_index_cache.json'));
      candidates.push(path.join(appData, 'Cursor', 'User', 'globalStorage', 'chiriforge.brain-hub-antigravity', 'sessions_index_cache.json'));
    }
    const userHome = process.env.USERPROFILE || process.env.HOME;
    if (userHome) {
      candidates.push(path.join(userHome, '.gemini', 'antigravity-ide', 'brain', '.sessions_index_cache.json'));
      candidates.push(path.join(userHome, '.config', 'Antigravity IDE', 'User', 'globalStorage', 'chiriforge.brain-hub-antigravity', 'sessions_index_cache.json'));
      candidates.push(path.join(userHome, '.config', 'Code', 'User', 'globalStorage', 'chiriforge.brain-hub-antigravity', 'sessions_index_cache.json'));
      candidates.push(path.join(userHome, 'Library', 'Application Support', 'Antigravity IDE', 'User', 'globalStorage', 'chiriforge.brain-hub-antigravity', 'sessions_index_cache.json'));
      candidates.push(path.join(userHome, 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'chiriforge.brain-hub-antigravity', 'sessions_index_cache.json'));
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
          if (item.schemaVersion !== SessionScanner.CACHE_SCHEMA_VERSION) {
            continue;
          }
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
        if (!existing) {
          sessionMap.set(item.session.id, item.session);
        } else if (existing.path !== item.session.path) {
          sessionMap.set(item.session.id, this.mergeSessionMetadata(existing, item.session));
        } else if (item.session.lastModified.getTime() >= existing.lastModified.getTime()) {
          sessionMap.set(item.session.id, item.session);
        }
      }
    }
    const sessions = Array.from(sessionMap.values());
    return this.filterAndSortSessions(sessions, includeEmpty);
  }

  private purgeDanglingTempFiles(dir: string, maxAgeMs: number = 300000): void {
    try {
      if (!fs.existsSync(dir)) return;
      const files = fs.readdirSync(dir);
      const now = Date.now();
      for (const file of files) {
        if (file.endsWith('.tmp')) {
          const fullPath = path.join(dir, file);
          try {
            const stat = fs.statSync(fullPath);
            if (now - stat.mtimeMs > maxAgeMs) {
              fs.unlinkSync(fullPath);
            }
          } catch {}
        }
      }
    } catch {}
  }

  public setPullSuppressionChecker(checker: () => boolean): void {
    this.pullSuppressionChecker = checker;
  }

  public isPullSuppressionActiveForDir(brainDir?: string): boolean {
    if (this.pullSuppressionChecker) {
      try {
        if (this.pullSuppressionChecker()) {
          return true;
        }
      } catch {}
    }
    if (!brainDir) {
      return false;
    }
    const candidates = [
      path.join(brainDir, '.git', 'antigravity_sync_state.json'),
      path.join(brainDir, '.antigravity_sync_state.json')
    ];
    for (const filePath of candidates) {
      try {
        if (!fs.existsSync(filePath)) continue;
        const raw = fs.readFileSync(filePath, 'utf8');
        const data = JSON.parse(raw);
        const now = Date.now();
        const lockExpiresAt = Number(data.lockExpiresAt) || 0;
        const pid = Number(data.syncedByPid) || 0;
        let inProgress = Boolean(data.inProgress);
        if (inProgress) {
          if (lockExpiresAt > 0 && now > lockExpiresAt) {
            inProgress = false;
          } else if (pid > 0 && !this.isProcessAlive(pid)) {
            inProgress = false;
          }
        }
        const lastSync = Number(data.lastSyncTimestamp) || 0;
        if (inProgress || (lastSync > 0 && now - lastSync < 5000)) {
          return true;
        }
      } catch {}
    }
    return false;
  }

  public readSessionOriginMeta(sessionPath: string): SessionOriginMeta | null {
    if (!sessionPath) return null;
    const metaPath = path.join(sessionPath, '.brainhub_meta.json');
    try {
      if (!fs.existsSync(metaPath)) return null;
      const raw = fs.readFileSync(metaPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.machineName === 'string' && this.isValidMachineName(parsed.machineName)) {
        return {
          schemaVersion: Number(parsed.schemaVersion) || 1,
          machineName: parsed.machineName.trim(),
          osUser: typeof parsed.osUser === 'string' ? parsed.osUser : undefined,
          platform: typeof parsed.platform === 'string' ? parsed.platform : undefined,
          recordedAt: typeof parsed.recordedAt === 'string' ? parsed.recordedAt : undefined
        };
      }
    } catch {}
    return null;
  }

  public writeSessionOriginMetaIfMissing(sessionPath: string, machineName?: string): boolean {
    if (!sessionPath || !fs.existsSync(sessionPath)) {
      return false;
    }
    if (this.readSessionOriginMeta(sessionPath)) {
      return false;
    }
    const resolvedMachine = (machineName && this.isValidMachineName(machineName))
      ? machineName.trim()
      : this.getLocalMachineName();
    let osUser: string | undefined;
    try {
      osUser = os.userInfo().username || undefined;
    } catch {}
    const payload: SessionOriginMeta = {
      schemaVersion: 1,
      machineName: resolvedMachine,
      osUser,
      platform: process.platform,
      recordedAt: new Date().toISOString()
    };
    const metaPath = path.join(sessionPath, '.brainhub_meta.json');
    // Double-check right before atomic write to avoid overwriting a concurrent writer
    if (this.readSessionOriginMeta(sessionPath)) {
      return false;
    }
    this.atomicWriteJsonFile(metaPath, JSON.stringify(payload, null, 2));
    return true;
  }

  public stampLocalSessionOrigin(sessionPath: string): boolean {
    return this.writeSessionOriginMetaIfMissing(sessionPath, this.getLocalMachineName());
  }

  private atomicWriteJsonFile(targetPath: string, rawData: string): void {
    const parentDir = path.dirname(targetPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    const uniq = Math.random().toString(36).slice(2, 7);
    const tmpFile = `${targetPath}.${process.pid}.${Date.now()}.${uniq}.tmp`;
    fs.writeFileSync(tmpFile, rawData, 'utf8');

    let renamed = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        fs.renameSync(tmpFile, targetPath);
        renamed = true;
        break;
      } catch (err: any) {
        if (err && (err.code === 'EBUSY' || err.code === 'EPERM')) {
          const delayMs = 15 * (attempt + 1);
          try {
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
          } catch {
            const waitTill = Date.now() + delayMs;
            while (Date.now() < waitTill) {}
          }
        } else {
          break;
        }
      }
    }
    if (!renamed) {
      try {
        fs.copyFileSync(tmpFile, targetPath);
        fs.unlinkSync(tmpFile);
      } catch {
        fs.writeFileSync(targetPath, rawData, 'utf8');
        try {
          if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
        } catch {}
      }
    }
  }

  public saveCacheToDisk(): void {
    if (this.saveCacheDebounceTimer) {
      clearTimeout(this.saveCacheDebounceTimer);
      this.saveCacheDebounceTimer = undefined;
    }
    try {
      const cacheFile = this.getCacheFilePath();
      const parentDir = path.dirname(cacheFile);
      this.purgeDanglingTempFiles(parentDir);

      // Filter out deleted sessions to prevent zombie resurrection across concurrent windows
      const validEntries = Array.from(this.sessionCache.values()).filter((item) => {
        if (!item || !item.session) return false;
        if (!item.session.path) return true;
        return fs.existsSync(item.session.path);
      });

      const rawData = JSON.stringify(validEntries);
      this.atomicWriteJsonFile(cacheFile, rawData);

      if (fs.existsSync(cacheFile)) {
        this.lastDiskCacheMtime = fs.statSync(cacheFile).mtimeMs;
      }

      // Also mirror to shared brain root cache file so all IDE instances stay in sync (only if dir already exists)
      const brainDir = this.getDefaultBrainDirectory();
      if (brainDir && fs.existsSync(brainDir)) {
        this.purgeDanglingTempFiles(brainDir);
        const brainCacheFile = path.join(brainDir, '.sessions_index_cache.json');
        if (brainCacheFile !== cacheFile) {
          try {
            this.atomicWriteJsonFile(brainCacheFile, rawData);
          } catch {}
        }
      }
    } catch (err) {
      console.warn('Could not save persistent session cache to disk:', err);
    }
  }

  public isRelevantWatchEvent(filename?: string | null): boolean {
    if (!filename) {
      return true;
    }
    const normalized = filename.replace(/\\/g, '/');
    const base = path.posix.basename(normalized);
    if (
      base === '.brainhub_meta.json' ||
      base === '.sessions_index_cache.json' ||
      base === '.scan_lock' ||
      base === '.sync_lock' ||
      base.endsWith('.tmp') ||
      base.endsWith('.lock') ||
      normalized.startsWith('.') ||
      normalized.includes('/.git/') ||
      normalized.includes('/node_modules/') ||
      normalized.includes('tempmediaStorage') ||
      normalized.includes('.tempmediaStorage')
    ) {
      return false;
    }
    return true;
  }

  public startRealtimeWatcher(onChangedCallback: () => void): void {
    this.stopRealtimeWatcher();
    const dirs = this.getAllTargetDirectories();
    const pendingChangedSessions = new Set<string>();

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        continue;
      }
      const listener: fs.WatchListener<string> = (_eventType, filename) => {
        if (!this.isRelevantWatchEvent(filename)) {
          return;
        }
        if (filename) {
          const normalized = filename.replace(/\\/g, '/');
          const firstSeg = normalized.split('/')[0];
          if (firstSeg && !firstSeg.startsWith('.') && firstSeg !== 'tempmediaStorage') {
            pendingChangedSessions.add(path.join(dir, firstSeg));
          }
        }
        if (this.watcherDebounceTimer) {
          clearTimeout(this.watcherDebounceTimer);
        }
        this.watcherDebounceTimer = setTimeout(async () => {
          const changedDirs = Array.from(pendingChangedSessions);
          pendingChangedSessions.clear();
          if (!this.isPullSuppressionActiveForDir(dir)) {
            for (const sessionDir of changedDirs) {
              try {
                if (fs.existsSync(sessionDir) && fs.statSync(sessionDir).isDirectory()) {
                  const tf = this.getTranscriptFilePath(sessionDir);
                  if (tf) {
                    const existingMeta = this.readSessionOriginMeta(sessionDir);
                    if (!existingMeta) {
                      this.stampLocalSessionOrigin(sessionDir);
                    }
                  }
                }
              } catch {}
            }
          }
          await this.scanSessions(false);
          onChangedCallback();
        }, 1500);
      };
      try {
        const watcher = fs.watch(dir, { persistent: false, recursive: true }, listener);
        this.brainWatchers.push(watcher);
      } catch {
        try {
          const fallbackWatcher = fs.watch(dir, { persistent: false }, listener);
          this.brainWatchers.push(fallbackWatcher);
        } catch (err) {
          console.warn(`Could not start brain watcher for ${dir}:`, err);
        }
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

    const hasNonEmptyFile = (filePath: string): boolean => {
      try {
        return fs.existsSync(filePath) && fs.statSync(filePath).size > 0;
      } catch {
        return false;
      }
    };

    if (preferFull) {
      if (hasNonEmptyFile(fullTranscriptPath)) {
        return fullTranscriptPath;
      }
      if (hasNonEmptyFile(transcriptPath)) {
        return transcriptPath;
      }
      if (fs.existsSync(fullTranscriptPath)) {
        return fullTranscriptPath;
      }
      if (fs.existsSync(transcriptPath)) {
        return transcriptPath;
      }
      return null;
    }

    // Prefer compact transcript.jsonl first when non-empty; fall back to non-empty transcript_full.jsonl if compact is 0 bytes
    if (hasNonEmptyFile(transcriptPath)) {
      return transcriptPath;
    }
    if (hasNonEmptyFile(fullTranscriptPath)) {
      return fullTranscriptPath;
    }
    if (fs.existsSync(transcriptPath)) {
      return transcriptPath;
    }
    if (fs.existsSync(fullTranscriptPath)) {
      return fullTranscriptPath;
    }
    return null;
  }

  private computeAuxSignature(sessionPaths: string[]): string {
    const parts: string[] = [];
    for (const sp of sessionPaths) {
      const candidates = [
        path.join(sp, '.brainhub_meta.json'),
        path.join(sp, '.system_generated', 'swarm', 'members.json'),
        path.join(sp, '.system_generated', 'swarm', 'board.jsonl'),
        path.join(sp, '.system_generated', 'swarm', 'view.json'),
        path.join(sp, '.system_generated', 'swarm', 'plan.json'),
        path.join(sp, '.system_generated', 'swarm', 'swarm.json')
      ];
      for (const f of candidates) {
        try {
          if (fs.existsSync(f)) {
            const st = fs.statSync(f);
            parts.push(`${path.basename(f)}:${Math.floor(st.mtimeMs)}:${st.size}`);
          }
        } catch {}
      }
      const subagentsDir = path.join(sp, '.system_generated', 'subagents');
      try {
        if (fs.existsSync(subagentsDir)) {
          const dSt = fs.statSync(subagentsDir);
          parts.push(`subagents:${Math.floor(dSt.mtimeMs)}`);
          const entries = fs.readdirSync(subagentsDir).sort();
          for (const entry of entries) {
            if (!entry.endsWith('.json')) continue;
            try {
              const eSt = fs.statSync(path.join(subagentsDir, entry));
              parts.push(`${entry}:${Math.floor(eSt.mtimeMs)}:${eSt.size}`);
            } catch {}
          }
        }
      } catch {}
    }
    return parts.join('|');
  }

  public isSessionEmpty(session: ChatSession): boolean {
    if (session.hasArtifacts) {
      return false;
    }
    if (session.swarmSummary || (session.executorRefs && session.executorRefs.length > 0)) {
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

  private queuedForceScan: boolean = false;

  public async scanSessions(forceRefresh: boolean = false, includeEmpty?: boolean): Promise<ChatSession[]> {
    if (this.activeScanPromise) {
      if (forceRefresh) {
        this.queuedForceScan = true;
      }
      return this.activeScanPromise.then(() => {
        if (this.queuedForceScan) {
          this.queuedForceScan = false;
          return this.scanSessions(true, includeEmpty);
        }
        return this.getCachedSessions(includeEmpty);
      });
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
      return this.getCachedSessions(includeEmpty);
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

      // Group all existing session directories across all target brain roots by sessionId
      const sessionDirsMap: Map<string, string[]> = new Map();
      for (const brainDir of targetDirs) {
        try {
          const entries = await fs.promises.readdir(brainDir, { withFileTypes: true });
          for (const entry of entries) {
            if (!entry.isDirectory() || entry.name === 'tempmediaStorage' || entry.name.startsWith('.')) {
              continue;
            }
            const sessionPath = path.join(brainDir, entry.name);
            const list = sessionDirsMap.get(entry.name) || [];
            if (!list.includes(sessionPath)) {
              list.push(sessionPath);
              sessionDirsMap.set(entry.name, list);
            }
          }
        } catch (err) {
          console.error(`Error scanning directory ${brainDir}:`, err);
        }
      }

      for (const [sessionId, sessionPaths] of sessionDirsMap.entries()) {
        try {
          let totalSize = 0;
          let maxFileMtime = 0;
          let maxDirMtimeMs = 0;
          let primaryMtime = new Date(0);
          let primaryPath = sessionPaths[0];
          let hasTranscript = false;
          const fragmentFiles: Array<{ file: string; mtimeMs: number }> = [];

          for (const sp of sessionPaths) {
            let spMtimeMs = 0;
            let spMtime = new Date();
            try {
              const dStat = await fs.promises.stat(sp);
              spMtimeMs = dStat.mtimeMs;
              spMtime = dStat.mtime;
            } catch {}

            const tf = this.getTranscriptFilePath(sp);
            let tfMtimeMs = 0;
            if (tf) {
              try {
                const tStat = await fs.promises.stat(tf);
                tfMtimeMs = tStat.mtimeMs;
                totalSize += tStat.size;
                hasTranscript = true;
                fragmentFiles.push({ file: tf, mtimeMs: tfMtimeMs });
                if (tfMtimeMs >= maxFileMtime) {
                  maxFileMtime = tfMtimeMs;
                  primaryPath = sp;
                  primaryMtime = new Date(tfMtimeMs);
                }
              } catch {}
            }

            if (spMtimeMs >= maxDirMtimeMs) {
              maxDirMtimeMs = spMtimeMs;
              if (!hasTranscript) {
                primaryPath = sp;
                primaryMtime = spMtime;
              }
            }
          }

          const cacheKey = `${sessionId}_${primaryPath}`;
          const cached = this.sessionCache.get(cacheKey);
          const auxSignature = this.computeAuxSignature(sessionPaths);

          const isCacheHit =
            !forceRefresh &&
            cached &&
            cached.schemaVersion === SessionScanner.CACHE_SCHEMA_VERSION &&
            cached.auxSignature === auxSignature &&
            cached.session &&
            cached.session.searchKeywords !== undefined &&
            (!cached.session.workspacePath || this.isValidWorkspacePath(cached.session.workspacePath)) &&
            (hasTranscript
              ? cached.fileMtime === maxFileMtime && cached.fileSize === totalSize
              : cached.mtime !== undefined);

          let session: ChatSession | null = null;
          if (isCacheHit && cached) {
            session = cached.session;
          } else {
            fragmentFiles.sort((a, b) => a.mtimeMs - b.mtimeMs);
            const orderedFiles = fragmentFiles.map((f) => f.file);
            session = await this.parseMultiSessionMetadata(sessionId, sessionPaths, primaryPath, primaryMtime, orderedFiles);
            if (session) {
              // Remove any stale cache entries for this sessionId under older paths
              for (const [k, v] of this.sessionCache.entries()) {
                if (v?.session?.id === sessionId && k !== cacheKey) {
                  this.sessionCache.delete(k);
                }
              }
              this.sessionCache.set(cacheKey, {
                session,
                mtime: maxDirMtimeMs,
                fileMtime: maxFileMtime,
                fileSize: totalSize,
                auxSignature,
                targetFilePath: orderedFiles[orderedFiles.length - 1] || undefined,
                schemaVersion: SessionScanner.CACHE_SCHEMA_VERSION
              });
              hasNewOrUpdatedSessions = true;
            }
          }

          if (session) {
            sessionMap.set(sessionId, session);
          }
        } catch {
          // Ignore individual error
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
    this.resolveExecutorLinks(sessions);

    const hideEmptyConfig = vscode.workspace.getConfiguration('brainHub').get<boolean>('hideEmptySessions', true);
    const shouldHideEmpty = includeEmpty !== undefined ? !includeEmpty : hideEmptyConfig;

    let result = sessions;
    if (shouldHideEmpty) {
      const nonEmptyIds = new Set(
        sessions.filter((s) => !this.isSessionEmpty(s)).map((s) => s.id.toLowerCase())
      );
      const referencedByVisibleParent = new Set<string>();
      for (const s of sessions) {
        if (nonEmptyIds.has(s.id.toLowerCase()) && s.executorRefs) {
          for (const ref of s.executorRefs) {
            referencedByVisibleParent.add(ref.conversationId.toLowerCase());
          }
        }
      }
      result = result.filter(
        (s) =>
          !this.isSessionEmpty(s) ||
          referencedByVisibleParent.has(s.id.toLowerCase()) ||
          Boolean(s.executorRootId && nonEmptyIds.has(s.executorRootId.toLowerCase()))
      );
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

            const hasArtifacts = this.hasAnyArtifacts(sessionPath);
            if (hasArtifacts) {
              continue;
            }

            const swarmMembersFile = path.join(sessionPath, '.system_generated', 'swarm', 'members.json');
            const swarmMetaFile = path.join(sessionPath, '.system_generated', 'swarm', 'swarm.json');
            const subagentsDir = path.join(sessionPath, '.system_generated', 'subagents');
            let hasMultiExecutorState = fs.existsSync(swarmMembersFile) || fs.existsSync(swarmMetaFile);
            if (!hasMultiExecutorState && fs.existsSync(subagentsDir)) {
              try {
                hasMultiExecutorState = fs.readdirSync(subagentsDir).some((f) => f.endsWith('.json'));
              } catch {}
            }
            if (hasMultiExecutorState) {
              continue;
            }

            const logsDir = path.join(sessionPath, '.system_generated', 'logs');
            const candidateFiles = [
              path.join(logsDir, 'transcript.jsonl'),
              path.join(logsDir, 'transcript_full.jsonl'),
              path.join(logsDir, 'conversation.pb'),
              path.join(sessionPath, 'conversation.pb'),
              path.join(sessionPath, `${entry.name}.pb`)
            ];

            let hasNonEmptyTranscript = false;
            for (const candidate of candidateFiles) {
              try {
                if (fs.existsSync(candidate)) {
                  const stat = await fs.promises.stat(candidate);
                  if (stat.size > 0) {
                    hasNonEmptyTranscript = true;
                    break;
                  }
                }
              } catch {}
            }

            if (!hasNonEmptyTranscript) {
              emptyDirs.push({ id: entry.name, path: sessionPath });
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
        const normDeletedPath = SessionScanner.normalizeWorkspacePath(item.path);
        for (const [key, entry] of Array.from(this.sessionCache.entries())) {
          if (!entry.session || entry.session.id !== item.id) {
            continue;
          }
          if (entry.session.paths && entry.session.paths.length > 0) {
            entry.session.paths = entry.session.paths.filter(
              (p) => SessionScanner.normalizeWorkspacePath(p) !== normDeletedPath
            );
          }
          const normSessionPath = SessionScanner.normalizeWorkspacePath(entry.session.path);
          const expectedKey = `${item.id}_${item.path}`;
          if (key === expectedKey || normSessionPath === normDeletedPath) {
            const remainingPaths = (entry.session.paths || []).filter((p) => fs.existsSync(p));
            if (remainingPaths.length > 0) {
              entry.session.path = remainingPaths[0];
              entry.session.paths = remainingPaths;
              const newKey = `${item.id}_${remainingPaths[0]}`;
              if (newKey !== key) {
                this.sessionCache.delete(key);
                this.sessionCache.set(newKey, entry);
              }
            } else {
              this.sessionCache.delete(key);
            }
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
      t === 'INVOKE_SUBAGENT' ||
      t === 'ERROR_MESSAGE' ||
      t === 'GENERIC'
    );
  }

  public static unquoteToolArg(val: unknown): string {
    if (val === undefined || val === null) {
      return '';
    }
    if (typeof val !== 'string') {
      try {
        return JSON.stringify(val, null, 2);
      } catch {
        return String(val);
      }
    }
    let current: unknown = val;
    for (let depth = 0; depth < 3; depth++) {
      if (typeof current !== 'string') break;
      const trimmed = current.trim();
      if (!(trimmed.startsWith('"') && trimmed.endsWith('"'))) break;
      try {
        const parsed = JSON.parse(trimmed);
        if (typeof parsed === 'string') {
          current = parsed;
        } else {
          break;
        }
      } catch {
        break;
      }
    }
    return typeof current === 'string' ? current : String(current);
  }

  public static stripInterAgentWrappers(raw: string): string {
    let s = (raw || '').trim();
    s = s.replace(/^\[Message\]\s*(?:timestamp=[^\s]+\s*)?(?:sender=[^\s]+\s*)?content=/i, '');
    s = s.replace(/^sender=[^\s]+\s*/i, '');
    const origMatch = s.match(/<original_task>([\s\S]*?)<\/original_task>/i);
    if (origMatch && origMatch[1].trim()) {
      s = origMatch[1].trim();
    } else {
      s = s.replace(/<\/?original_task>/gi, '');
    }
    return s.trim();
  }

  public decodeWorkspaceUri(rawUri: string): string | undefined {
    if (!rawUri || typeof rawUri !== 'string') return undefined;
    let decoded = rawUri.trim();
    try {
      decoded = decodeURIComponent(decoded);
    } catch {}
    if (/^file:\/\/\/?/i.test(decoded)) {
      decoded = decoded.replace(/^file:\/\/\/?/i, '');
      // Strip leading slash before Windows drive letter (e.g. /d:/repo -> d:/repo)
      decoded = decoded.replace(/^\/([a-zA-Z]:)/, '$1');
    }
    const cleaned = this.cleanWorkspacePath(decoded);
    return this.isValidWorkspacePath(cleaned) ? cleaned : undefined;
  }

  public async parseMultiTranscriptFilesAsync(targetFiles: string[], sessionId: string, metadataOnly: boolean = false): Promise<ParsedTranscriptResult> {
    const allLines: string[] = [];
    for (const targetFile of targetFiles) {
      let effectiveTargetFile = targetFile;
      if (!metadataOnly && targetFile.endsWith('transcript.jsonl')) {
        const fullTranscriptPath = path.join(path.dirname(targetFile), 'transcript_full.jsonl');
        if (fs.existsSync(fullTranscriptPath)) {
          try {
            const st = await fs.promises.stat(fullTranscriptPath);
            if (st.size > 0) {
              effectiveTargetFile = fullTranscriptPath;
            }
          } catch {}
        }
      }
      try {
        const rawContent = await fs.promises.readFile(effectiveTargetFile, 'utf8');
        const lines = rawContent.split(/\r?\n/);
        allLines.push(...lines);
      } catch {}
    }
    if (allLines.length > 500) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    return this.parseTranscriptContent(allLines, sessionId, metadataOnly);
  }

  public async parseTranscriptFileAsync(targetFile: string, sessionId: string, metadataOnly: boolean = false): Promise<ParsedTranscriptResult> {
    return this.parseMultiTranscriptFilesAsync([targetFile], sessionId, metadataOnly);
  }

  public parseTranscriptFile(targetFile: string, sessionId: string, metadataOnly: boolean = false): ParsedTranscriptResult {
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
    return this.parseTranscriptContent(lines, sessionId, metadataOnly);
  }

  private parseTranscriptContent(lines: string[], sessionId: string, metadataOnly: boolean): ParsedTranscriptResult {
    const rawSteps: any[] = [];
    const stepIndexMap = new Map<number, number>();
    const fallbackSigSet = new Set<string>();

    // Pass 1: Parse JSON lines and deduplicate steps across split fragments by step_index
    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      try {
        const data = JSON.parse(line);
        if (typeof data.step_index === 'number') {
          const existingPos = stepIndexMap.get(data.step_index);
          if (existingPos !== undefined) {
            const prev = rawSteps[existingPos];
            const prevLen = (prev.content || '').length + (prev.thinking || '').length;
            const currLen = (data.content || '').length + (data.thinking || '').length;
            const prevTrunc = Array.isArray(prev.truncated_fields) ? prev.truncated_fields.length : 0;
            const currTrunc = Array.isArray(data.truncated_fields) ? data.truncated_fields.length : 0;
            if (currLen > prevLen || currTrunc < prevTrunc) {
              rawSteps[existingPos] = data;
            }
          } else {
            stepIndexMap.set(data.step_index, rawSteps.length);
            rawSteps.push(data);
          }
        } else {
          const sig = `${data.type || ''}:${data.created_at || ''}:${(data.content || '').slice(0, 120)}`;
          if (!fallbackSigSet.has(sig)) {
            fallbackSigSet.add(sig);
            rawSteps.push(data);
          }
        }
      } catch {
        // Skip invalid JSON line
      }
    }

    // Ensure rawSteps are ordered ascending by step_index when present
    rawSteps.sort((a, b) => {
      if (typeof a.step_index === 'number' && typeof b.step_index === 'number') {
        return a.step_index - b.step_index;
      }
      return 0;
    });

    let firstPrompt = '';
    const allPrompts: string[] = [];
    const searchKeywordsSet = new Set<string>();
    let userPromptCount = 0;
    let totalStepCount = 0;
    let detectedWorkspace: string | undefined = undefined;
    let detectedMachine: string | undefined = undefined;
    let createdAt: Date | undefined = undefined;
    let lastMsgTime: Date | undefined = undefined;
    let detectedParentId: string | undefined = undefined;
    let detectedExecutorParentId: string | undefined = undefined;
    let firstTaskTitle: string | undefined = undefined;
    let latestAction: string | undefined = undefined;
    let hasSeenPlannerOrTool = false;
    const pendingInvokeMetadata: Array<{ role?: string; typeName?: string; stepIndex: number }> = [];
    const executorRefMap = new Map<string, ExecutorSessionRef>();

    // Pass 2: Extract metadata across the deduplicated, ordered steps
    for (let stepPos = 0; stepPos < rawSteps.length; stepPos++) {
      const data = rawSteps[stepPos];
      if (!this.isToolResultType(data.type || '') && data.source !== 'TOOL') {
        totalStepCount++;
      }
      if (data.created_at) {
        const t = new Date(data.created_at);
        if (!isNaN(t.getTime())) {
          if (!createdAt || t.getTime() < createdAt.getTime()) {
            createdAt = t;
          }
          if (!lastMsgTime || t.getTime() > lastMsgTime.getTime()) {
            lastMsgTime = t;
          }
        }
      }

      if (data.type === 'USER_INPUT' && data.content) {
        pendingInvokeMetadata.length = 0;
        hasSeenPlannerOrTool = true;
        userPromptCount++;
        const cleanPrompt = this.extractCleanUserPrompt(data.content);
        if (cleanPrompt) {
          allPrompts.push(cleanPrompt);
          searchKeywordsSet.add(cleanPrompt.substring(0, 300));
        }
        if (!firstPrompt && cleanPrompt) {
          firstPrompt = cleanPrompt;
        }
        if (!detectedWorkspace) {
          detectedWorkspace = this.extractWorkspaceFromContent(data.content);
        }
        if (!detectedMachine) {
          detectedMachine = this.extractMachineFromContent(data.content);
        }
        if (!detectedParentId) {
          detectedParentId = this.extractReferencedSessionId(data.content, sessionId);
        }
      }

      if (data.type === 'SYSTEM_MESSAGE' && data.content) {
        const senderUuidMatch = String(data.content).match(
          /sender=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?![\/0-9a-f-])/i
        );
        const isInitialTaskStep =
          userPromptCount === 0 &&
          !hasSeenPlannerOrTool &&
          stepPos <= 2 &&
          (stepPos === 0 ||
            data.step_index === 0 ||
            /<original_task>|\[Message\]\s*timestamp=/i.test(data.content));
        if (senderUuidMatch && isInitialTaskStep && !detectedExecutorParentId) {
          const candParent = senderUuidMatch[1].toLowerCase();
          if (candParent !== sessionId.toLowerCase()) {
            detectedExecutorParentId = candParent;
          }
        }
        const stripped = SessionScanner.stripInterAgentWrappers(String(data.content));
        if (stripped) {
          const isTaskTitleCandidate =
            isInitialTaskStep ||
            stepPos === 0 ||
            data.step_index === 0 ||
            /<original_task>/i.test(data.content);
          if (isTaskTitleCandidate && !firstTaskTitle) {
            firstTaskTitle = stripped.split(/\r?\n/)[0].trim();
          }
          searchKeywordsSet.add(stripped.substring(0, 200));
        }
      }

      if (data.type === 'PLANNER_RESPONSE') {
        pendingInvokeMetadata.length = 0;
        hasSeenPlannerOrTool = true;
        if (data.content) {
          const headingMatches = data.content.match(/^[#]{1,4}\s+[^\r\n]+/gm);
          if (headingMatches) {
            for (const h of headingMatches) {
              searchKeywordsSet.add(h.replace(/^[#]+\s*/, '').trim());
            }
          }
        }
      }

      if (
        !detectedWorkspace &&
        data.content &&
        (data.type === 'USER_INPUT' || /<(?:user_information|ADDITIONAL_METADATA|OPEN_EDITORS)>/i.test(data.content))
      ) {
        detectedWorkspace = this.extractWorkspaceFromContent(data.content);
      }

      if (data.tool_calls && Array.isArray(data.tool_calls)) {
        if (data.tool_calls.length > 0) {
          hasSeenPlannerOrTool = true;
        }
        for (const tc of data.tool_calls) {
          if (tc && tc.name) {
            latestAction = String(tc.name);
          }
          if (tc && tc.args) {
            const args = typeof tc.args === 'string' ? (() => { try { return JSON.parse(tc.args); } catch { return {}; } })() : tc.args;
            if (tc.name === 'invoke_subagent') {
              pendingInvokeMetadata.push({
                role: typeof args.Role === 'string' ? args.Role : (typeof args.role === 'string' ? args.role : undefined),
                typeName: typeof args.TypeName === 'string' ? args.TypeName : (typeof args.typeName === 'string' ? args.typeName : undefined),
                stepIndex: typeof data.step_index === 'number' ? data.step_index : stepPos
              });
            }
            const cwdArg = args.Cwd || args.cwd || args.WorkingDirectory || args.workingDirectory;
            if (cwdArg && typeof cwdArg === 'string' && this.isValidWorkspacePath(cwdArg)) {
              if (!detectedWorkspace) {
                detectedWorkspace = this.cleanWorkspacePath(cwdArg);
              }
            }
            const targetFile =
              args.Path ||
              args.path ||
              args.TargetFile ||
              args.AbsolutePath ||
              args.SearchPath ||
              args.DirectoryPath;
            if (targetFile && typeof targetFile === 'string') {
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

      if ((data.type === 'INVOKE_SUBAGENT' || data.type === 'GENERIC') && data.content) {
        const contentStr = String(data.content);
        const isExplicitInvokeStep = data.type === 'INVOKE_SUBAGENT';
        const bodyAfterTimestamps = contentStr
          .replace(/^(?:\s*(?:Created|Completed) At:\s*[^\r\n]+\r?\n)+/i, '')
          .trimStart();
        const isCommandOrFileOutput = /Command exited with code|Command output:|Showing lines \d+-\d+/i.test(contentStr);
        const isVerifiedGenericReceipt =
          data.type === 'GENERIC' &&
          !isCommandOrFileOutput &&
          (/^Created the following subagent:/i.test(bodyAfterTimestamps) ||
            pendingInvokeMetadata.length > 0);
        if (isExplicitInvokeStep || isVerifiedGenericReceipt) {
          const matches = contentStr.matchAll(
            /"conversationId"\s*:\s*"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/gi
          );
          for (const m of matches) {
            const childId = m[1].toLowerCase();
            if (childId === sessionId.toLowerCase()) continue;
            const meta = pendingInvokeMetadata.shift();
            const prev = executorRefMap.get(childId);
            executorRefMap.set(childId, {
              conversationId: childId,
              role: prev?.role || meta?.role,
              typeName: prev?.typeName || meta?.typeName,
              spawnStepIndex: prev?.spawnStepIndex ?? meta?.stepIndex ?? (typeof data.step_index === 'number' ? data.step_index : stepPos),
              kind: 'subagent',
              sourceAuthority: 'invoke_subagent'
            });
          }
        }
      }

      if (!detectedMachine && data.content && (data.type === 'USER_INPUT' || /App Data Directory:|Machine Name:|Hostname:/i.test(data.content))) {
        detectedMachine = this.extractMachineFromContent(data.content);
      }
    }

    if (userPromptCount > 0) {
      detectedExecutorParentId = undefined;
    }

    // Derive executor live status from tail step
    let executorStatus: ExecutorLiveStatus = 'done';
    if (rawSteps.length > 0) {
      const lastRaw = rawSteps[rawSteps.length - 1];
      if (lastRaw.type === 'ERROR_MESSAGE' || lastRaw.status === 'ERROR') {
        executorStatus = 'error';
      } else if (lastRaw.status === 'RUNNING') {
        executorStatus = 'running';
      } else if (
        lastRaw.type === 'PLANNER_RESPONSE' &&
        Array.isArray(lastRaw.tool_calls) &&
        lastRaw.tool_calls.length > 0 &&
        lastRaw.status !== 'DONE'
      ) {
        executorStatus = 'running';
      }
    }

    const detectedExecutorRefs = executorRefMap.size > 0 ? Array.from(executorRefMap.values()) : undefined;
    const tokenUsage = SessionScanner.computeTokenUsageFromRawSteps(rawSteps);

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
        detectedParentId,
        totalStepCount,
        tokenUsage,
        detectedExecutorRefs,
        detectedExecutorParentId,
        executorStatus,
        latestAction,
        firstTaskTitle
      };
    }

    const messages: ChatMessage[] = [];
    let stepIndex = 0;
    let userMsgCounter = 0;
    let plannerContextOrdinal = 0;
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

      // Skip tool results that get attached to toolCalls (preserve unconsumed INVOKE_SUBAGENT for inline card rendering)
      if ((this.isToolResultType(type) && type !== 'INVOKE_SUBAGENT') || source === 'TOOL') {
        continue;
      }

      let cleanContent = stepContent;
      let systemPayloads: string[] | undefined = undefined;
      let currentUserIndex: number | undefined = undefined;
      let interAgentMeta: InterAgentMessageMeta | undefined = undefined;

      if (type === 'USER_INPUT') {
        cleanContent = this.extractCleanUserPrompt(stepContent);
        userMsgCounter++;
        currentUserIndex = userMsgCounter;
      } else if (type === 'SYSTEM_SDK') {
        interAgentMeta = { kind: 'system_sdk' };
      } else if (type === 'SYSTEM_MESSAGE') {
        const senderSysMatch = stepContent.match(/sender=system(?:\s|$)/i);
        const senderUuidMatch = stepContent.match(
          /sender=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?![\/0-9a-f-])/i
        );
        const senderTaskMatch = stepContent.match(/sender=([a-zA-Z0-9._-]+\/task-\d+)/i);
        if (senderSysMatch) {
          interAgentMeta = { senderLabel: 'System', kind: 'status_notice' };
          cleanContent = SessionScanner.stripInterAgentWrappers(stepContent);
        } else if (senderTaskMatch) {
          interAgentMeta = { senderLabel: senderTaskMatch[1], kind: 'status_notice' };
          cleanContent = SessionScanner.stripInterAgentWrappers(stepContent);
        } else if (senderUuidMatch) {
          const senderId = senderUuidMatch[1].toLowerCase();
          const isTask =
            i === 0 ||
            step.step_index === 0 ||
            /<original_task>/i.test(stepContent) ||
            (i <= 2 && (userMsgCounter || userPromptCount) === 0 && /\[Message\]\s*timestamp=/i.test(stepContent));
          interAgentMeta = {
            senderId,
            kind: isTask ? 'task_assignment' : 'executor_report'
          };
          cleanContent = SessionScanner.stripInterAgentWrappers(stepContent);
        }
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
          let normalizedArgs = tc.args;
          if (tc.name === 'send_message' && normalizedArgs) {
            const parsedArgs =
              typeof normalizedArgs === 'string'
                ? (() => { try { return JSON.parse(normalizedArgs); } catch { return undefined; } })()
                : { ...normalizedArgs };
            if (parsedArgs && typeof parsedArgs === 'object') {
              if (parsedArgs.Message !== undefined) {
                parsedArgs.Message = SessionScanner.unquoteToolArg(parsedArgs.Message);
              }
              if (parsedArgs.Recipient !== undefined) {
                parsedArgs.Recipient = SessionScanner.unquoteToolArg(parsedArgs.Recipient);
              }
              normalizedArgs = parsedArgs;
            }
          }
          const toolCallInfo: ToolCallInfo = {
            name: tc.name || 'tool',
            args: normalizedArgs
          };

          while (lookaheadIndex < rawSteps.length) {
            const nextStep = rawSteps[lookaheadIndex];
            if (nextStep.type === 'USER_INPUT' || nextStep.type === 'PLANNER_RESPONSE') {
              break;
            }
            if (
              nextStep.type === 'CHECKPOINT' ||
              nextStep.type === 'SUBAGENT_NOTIFICATION' ||
              nextStep.type === 'SYSTEM_MESSAGE'
            ) {
              lookaheadIndex++;
              continue;
            }
            if (this.isToolResultType(nextStep.type) || nextStep.source === 'TOOL' || nextStep.source === 'SYSTEM' || (nextStep.source === 'MODEL' && nextStep.content)) {
              const isErrStep = nextStep.type === 'ERROR_MESSAGE' || nextStep.status === 'ERROR';
              const hasNonZeroExit = typeof nextStep.exit_code === 'number' && nextStep.exit_code !== 0;
              toolCallInfo.output = nextStep.content;
              toolCallInfo.exitCode = hasNonZeroExit ? nextStep.exit_code : (isErrStep ? 1 : 0);
              toolCallInfo.status = (isErrStep || hasNonZeroExit) ? 'ERROR' : (nextStep.status || 'DONE');
              consumedIndices.add(lookaheadIndex);
              lookaheadIndex++;
              break;
            }
            lookaheadIndex++;
          }

          toolCalls.push(toolCallInfo);
        }
      }

      let inputTokens: number | undefined = undefined;
      let cacheReadTokens: number | undefined = undefined;
      let outputTokens: number | undefined = undefined;
      let totalContextTokens: number | undefined = undefined;
      let cacheHitRatio: number | undefined = undefined;
      let isCacheMiss: boolean | undefined = undefined;
      let stepModel: string | undefined = undefined;

      if (type === 'PLANNER_RESPONSE') {
        stepModel = typeof step.model === 'string' && step.model.trim() ? step.model.trim() : undefined;
        inputTokens = SessionScanner.coerceNonNegativeInt(step.input_tokens);
        cacheReadTokens = SessionScanner.coerceNonNegativeInt(step.cache_read_tokens);
        outputTokens = SessionScanner.coerceNonNegativeInt(step.output_tokens);
        totalContextTokens = inputTokens + cacheReadTokens;
        cacheHitRatio = totalContextTokens > 0
          ? Math.round((cacheReadTokens / totalContextTokens) * 1000) / 10
          : 0;
        isCacheMiss = plannerContextOrdinal > 0 && cacheReadTokens === 0 && inputTokens > 25000;
        if (totalContextTokens > 0) {
          plannerContextOrdinal++;
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
        sessionOriginId: sessionId,
        inputTokens,
        cacheReadTokens,
        outputTokens,
        totalContextTokens,
        cacheHitRatio,
        isCacheMiss,
        model: stepModel,
        interAgentMeta
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
      detectedParentId,
      totalStepCount: messages.length,
      tokenUsage,
      detectedExecutorRefs,
      detectedExecutorParentId,
      executorStatus,
      latestAction,
      firstTaskTitle
    };
  }

  private readSubagentDescriptors(sessionPath: string): { refs: ExecutorSessionRef[]; workspacePaths: Map<string, string> } {
    const refs: ExecutorSessionRef[] = [];
    const workspacePaths = new Map<string, string>();
    const subagentsDir = path.join(sessionPath, '.system_generated', 'subagents');
    if (!fs.existsSync(subagentsDir)) {
      return { refs, workspacePaths };
    }
    try {
      const files = fs.readdirSync(subagentsDir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const raw = fs.readFileSync(path.join(subagentsDir, file), 'utf8');
          const data = JSON.parse(raw);
          const convId = typeof data.conversationId === 'string' ? data.conversationId.trim().toLowerCase() : '';
          if (!convId) continue;
          let wsPath: string | undefined;
          if (Array.isArray(data.workspaceUris)) {
            for (const uri of data.workspaceUris) {
              if (typeof uri === 'string') {
                const decoded = this.decodeWorkspaceUri(uri);
                if (decoded) {
                  wsPath = decoded;
                  break;
                }
              }
            }
          }
          if (wsPath) {
            workspacePaths.set(convId, wsPath);
          }
          const desc =
            data.subagentDescriptor && typeof data.subagentDescriptor === 'object'
              ? data.subagentDescriptor
              : undefined;
          const role =
            typeof desc?.role === 'string'
              ? desc.role
              : (typeof data.role === 'string' ? data.role : undefined);
          const typeName =
            typeof desc?.typeName === 'string'
              ? desc.typeName
              : (typeof data.typeName === 'string' ? data.typeName : undefined);
          const spawnStepIndex = typeof data.spawnStepIndex === 'number' ? data.spawnStepIndex : undefined;

          const rawState = typeof data.state === 'string' ? data.state.trim().toLowerCase() : '';
          const normState = rawState.replace(/^subagent_state_/, '');
          let status: ExecutorLiveStatus | undefined;
          if (normState === 'alive' || normState === 'running' || normState === 'working') status = 'running';
          else if (normState === 'waiting' || normState === 'idle') status = 'waiting';
          else if (normState === 'error' || normState === 'failed') status = 'error';
          else if (normState === 'killed' || normState === 'cancelled' || normState === 'canceled') status = 'killed';
          else if (normState === 'done' || normState === 'completed' || normState === 'finished') status = 'done';

          refs.push({
            conversationId: convId,
            role,
            typeName,
            state: typeof data.state === 'string' ? data.state : undefined,
            spawnStepIndex,
            status,
            kind: 'subagent',
            sourceAuthority: 'subagent_descriptor'
          });
        } catch {}
      }
    } catch {}
    return { refs, workspacePaths };
  }

  private mapSwarmMemberStatus(rawStatus?: string, killed?: boolean): ExecutorLiveStatus {
    if (killed) return 'killed';
    const s = (rawStatus || '').toLowerCase();
    if (s === 'working' || s === 'running') return 'running';
    if (s === 'waiting' || s === 'idle') return 'waiting';
    if (s === 'error' || s === 'failed') return 'error';
    if (s === 'killed') return 'killed';
    if (s === 'done' || s === 'completed') return 'done';
    return 'waiting';
  }

  public async loadSwarmData(sessionPath: string): Promise<SwarmSessionData | null> {
    if (!sessionPath) return null;
    const swarmDir = path.join(sessionPath, '.system_generated', 'swarm');
    if (!fs.existsSync(swarmDir)) return null;

    const membersFile = path.join(swarmDir, 'members.json');
    const boardFile = path.join(swarmDir, 'board.jsonl');
    const viewFile = path.join(swarmDir, 'view.json');
    const planFile = path.join(swarmDir, 'plan.json');
    const swarmMetaFile = path.join(swarmDir, 'swarm.json');

    let title: string | undefined;
    const members: SwarmMemberInfo[] = [];
    let narratorConvId: string | undefined;

    if (fs.existsSync(membersFile)) {
      try {
        const raw = await fs.promises.readFile(membersFile, 'utf8');
        const data = JSON.parse(raw);
        if (typeof data.title === 'string' && data.title.trim()) {
          title = data.title.trim();
        }
        if (data.members && typeof data.members === 'object') {
          for (const [name, info] of Object.entries<any>(data.members)) {
            if (!info || typeof info !== 'object') continue;
            const convId = typeof info.conversation_id === 'string' ? info.conversation_id.toLowerCase() : undefined;
            const role = typeof info.role === 'string' ? info.role : name;
            if (name === 'narrator' || role === 'narrator') {
              narratorConvId = convId;
            }
            members.push({
              name,
              conversationId: convId,
              role,
              model: typeof info.model === 'string' ? info.model : undefined,
              status: typeof info.status === 'string' ? info.status : undefined,
              wakeMode: typeof info.wake_mode === 'string' ? info.wake_mode : undefined,
              killed: Boolean(info.killed),
              waitSince: typeof info.wait_since === 'string' ? info.wait_since : undefined,
              lastReadSeq: typeof info.last_read_seq === 'number' ? info.last_read_seq : undefined,
              channels: Array.isArray(info.channels) ? info.channels.map(String) : undefined,
              workspaceMode: typeof info.workspace_mode === 'string' ? info.workspace_mode : undefined,
              workspace: typeof info.workspace === 'string' ? info.workspace : undefined
            });
          }
        }
      } catch {}
    }

    const boardMessages: SwarmBoardMessage[] = [];
    if (fs.existsSync(boardFile)) {
      try {
        const raw = await fs.promises.readFile(boardFile, 'utf8');
        for (const line of raw.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const entry = JSON.parse(trimmed);
            boardMessages.push({
              seq: typeof entry.seq === 'number' ? entry.seq : undefined,
              agent: typeof entry.agent === 'string' ? entry.agent : undefined,
              text: typeof entry.text === 'string' ? entry.text : undefined,
              time: typeof entry.time === 'string' ? entry.time : undefined,
              channel: typeof entry.channel === 'string' ? entry.channel : undefined,
              control: entry.control && typeof entry.control === 'object' ? entry.control : undefined
            });
          } catch {
            // Tolerate torn trailing JSONL line
          }
        }
      } catch {}
    }

    let overview: SwarmOverviewData | undefined;
    const candidateViewPaths = [viewFile];
    if (narratorConvId) {
      const brainParent = path.dirname(sessionPath);
      candidateViewPaths.push(path.join(brainParent, narratorConvId, 'swarm_view', 'view.json'));
      for (const dir of this.getAllTargetDirectories()) {
        candidateViewPaths.push(path.join(dir, narratorConvId, 'swarm_view', 'view.json'));
      }
    }

    for (const vp of candidateViewPaths) {
      if (fs.existsSync(vp)) {
        try {
          const raw = await fs.promises.readFile(vp, 'utf8');
          const v = JSON.parse(raw);
          const workstreams: SwarmWorkstreamInfo[] = [];
          if (Array.isArray(v.workstreams)) {
            for (const ws of v.workstreams) {
              if (!ws || typeof ws !== 'object') continue;
              workstreams.push({
                name: String(ws.name || ws.title || 'Workstream'),
                owners: Array.isArray(ws.owners) ? ws.owners.map(String) : undefined,
                state: typeof ws.state === 'string' ? ws.state : undefined,
                progress: typeof ws.progress === 'string' ? ws.progress : undefined,
                note: typeof ws.note === 'string' ? ws.note : undefined,
                tasks: Array.isArray(ws.tasks) ? ws.tasks.map(String) : undefined
              });
            }
          } else if (Array.isArray(v.threads)) {
            for (const th of v.threads) {
              if (!th || !Array.isArray(th.workstreams)) continue;
              for (const ws of th.workstreams) {
                workstreams.push({
                  name: String(ws.name || ws.title || th.title || 'Workstream'),
                  owners: Array.isArray(ws.owners) ? ws.owners.map(String) : undefined,
                  state: typeof ws.state === 'string' ? ws.state : undefined,
                  progress: typeof ws.progress === 'string' ? ws.progress : undefined,
                  note: typeof ws.note === 'string' ? ws.note : undefined
                });
              }
            }
          }
          overview = {
            headline: typeof v.headline === 'string' ? v.headline : undefined,
            runningSummary: typeof v.running_summary === 'string' ? v.running_summary : undefined,
            goal: typeof v.goal === 'string' ? v.goal : undefined,
            phase: typeof v.phase === 'string' ? v.phase : undefined,
            workstreams,
            attention: Array.isArray(v.attention) ? v.attention.map(String) : undefined,
            milestones: Array.isArray(v.milestones) ? v.milestones.map(String) : undefined,
            risks: Array.isArray(v.risks) ? v.risks.map(String) : undefined
          };
          break;
        } catch {}
      }
    }

    if (fs.existsSync(planFile)) {
      try {
        const raw = await fs.promises.readFile(planFile, 'utf8');
        const p = JSON.parse(raw);
        const tasksMap: Record<string, string> | undefined =
          p.tasks && typeof p.tasks === 'object' ? p.tasks : undefined;
        if (!overview) {
          const workstreams: SwarmWorkstreamInfo[] = [];
          if (Array.isArray(p.threads)) {
            for (const th of p.threads) {
              if (!th || typeof th !== 'object') continue;
              workstreams.push({
                name: String(th.title || th.name || 'Thread'),
                tasks: Array.isArray(th.tasks) ? th.tasks.map(String) : undefined
              });
            }
          } else if (tasksMap) {
            for (const [owner, taskText] of Object.entries(tasksMap)) {
              workstreams.push({
                name: owner,
                owners: [owner],
                note: String(taskText)
              });
            }
          }
          overview = {
            goal: typeof p.goal === 'string' ? p.goal : undefined,
            workstreams,
            tasksMap
          };
        } else if (tasksMap) {
          overview.tasksMap = tasksMap;
        }
      } catch {}
    }

    const isRemoteOnly =
      fs.existsSync(swarmMetaFile) &&
      members.length === 0 &&
      boardMessages.length === 0 &&
      !overview;

    return {
      title,
      overview,
      members,
      boardMessages,
      isRemoteOnly
    };
  }

  private readSwarmSummarySync(
    sessionId: string,
    sessionPaths: string[]
  ): { refs: ExecutorSessionRef[]; swarmSummary?: SwarmSessionSummary; childWorkspaces: Map<string, string> } {
    const refMap = new Map<string, ExecutorSessionRef>();
    const childWorkspaces = new Map<string, string>();
    let swarmSummary: SwarmSessionSummary | undefined;

    for (const sp of sessionPaths) {
      const subData = this.readSubagentDescriptors(sp);
      for (const r of subData.refs) {
        if (r.conversationId === sessionId.toLowerCase()) continue;
        refMap.set(r.conversationId, r);
      }
      for (const [cid, ws] of subData.workspacePaths.entries()) {
        childWorkspaces.set(cid, ws);
      }

      const swarmDir = path.join(sp, '.system_generated', 'swarm');
      if (fs.existsSync(swarmDir)) {
        const membersFile = path.join(swarmDir, 'members.json');
        const boardFile = path.join(swarmDir, 'board.jsonl');
        const viewFile = path.join(swarmDir, 'view.json');
        const planFile = path.join(swarmDir, 'plan.json');
        const swarmMetaFile = path.join(swarmDir, 'swarm.json');

        let title: string | undefined;
        let memberCount = 0;
        let workingMemberCount = 0;
        let narratorConvId: string | undefined;

        if (fs.existsSync(membersFile)) {
          try {
            const data = JSON.parse(fs.readFileSync(membersFile, 'utf8'));
            if (typeof data.title === 'string' && data.title.trim()) {
              title = data.title.trim();
            }
            if (data.members && typeof data.members === 'object') {
              for (const [name, info] of Object.entries<any>(data.members)) {
                if (!info || typeof info !== 'object') continue;
                const convId = typeof info.conversation_id === 'string' ? info.conversation_id.toLowerCase() : '';
                const role = typeof info.role === 'string' ? info.role : name;
                // Exclude coordinator itself from child executorRefs
                if (!convId || convId === sessionId.toLowerCase() || role === 'coordinator') {
                  continue;
                }
                memberCount++;
                const mappedStatus = this.mapSwarmMemberStatus(info.status, info.killed);
                if (mappedStatus === 'running') {
                  workingMemberCount++;
                }
                const kind: ExecutorSessionRef['kind'] =
                  name === 'narrator' || role === 'narrator'
                    ? 'narrator'
                    : name === 'monitor' || role === 'monitor'
                      ? 'monitor'
                      : 'swarm_worker';
                if (kind === 'narrator') {
                  narratorConvId = convId;
                }
                if (typeof info.workspace === 'string' && this.isValidWorkspacePath(info.workspace)) {
                  childWorkspaces.set(convId, this.cleanWorkspacePath(info.workspace));
                }
                refMap.set(convId, {
                  conversationId: convId,
                  role,
                  model: typeof info.model === 'string' ? info.model : undefined,
                  state: typeof info.status === 'string' ? info.status : undefined,
                  status: mappedStatus,
                  kind,
                  sourceAuthority: 'swarm_member'
                });
              }
            }
          } catch {}
        }

        let boardMessageCount = 0;
        if (fs.existsSync(boardFile)) {
          try {
            const raw = fs.readFileSync(boardFile, 'utf8');
            for (const line of raw.split(/\r?\n/)) {
              if (line.trim()) boardMessageCount++;
            }
          } catch {}
        }

        let headline: string | undefined;
        let goalLine: string | undefined;
        let phaseLabel: string | undefined;
        let workstreamCount = 0;
        let hasOverview = false;

        const viewCandidates = [viewFile];
        if (narratorConvId) {
          viewCandidates.push(path.join(path.dirname(sp), narratorConvId, 'swarm_view', 'view.json'));
        }
        for (const vp of viewCandidates) {
          if (fs.existsSync(vp)) {
            try {
              const v = JSON.parse(fs.readFileSync(vp, 'utf8'));
              headline = typeof v.headline === 'string' ? v.headline : undefined;
              goalLine = typeof v.goal === 'string' ? v.goal : undefined;
              phaseLabel = typeof v.phase === 'string' ? v.phase : undefined;
              if (Array.isArray(v.workstreams)) workstreamCount = v.workstreams.length;
              hasOverview = true;
              break;
            } catch {}
          }
        }
        if (!hasOverview && fs.existsSync(planFile)) {
          try {
            const p = JSON.parse(fs.readFileSync(planFile, 'utf8'));
            goalLine = typeof p.goal === 'string' ? p.goal : undefined;
            workstreamCount = p.tasks && typeof p.tasks === 'object' ? Object.keys(p.tasks).length : 0;
            hasOverview = true;
          } catch {}
        }

        const isRemoteOnly =
          fs.existsSync(swarmMetaFile) && memberCount === 0 && boardMessageCount === 0 && !hasOverview;

        swarmSummary = {
          title,
          headline,
          goalLine,
          phaseLabel,
          memberCount,
          workingMemberCount,
          boardMessageCount,
          workstreamCount,
          hasOverview,
          isRemoteOnly
        };
      }
    }

    return {
      refs: Array.from(refMap.values()),
      swarmSummary,
      childWorkspaces
    };
  }

  private mergeExecutorRefLists(
    baseRefs?: ExecutorSessionRef[],
    overrideRefs?: ExecutorSessionRef[]
  ): ExecutorSessionRef[] | undefined {
    const mergedRefMap = new Map<string, ExecutorSessionRef>();
    for (const r of baseRefs || []) {
      mergedRefMap.set(r.conversationId.toLowerCase(), { ...r });
    }
    for (const r of overrideRefs || []) {
      const key = r.conversationId.toLowerCase();
      const prev = mergedRefMap.get(key);
      mergedRefMap.set(key, {
        ...prev,
        ...r,
        role: r.role || prev?.role,
        typeName: r.typeName || prev?.typeName,
        spawnStepIndex: prev?.spawnStepIndex ?? r.spawnStepIndex,
        status: r.status || prev?.status,
        sourceAuthority: r.sourceAuthority || prev?.sourceAuthority
      });
    }
    return mergedRefMap.size > 0 ? Array.from(mergedRefMap.values()) : undefined;
  }

  public buildSessionFromParsed(
    sessionId: string,
    sessionPath: string,
    mtime: Date,
    parsed: ParsedTranscriptResult,
    allSessionPaths?: string[]
  ): ChatSession {
    const pathsToScan = allSessionPaths && allSessionPaths.length > 0 ? allSessionPaths : [sessionPath];
    let planPath: string | undefined;
    let walkthroughPath: string | undefined;
    for (let i = pathsToScan.length - 1; i >= 0; i--) {
      const sp = pathsToScan[i];
      const pCandidate = path.join(sp, 'implementation_plan.md');
      const wCandidate = path.join(sp, 'walkthrough.md');
      if (!planPath && fs.existsSync(pCandidate)) {
        planPath = pCandidate;
      }
      if (!walkthroughPath && fs.existsSync(wCandidate)) {
        walkthroughPath = wCandidate;
      }
    }
    const hasPlan = Boolean(planPath);
    const hasWalkthrough = Boolean(walkthroughPath);

    const artifacts = this.scanMultiSessionArtifacts(pathsToScan, parsed.messages);
    const hasArtifacts = hasPlan || hasWalkthrough || artifacts.length > 0;

    const swarmAndSubagents = this.readSwarmSummarySync(sessionId, pathsToScan);
    const executorRefs = this.mergeExecutorRefLists(parsed.detectedExecutorRefs, swarmAndSubagents.refs);

    const effectivePromptForTitle = parsed.firstPrompt || parsed.firstTaskTitle || '';
    const title = effectivePromptForTitle ? this.generateSessionTitle(effectivePromptForTitle) : `Session ${sessionId.substring(0, 8)}`;
    const finalMachineName = this.resolveSessionMachineName(pathsToScan, parsed.detectedMachine, parsed.detectedWorkspace);
    const messageCount = parsed.userPromptCount || (parsed.messages && parsed.messages.length > 0 ? parsed.messages.length : (parsed.totalStepCount || 0));
    const isEmpty =
      messageCount === 0 &&
      parsed.userPromptCount === 0 &&
      !hasArtifacts &&
      !swarmAndSubagents.swarmSummary &&
      (!executorRefs || executorRefs.length === 0) &&
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
      paths: pathsToScan,
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
      hasArtifacts,
      planPath,
      walkthroughPath,
      artifacts,
      artifactCount: artifacts.length,
      parentId: parsed.detectedParentId,
      isEmpty,
      runtime,
      tokenUsage: parsed.tokenUsage,
      executorRefs,
      executorParentId: parsed.detectedExecutorParentId,
      executorStatus: parsed.executorStatus,
      stepCount: parsed.totalStepCount,
      latestAction: parsed.latestAction,
      swarmSummary: swarmAndSubagents.swarmSummary
    };
  }

  public mergeSessionMetadata(a: ChatSession, b: ChatSession): ChatSession {
    const aTime = (a.lastModified || a.createdAt || new Date(0)).getTime();
    const bTime = (b.lastModified || b.createdAt || new Date(0)).getTime();
    const latest = bTime >= aTime ? b : a;
    const older = bTime >= aTime ? a : b;

    const aCreated = (a.createdAt || a.lastModified || new Date(0)).getTime();
    const bCreated = (b.createdAt || b.lastModified || new Date(0)).getTime();
    const earliest = aCreated <= bCreated ? a : b;

    const firstPrompt =
      earliest.firstPrompt && earliest.firstPrompt !== '(No user prompt recorded)'
        ? earliest.firstPrompt
        : latest.firstPrompt || '(No user prompt recorded)';
    const title = firstPrompt !== '(No user prompt recorded)' ? this.generateSessionTitle(firstPrompt) : latest.title;

    const promptSet = new Set<string>();
    for (const p of [...(earliest.allPrompts || []), ...(latest.allPrompts || [])]) {
      if (p) promptSet.add(p);
    }
    const allPrompts = Array.from(promptSet);
    const userPromptCount = allPrompts.length > 0 ? allPrompts.length : Math.max(a.userPromptCount || 0, b.userPromptCount || 0);

    const artMap = new Map<string, SessionArtifactItem>();
    for (const art of [...(older.artifacts || []), ...(latest.artifacts || [])]) {
      const k = art.name.toLowerCase();
      const prev = artMap.get(k);
      if (!prev || art.mtime.getTime() >= prev.mtime.getTime()) {
        artMap.set(k, art);
      }
    }
    const artifacts = Array.from(artMap.values());
    const mergedPaths = Array.from(
      new Set([
        ...(older.paths || (older.path ? [older.path] : [])),
        ...(latest.paths || (latest.path ? [latest.path] : []))
      ])
    );

    return {
      ...older,
      ...latest,
      path: latest.path,
      paths: mergedPaths,
      title,
      firstPrompt,
      allPrompts,
      searchKeywords: `${older.searchKeywords || ''} ${latest.searchKeywords || ''}`.trim(),
      lastModified: new Date(Math.max(aTime, bTime)),
      createdAt: new Date(Math.min(aCreated, bCreated)),
      userPromptCount,
      messageCount: userPromptCount || Math.max(a.messageCount || 0, b.messageCount || 0),
      workspacePath: latest.workspacePath || older.workspacePath,
      workspaceName: latest.workspaceName || older.workspaceName,
      machineName: latest.machineName || older.machineName,
      hasArtifacts: Boolean(a.hasArtifacts || b.hasArtifacts || artifacts.length > 0),
      planPath: latest.planPath || older.planPath,
      walkthroughPath: latest.walkthroughPath || older.walkthroughPath,
      artifacts,
      artifactCount: artifacts.length,
      parentId: latest.parentId || older.parentId,
      isEmpty: Boolean(a.isEmpty && b.isEmpty),
      tokenUsage:
        (latest.tokenUsage?.peakContextTokens || 0) >= (older.tokenUsage?.peakContextTokens || 0)
          ? (latest.tokenUsage || older.tokenUsage)
          : older.tokenUsage,
      executorRefs: this.mergeExecutorRefLists(older.executorRefs, latest.executorRefs),
      executorParentId: userPromptCount > 0 ? undefined : (latest.executorParentId || older.executorParentId),
      executorRootId: latest.executorRootId || older.executorRootId,
      executorDepth: latest.executorDepth ?? older.executorDepth,
      executorRole: latest.executorRole || older.executorRole,
      executorTypeName: latest.executorTypeName || older.executorTypeName,
      executorStatus: latest.executorStatus || older.executorStatus,
      stepCount: Math.max(a.stepCount || 0, b.stepCount || 0) || undefined,
      latestAction: latest.latestAction || older.latestAction,
      treeTokenUsage: latest.treeTokenUsage || older.treeTokenUsage,
      swarmSummary: latest.swarmSummary || older.swarmSummary
    };
  }

  public scanMultiSessionArtifacts(sessionPaths: string[], messages?: ChatMessage[]): SessionArtifactItem[] {
    if (sessionPaths.length <= 1) {
      return this.scanSessionArtifacts(sessionPaths[0] || '', messages);
    }
    const dedupMap = new Map<string, SessionArtifactItem>();
    for (const sp of sessionPaths) {
      const items = this.scanSessionArtifacts(sp, messages);
      for (const item of items) {
        const key = item.name.toLowerCase();
        const existing = dedupMap.get(key);
        if (!existing || item.mtime.getTime() >= existing.mtime.getTime()) {
          dedupMap.set(key, item);
        }
      }
    }
    const categoryWeight: Record<string, number> = {
      document: 1,
      image: 2,
      video: 3,
      scratch: 4,
      other: 5
    };
    return Array.from(dedupMap.values()).sort((a, b) => {
      const wa = categoryWeight[a.category] || 99;
      const wb = categoryWeight[b.category] || 99;
      if (wa !== wb) return wa - wb;
      return b.mtime.getTime() - a.mtime.getTime();
    });
  }

  public async parseMultiSessionMetadata(
    sessionId: string,
    sessionPaths: string[],
    primaryPath: string,
    mtime: Date,
    explicitTargetFiles?: string[]
  ): Promise<ChatSession | null> {
    const targetFiles =
      explicitTargetFiles !== undefined
        ? explicitTargetFiles
        : sessionPaths.map((sp) => this.getTranscriptFilePath(sp)).filter((f): f is string => Boolean(f));

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

    if (targetFiles.length > 0) {
      try {
        parsed = await this.parseMultiTranscriptFilesAsync(targetFiles, sessionId, true);
      } catch (err) {
        console.warn(`Could not read transcript for session ${sessionId}:`, err);
      }
    }

    return this.buildSessionFromParsed(sessionId, primaryPath, mtime, parsed, sessionPaths);
  }

  public async parseSessionMetadata(
    sessionId: string,
    sessionPath: string,
    mtime: Date,
    explicitTargetFile?: string | null
  ): Promise<ChatSession | null> {
    const targetFile = explicitTargetFile !== undefined ? explicitTargetFile : this.getTranscriptFilePath(sessionPath);
    return this.parseMultiSessionMetadata(
      sessionId,
      [sessionPath],
      sessionPath,
      mtime,
      targetFile ? [targetFile] : []
    );
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

  private classifyUserPathMachine(matchedPath: string, username: string): string | undefined {
    if (!username) {
      return undefined;
    }
    const isWinPath = /^[a-zA-Z]:[\\\/]/.test(matchedPath);
    const isMacPath = /^\/Users\//i.test(matchedPath);
    const isLinuxPath = /^\/home\//i.test(matchedPath);
    let localUser = '';
    try {
      localUser = os.userInfo ? os.userInfo().username : '';
    } catch {}
    const localIsWin = process.platform === 'win32';
    const localIsMac = process.platform === 'darwin';

    const osMismatch =
      (isWinPath && !localIsWin) ||
      (isMacPath && !localIsMac) ||
      (isLinuxPath && (localIsWin || localIsMac));

    if (localUser && username.toLowerCase() !== localUser.toLowerCase()) {
      const pcName = `${username}-PC`;
      return this.isValidMachineName(pcName) ? pcName : undefined;
    }

    if (osMismatch) {
      const osTag = isWinPath ? 'Windows' : isMacPath ? 'Mac' : 'Linux';
      const label = `${username}-${osTag}`;
      return this.isValidMachineName(label) ? label : undefined;
    }

    return undefined;
  }

  public extractMachineFromWorkspacePath(workspacePath?: string): string | undefined {
    if (!workspacePath || typeof workspacePath !== 'string') {
      return undefined;
    }
    const trimmed = workspacePath.trim();
    const winMatch = trimmed.match(/^([a-zA-Z]:[\\\/]Users[\\\/]([a-zA-Z0-9_\-\.]+))/i);
    if (winMatch && winMatch[2]) {
      return this.classifyUserPathMachine(winMatch[1], winMatch[2]);
    }
    const macMatch = trimmed.match(/^(\/Users\/([a-zA-Z0-9_\-\.]+))/i);
    if (macMatch && macMatch[2]) {
      return this.classifyUserPathMachine(macMatch[1], macMatch[2]);
    }
    const linuxMatch = trimmed.match(/^(\/home\/([a-zA-Z0-9_\-\.]+))/i);
    if (linuxMatch && linuxMatch[2]) {
      return this.classifyUserPathMachine(linuxMatch[1], linuxMatch[2]);
    }
    return undefined;
  }

  public resolveSessionMachineName(
    sessionPaths: string[],
    transcriptMachine?: string,
    workspacePath?: string
  ): string {
    for (const sp of sessionPaths) {
      const meta = this.readSessionOriginMeta(sp);
      if (meta && this.isValidMachineName(meta.machineName)) {
        return meta.machineName;
      }
    }
    if (transcriptMachine && this.isValidMachineName(transcriptMachine)) {
      return transcriptMachine;
    }
    const wsMachine = this.extractMachineFromWorkspacePath(workspacePath);
    if (wsMachine && this.isValidMachineName(wsMachine)) {
      return wsMachine;
    }
    return this.getLocalMachineName();
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

    const appDataMatch = content.match(
      /App Data Directory:\s*([a-zA-Z]:[\\\/]Users[\\\/]([a-zA-Z0-9_\-\.]+)|\/Users\/([a-zA-Z0-9_\-\.]+)|\/home\/([a-zA-Z0-9_\-\.]+))/i
    );
    if (appDataMatch) {
      const matchedPath = appDataMatch[1];
      const username = appDataMatch[2] || appDataMatch[3] || appDataMatch[4];
      if (username) {
        const classified = this.classifyUserPathMachine(matchedPath, username);
        if (classified) {
          return classified;
        }
        return this.getLocalMachineName();
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
    const candidatePaths: string[] = [];
    const seenPaths = new Set<string>();

    const addCandidate = (p: string) => {
      const norm = path.resolve(p).toLowerCase();
      if (!seenPaths.has(norm) && fs.existsSync(p)) {
        seenPaths.add(norm);
        candidatePaths.push(p);
      }
    };

    for (const dir of targetDirs) {
      addCandidate(path.join(dir, sessionId));
    }

    for (const entry of this.sessionCache.values()) {
      if (entry && entry.session && entry.session.id === sessionId && entry.session.path) {
        addCandidate(entry.session.path);
      }
    }

    if (candidatePaths.length === 0) {
      return null;
    }

    let primaryPath = candidatePaths[0];
    let primaryDirMtime = new Date();
    let maxDirMtimeMs = 0;
    let maxFileMtime = 0;
    let totalFileSize = 0;
    const fragmentFiles: Array<{ file: string; mtimeMs: number }> = [];

    for (const sp of candidatePaths) {
      let spMtimeMs = 0;
      let spMtime = new Date();
      try {
        const dStat = await fs.promises.stat(sp);
        spMtimeMs = dStat.mtimeMs;
        spMtime = dStat.mtime;
      } catch {}

      const tf = this.getTranscriptFilePath(sp, true);
      if (tf) {
        try {
          const fStat = await fs.promises.stat(tf);
          totalFileSize += fStat.size;
          fragmentFiles.push({ file: tf, mtimeMs: fStat.mtimeMs });
          if (fStat.mtimeMs >= maxFileMtime) {
            maxFileMtime = fStat.mtimeMs;
            primaryPath = sp;
            primaryDirMtime = new Date(fStat.mtimeMs);
          }
        } catch {}
      }

      if (spMtimeMs >= maxDirMtimeMs) {
        maxDirMtimeMs = spMtimeMs;
        if (fragmentFiles.length === 0) {
          primaryPath = sp;
          primaryDirMtime = spMtime;
        }
      }
    }

    if (fragmentFiles.length === 0) {
      const session = await this.parseMultiSessionMetadata(sessionId, candidatePaths, primaryPath, primaryDirMtime, []);
      return session ? { session, messages: [] } : null;
    }

    fragmentFiles.sort((a, b) => a.mtimeMs - b.mtimeMs);
    const orderedFiles = fragmentFiles.map((f) => f.file);

    // Single-pass parse across all merged transcript fragments
    const parsed = await this.parseMultiTranscriptFilesAsync(orderedFiles, sessionId, false);
    await this.enrichMessagesFromGeneratedDir(candidatePaths, parsed.messages);
    const session = this.buildSessionFromParsed(sessionId, primaryPath, primaryDirMtime, parsed, candidatePaths);
    session.messageCount = session.userPromptCount || parsed.messages.filter((m) => m.type === 'USER_INPUT').length || parsed.messages.length;

    // Preserve and synchronize lineage and executor properties from existing cache
    const cacheKey = `${sessionId}_${primaryPath}`;
    const existingCacheEntry = this.sessionCache.get(cacheKey) || Array.from(this.sessionCache.values()).find((e) => e?.session?.id === sessionId);
    if (existingCacheEntry?.session) {
      if (!session.rootId && existingCacheEntry.session.rootId) {
        session.rootId = existingCacheEntry.session.rootId;
      }
      if ((!session.childIds || session.childIds.length === 0) && existingCacheEntry.session.childIds && existingCacheEntry.session.childIds.length > 0) {
        session.childIds = [...existingCacheEntry.session.childIds];
      }
      if (!session.threadTitle && existingCacheEntry.session.threadTitle) {
        session.threadTitle = existingCacheEntry.session.threadTitle;
      }
      if (!session.parentId && existingCacheEntry.session.parentId) {
        session.parentId = existingCacheEntry.session.parentId;
      }
      if (session.userPromptCount === 0) {
        if (!session.executorRole && existingCacheEntry.session.executorRole) {
          session.executorRole = existingCacheEntry.session.executorRole;
        }
        if (!session.executorTypeName && existingCacheEntry.session.executorTypeName) {
          session.executorTypeName = existingCacheEntry.session.executorTypeName;
        }
      }
      if (!session.workspacePath && existingCacheEntry.session.workspacePath) {
        session.workspacePath = existingCacheEntry.session.workspacePath;
        session.workspaceName = existingCacheEntry.session.workspaceName;
      }
      if (!session.treeTokenUsage && existingCacheEntry.session.treeTokenUsage) {
        session.treeTokenUsage = existingCacheEntry.session.treeTokenUsage;
      }
      if (!session.swarmSummary && existingCacheEntry.session.swarmSummary) {
        session.swarmSummary = existingCacheEntry.session.swarmSummary;
      }
    }

    // If session has parentId but rootId is still not resolved, trace up to root
    if (session.parentId && !session.rootId) {
      let currId: string | undefined = session.parentId;
      const visited = new Set<string>([sessionId]);
      let rootCandidate = sessionId;
      while (currId && !visited.has(currId)) {
        visited.add(currId);
        rootCandidate = currId;
        const parentEntry = Array.from(this.sessionCache.values()).find((e) => e?.session?.id === currId);
        currId = parentEntry?.session?.parentId;
      }
      session.rootId = rootCandidate;
    } else if (!session.parentId && !session.rootId) {
      session.rootId = session.id;
    }

    // Bidirectional child link: ensure parent's childIds in cache includes this session.id
    if (session.parentId) {
      for (const entry of this.sessionCache.values()) {
        if (entry?.session && entry.session.id === session.parentId) {
          if (!entry.session.childIds) {
            entry.session.childIds = [];
          }
          if (!entry.session.childIds.includes(session.id)) {
            entry.session.childIds.push(session.id);
          }
        }
      }
    }

    for (const sp of candidatePaths) {
      this.attachUserMedia(sp, parsed.messages);
    }

    const artifacts = this.scanMultiSessionArtifacts(candidatePaths, parsed.messages);
    session.artifacts = artifacts;
    session.artifactCount = artifacts.length;
    if (artifacts.length > 0) {
      session.hasArtifacts = true;
    }

    for (const [k, v] of this.sessionCache.entries()) {
      if (v?.session?.id === sessionId && k !== cacheKey) {
        this.sessionCache.delete(k);
      }
    }

    this.sessionCache.set(cacheKey, {
      session,
      mtime: maxDirMtimeMs,
      fileMtime: maxFileMtime,
      fileSize: totalFileSize,
      auxSignature: this.computeAuxSignature(candidatePaths),
      targetFilePath: orderedFiles[orderedFiles.length - 1],
      schemaVersion: SessionScanner.CACHE_SCHEMA_VERSION
    });
    this.saveCacheToDiskDebounced(500);

    return { session, messages: parsed.messages };
  }

  private async enrichMessagesFromGeneratedDir(sessionPaths: string[], messages: ChatMessage[]): Promise<void> {
    if (!messages || messages.length === 0) return;
    const msgEntries: Array<{ stepIndex?: number; message?: string; messageTitle?: string; recipient?: string }> = [];
    for (const sp of sessionPaths) {
      const messagesDir = path.join(sp, '.system_generated', 'messages');
      if (!fs.existsSync(messagesDir)) continue;
      try {
        const files = await fs.promises.readdir(messagesDir);
        for (const f of files.sort()) {
          if (!f.endsWith('.json')) continue;
          try {
            const raw = await fs.promises.readFile(path.join(messagesDir, f), 'utf8');
            const parsed = JSON.parse(raw);
            const messageText =
              typeof parsed.Message === 'string'
                ? parsed.Message
                : typeof parsed.message === 'string'
                  ? parsed.message
                  : typeof parsed.content === 'string'
                    ? parsed.content
                    : undefined;
            if (!messageText) continue;
            msgEntries.push({
              stepIndex: typeof parsed.stepIndex === 'number' ? parsed.stepIndex : (typeof parsed.step_index === 'number' ? parsed.step_index : undefined),
              message: SessionScanner.unquoteToolArg(messageText),
              messageTitle: typeof parsed.renderDetails?.messageTitle === 'string' ? parsed.renderDetails.messageTitle : undefined,
              recipient: typeof parsed.Recipient === 'string' ? SessionScanner.unquoteToolArg(parsed.Recipient) : undefined
            });
          } catch {}
        }
      } catch {}
    }
    if (msgEntries.length === 0) return;

    for (const entry of msgEntries) {
      let targetMsg: ChatMessage | undefined;
      if (entry.stepIndex !== undefined) {
        targetMsg = messages.find((m) => m.index === entry.stepIndex);
      }
      if (!targetMsg) {
        targetMsg = messages.find((m) =>
          m.toolCalls?.some((tc) => tc.name === 'send_message' && (!entry.recipient || (typeof tc.args === 'object' && tc.args?.Recipient === entry.recipient)))
        );
      }
      if (targetMsg?.toolCalls) {
        const sendTc = targetMsg.toolCalls.find((tc) => tc.name === 'send_message');
        if (sendTc) {
          const argsObj = typeof sendTc.args === 'string'
            ? (() => { try { return JSON.parse(sendTc.args); } catch { return {}; } })()
            : { ...(sendTc.args || {}) };
          if (entry.message) {
            argsObj.Message = entry.message;
          }
          if (entry.messageTitle) {
            argsObj.MessageTitle = entry.messageTitle;
            sendTc.description = entry.messageTitle;
          }
          sendTc.args = argsObj;
        }
      }
    }
  }

  public resolveExecutorLinks(sessions: ChatSession[]): void {
    const sessionMap = new Map<string, ChatSession>();
    for (const s of sessions) {
      sessionMap.set(s.id.toLowerCase(), s);
    }

    const getRefAuthority = (ref: ExecutorSessionRef): number => {
      if (ref.sourceAuthority === 'subagent_descriptor' || ref.sourceAuthority === 'swarm_member') {
        return 4;
      }
      if (ref.sourceAuthority === 'invoke_subagent') {
        return 3;
      }
      if (ref.sourceAuthority === 'inferred_sender') {
        return 1;
      }
      return ref.kind === 'swarm_worker' || ref.kind === 'narrator' || ref.kind === 'monitor' ? 4 : 3;
    };

    const bestLinks = new Map<string, { parentId: string; authority: number; parentCreatedMs: number }>();
    const wouldCreateCycle = (parentIdLower: string, childIdLower: string): boolean => {
      let curr: string | undefined = parentIdLower;
      const seen = new Set<string>();
      while (curr && !seen.has(curr)) {
        if (curr === childIdLower) {
          return true;
        }
        seen.add(curr);
        curr = bestLinks.get(curr)?.parentId.toLowerCase();
      }
      return false;
    };

    // Sanitize inferred executorParentId and seed baseline authority=1 links
    for (const s of sessions) {
      const sid = s.id.toLowerCase();
      const pid = s.executorParentId?.toLowerCase();
      if (!pid || pid === sid || s.userPromptCount > 0 || !sessionMap.has(pid)) {
        s.executorParentId = undefined;
        continue;
      }
      const parent = sessionMap.get(pid)!;
      if (wouldCreateCycle(pid, sid)) {
        s.executorParentId = undefined;
        continue;
      }
      const parentCreatedMs = (parent.createdAt || parent.lastModified || new Date(0)).getTime();
      bestLinks.set(sid, { parentId: parent.id, authority: 1, parentCreatedMs });
    }

    // Pass A: Authority-ranked, anti-hijack outbound links from executorRefs
    const subagentWorkspaceHints = new Map<string, string>();
    for (const parent of sessions) {
      if (!parent.executorRefs || parent.executorRefs.length === 0) continue;
      for (const sp of parent.paths || (parent.path ? [parent.path] : [])) {
        if (!sp) continue;
        const subDesc = this.readSubagentDescriptors(sp);
        for (const [cid, ws] of subDesc.workspacePaths.entries()) {
          if (!subagentWorkspaceHints.has(cid)) {
            subagentWorkspaceHints.set(cid, ws);
          }
        }
      }
      const parentIdLower = parent.id.toLowerCase();
      const parentCreatedMs = (parent.createdAt || parent.lastModified || new Date(0)).getTime();
      for (const ref of parent.executorRefs) {
        const childId = ref.conversationId.toLowerCase();
        if (childId === parentIdLower) continue;
        const child = sessionMap.get(childId);
        if (!child) continue;

        // Never allow subagents or refs to hijack user root sessions (userPromptCount > 0)
        if (child.userPromptCount > 0) continue;

        const newAuth = getRefAuthority(ref);
        const childCreatedMs = (child.createdAt || child.lastModified || new Date(0)).getTime();
        const prev = bestLinks.get(childId);

        if (prev && prev.parentId.toLowerCase() !== parentIdLower) {
          if (newAuth < prev.authority) continue;
          if (
            newAuth === prev.authority &&
            prev.parentCreatedMs <= childCreatedMs + 60000 &&
            parentCreatedMs > prev.parentCreatedMs
          ) {
            continue;
          }
        }

        if (wouldCreateCycle(parentIdLower, childId)) continue;

        bestLinks.set(childId, { parentId: parent.id, authority: newAuth, parentCreatedMs });
        child.executorParentId = parent.id;
        if (ref.role && !child.executorRole) {
          child.executorRole = ref.role;
        }
        if (ref.typeName && !child.executorTypeName) {
          child.executorTypeName = ref.typeName;
        }
        if ((ref.kind === 'swarm_worker' || ref.kind === 'narrator' || ref.kind === 'monitor') && ref.status) {
          child.executorStatus = ref.status;
        }
        if (child.title.startsWith('Session ') && (child.executorRole || ref.role)) {
          child.title = child.executorRole || ref.role || child.title;
        }
      }
    }

    // Pass B: Ensure parents referenced only via child.executorParentId also list the child in executorRefs
    for (const child of sessions) {
      const pid = child.executorParentId?.toLowerCase();
      if (!pid || pid === child.id.toLowerCase()) {
        child.executorParentId = undefined;
        continue;
      }
      const parent = sessionMap.get(pid);
      if (!parent) continue;
      if (!parent.executorRefs) {
        parent.executorRefs = [];
      }
      if (!parent.executorRefs.some((r) => r.conversationId.toLowerCase() === child.id.toLowerCase())) {
        parent.executorRefs.push({
          conversationId: child.id,
          role: child.executorRole,
          typeName: child.executorTypeName,
          kind: 'subagent',
          sourceAuthority: 'inferred_sender'
        });
      }
    }

    // Pass C: Cycle-safe executorRootId, executorDepth, and inherited workspacePath/workspaceName
    for (const s of sessions) {
      const pathChain: ChatSession[] = [s];
      const visited = new Set<string>([s.id.toLowerCase()]);
      let curr: ChatSession = s;
      while (curr.executorParentId && sessionMap.has(curr.executorParentId.toLowerCase())) {
        const parent = sessionMap.get(curr.executorParentId.toLowerCase())!;
        if (visited.has(parent.id.toLowerCase())) {
          // Break cycle deterministically by preserving userPromptCount > 0 or earliest createdAt as root
          const cycleStartIdx = pathChain.findIndex((n) => n.id.toLowerCase() === parent.id.toLowerCase());
          const cycleNodes = pathChain.slice(Math.max(0, cycleStartIdx));
          cycleNodes.sort((a, b) => {
            const aUser = a.userPromptCount > 0 ? 1 : 0;
            const bUser = b.userPromptCount > 0 ? 1 : 0;
            if (aUser !== bUser) return bUser - aUser;
            const aTime = (a.createdAt || a.lastModified || new Date(0)).getTime();
            const bTime = (b.createdAt || b.lastModified || new Date(0)).getTime();
            return aTime - bTime;
          });
          cycleNodes[0].executorParentId = undefined;
          break;
        }
        visited.add(parent.id.toLowerCase());
        pathChain.push(parent);
        curr = parent;
      }
    }

    for (const s of sessions) {
      let curr: ChatSession = s;
      let depth = 0;
      const visited = new Set<string>([curr.id.toLowerCase()]);
      while (curr.executorParentId && sessionMap.has(curr.executorParentId.toLowerCase())) {
        const parent = sessionMap.get(curr.executorParentId.toLowerCase())!;
        if (visited.has(parent.id.toLowerCase())) {
          curr.executorParentId = undefined;
          break;
        }
        visited.add(parent.id.toLowerCase());
        curr = parent;
        depth++;
      }
      s.executorRootId = curr.id;
      s.executorDepth = depth;

      if (!s.workspacePath) {
        const hintedWs = subagentWorkspaceHints.get(s.id.toLowerCase());
        if (hintedWs) {
          s.workspacePath = hintedWs;
          s.workspaceName = path.basename(hintedWs);
        } else if (depth > 0) {
          let walk: ChatSession | undefined = s;
          const seenWs = new Set<string>();
          while (walk && walk.executorParentId && !seenWs.has(walk.id.toLowerCase())) {
            seenWs.add(walk.id.toLowerCase());
            const p = sessionMap.get(walk.executorParentId.toLowerCase());
            if (p?.workspacePath) {
              s.workspacePath = p.workspacePath;
              s.workspaceName = p.workspaceName || path.basename(p.workspacePath);
              break;
            }
            walk = p;
          }
        }
      }
    }

    // Prune materialized executorRefs whose winning executorParentId belongs to a different parent
    for (const s of sessions) {
      if (!s.executorRefs || s.executorRefs.length === 0) continue;
      const sidLower = s.id.toLowerCase();
      s.executorRefs = s.executorRefs.filter((ref) => {
        const child = sessionMap.get(ref.conversationId.toLowerCase());
        return !child || (child.executorParentId && child.executorParentId.toLowerCase() === sidLower);
      });
    }

    // Pass D: Propagate waiting status to parents with running descendants, populate telemetry & treeTokenUsage
    const parentsWithRunningDescendant = new Set<string>();
    for (const s of sessions) {
      const hasDirectRunningRef = Boolean(s.executorRefs?.some((r) => r.status === 'running'));
      if (s.executorStatus === 'running' || hasDirectRunningRef) {
        if (hasDirectRunningRef) {
          parentsWithRunningDescendant.add(s.id.toLowerCase());
        }
        let walkPid = s.executorParentId?.toLowerCase();
        const seenAnc = new Set<string>([s.id.toLowerCase()]);
        while (walkPid && !seenAnc.has(walkPid)) {
          seenAnc.add(walkPid);
          parentsWithRunningDescendant.add(walkPid);
          walkPid = sessionMap.get(walkPid)?.executorParentId?.toLowerCase();
        }
      }
    }
    for (const s of sessions) {
      if (parentsWithRunningDescendant.has(s.id.toLowerCase()) && (!s.executorStatus || s.executorStatus === 'done')) {
        s.executorStatus = 'waiting';
      }
    }
    const treeBuckets = new Map<string, ChatSession[]>();
    for (const s of sessions) {
      if (s.executorRefs) {
        for (const ref of s.executorRefs) {
          const child = sessionMap.get(ref.conversationId.toLowerCase());
          if (!child) continue;
          ref.title = child.title;
          ref.role = ref.role || child.executorRole;
          ref.typeName = ref.typeName || child.executorTypeName;
          if (!((ref.kind === 'swarm_worker' || ref.kind === 'narrator' || ref.kind === 'monitor') && ref.state)) {
            ref.status = child.executorStatus || ref.status || 'done';
          }
          ref.stepCount = child.stepCount ?? child.messageCount;
          ref.latestAction = child.latestAction || ref.latestAction;
          ref.lastActiveAt = child.lastModified ? child.lastModified.toISOString() : ref.lastActiveAt;
          ref.tokenUsage = child.tokenUsage;
        }
      }
      const rootKey = (s.executorRootId || s.id).toLowerCase();
      const bucket = treeBuckets.get(rootKey) || [];
      bucket.push(s);
      treeBuckets.set(rootKey, bucket);
    }

    for (const [rootKey, members] of treeBuckets.entries()) {
      const rootSession = sessionMap.get(rootKey);
      if (!rootSession) continue;
      if (members.length <= 1) {
        rootSession.treeTokenUsage = undefined;
        continue;
      }
      let totalInputTokens = 0;
      let totalCacheReadTokens = 0;
      let totalOutputTokens = 0;
      const modelBreakdown: Record<string, ModelTokenTotals> = {};

      for (const m of members) {
        const tu = m.tokenUsage;
        if (!tu) continue;
        const mIn = SessionScanner.coerceNonNegativeInt(tu.totalInputTokens);
        const mCache = SessionScanner.coerceNonNegativeInt(tu.totalCacheReadTokens);
        const mOut = SessionScanner.coerceNonNegativeInt(tu.totalOutputTokens);
        totalInputTokens += mIn;
        totalCacheReadTokens += mCache;
        totalOutputTokens += mOut;
        if (tu.modelBreakdown && Object.keys(tu.modelBreakdown).length > 0) {
          for (const [mk, mv] of Object.entries(tu.modelBreakdown)) {
            if (!mv) continue;
            const targetKey = mk === 'unknown' && tu.primaryModel ? tu.primaryModel : mk;
            if (!modelBreakdown[targetKey]) {
              modelBreakdown[targetKey] = { inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, stepCount: 0 };
            }
            modelBreakdown[targetKey].inputTokens += SessionScanner.coerceNonNegativeInt(mv.inputTokens);
            modelBreakdown[targetKey].cacheReadTokens += SessionScanner.coerceNonNegativeInt(mv.cacheReadTokens);
            modelBreakdown[targetKey].outputTokens += SessionScanner.coerceNonNegativeInt(mv.outputTokens);
            modelBreakdown[targetKey].stepCount += SessionScanner.coerceNonNegativeInt(mv.stepCount);
          }
        } else if (mIn > 0 || mCache > 0 || mOut > 0) {
          const targetKey = tu.primaryModel || 'unknown';
          if (!modelBreakdown[targetKey]) {
            modelBreakdown[targetKey] = { inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, stepCount: 0 };
          }
          modelBreakdown[targetKey].inputTokens += mIn;
          modelBreakdown[targetKey].cacheReadTokens += mCache;
          modelBreakdown[targetKey].outputTokens += mOut;
          modelBreakdown[targetKey].stepCount += SessionScanner.coerceNonNegativeInt(tu.plannerStepCount);
        }
      }

      const cumulativeTokens = totalInputTokens + totalCacheReadTokens + totalOutputTokens;
      const ctxSum = totalInputTokens + totalCacheReadTokens;
      const overallCacheHitRatio = ctxSum > 0 ? Math.round((totalCacheReadTokens / ctxSum) * 1000) / 10 : 0;
      rootSession.treeTokenUsage = {
        executorCount: members.length,
        totalInputTokens,
        totalCacheReadTokens,
        totalOutputTokens,
        cumulativeTokens,
        overallCacheHitRatio,
        modelBreakdown: Object.keys(modelBreakdown).length > 0 ? modelBreakdown : undefined
      };
    }
  }

  public hasAnyArtifacts(sessionPath: string): boolean {
    const planPath = path.join(sessionPath, 'implementation_plan.md');
    const walkthroughPath = path.join(sessionPath, 'walkthrough.md');
    if (fs.existsSync(planPath) || fs.existsSync(walkthroughPath)) {
      return true;
    }
    try {
      const entries = fs.readdirSync(sessionPath);
      const artifactExts = new Set([
        '.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif', '.bmp', '.ico',
        '.mp4', '.webm', '.mov', '.mkv',
        '.md', '.txt', '.json', '.yaml', '.yml', '.csv', '.pdf',
        '.mmd', '.mermaid'
      ]);
      for (const e of entries) {
        if (
          e === '.brainhub_meta.json' ||
          e === '.sessions_index_cache.json' ||
          e === '.sessions_scan.lock' ||
          e === '.antigravity_sync_state.json' ||
          e.startsWith('.system_generated') ||
          e === '.git' ||
          e === 'node_modules' ||
          e.toLowerCase() === 'metadata.json'
        ) {
          continue;
        }
        if (['.user_uploaded', '.tempmediaStorage', 'tempmediaStorage', 'artifacts', 'scratch'].includes(e)) {
          const sub = path.join(sessionPath, e);
          if (fs.existsSync(sub) && fs.readdirSync(sub).length > 0) return true;
          continue;
        }
        if (e.startsWith('.')) continue;
        const ext = path.extname(e).toLowerCase();
        if (artifactExts.has(ext)) return true;
      }
    } catch {}
    return false;
  }

  public scanSessionArtifacts(sessionPath: string, messages?: ChatMessage[]): SessionArtifactItem[] {
    const artifacts: SessionArtifactItem[] = [];
    if (!sessionPath || !fs.existsSync(sessionPath)) {
      return artifacts;
    }

    const promptMap = new Map<string, string>();
    if (messages && Array.isArray(messages)) {
      for (const msg of messages) {
        if (msg.toolCalls && Array.isArray(msg.toolCalls)) {
          for (const tc of msg.toolCalls) {
            if (tc.name === 'generate_image' && tc.args) {
              const argsObj = typeof tc.args === 'string' ? (() => { try { return JSON.parse(tc.args); } catch { return {}; } })() : tc.args;
              const imgName = argsObj.ImageName || argsObj.imageName || argsObj.name;
              const prompt = argsObj.Prompt || argsObj.prompt;
              if (imgName && prompt) {
                promptMap.set(String(imgName).toLowerCase(), String(prompt));
              }
            } else if (tc.name === 'browser_subagent' && tc.args) {
              const argsObj = typeof tc.args === 'string' ? (() => { try { return JSON.parse(tc.args); } catch { return {}; } })() : tc.args;
              const recName = argsObj.RecordingName || argsObj.recordingName;
              const taskSummary = argsObj.TaskSummary || argsObj.Task || argsObj.task;
              if (recName && taskSummary) {
                promptMap.set(String(recName).toLowerCase(), String(taskSummary));
              }
            }
          }
        }
      }
    }

    const imageExts = new Set(['.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif', '.bmp', '.ico']);
    const videoExts = new Set(['.mp4', '.webm', '.mov', '.mkv']);
    const docExts = new Set(['.md', '.txt', '.json', '.yaml', '.yml', '.csv', '.pdf']);

    const getMime = (ext: string): string => {
      switch (ext) {
        case '.png': return 'image/png';
        case '.jpg':
        case '.jpeg': return 'image/jpeg';
        case '.webp': return 'image/webp';
        case '.svg': return 'image/svg+xml';
        case '.gif': return 'image/gif';
        case '.mp4': return 'video/mp4';
        case '.webm': return 'video/webm';
        case '.md': return 'text/markdown';
        case '.json': return 'application/json';
        case '.txt': return 'text/plain';
        default: return 'application/octet-stream';
      }
    };

    const processFile = (filePath: string, filename: string, defaultSource: SessionArtifactItem['source']) => {
      try {
        const stat = fs.statSync(filePath);
        if (!stat.isFile()) return;

        const ext = path.extname(filename).toLowerCase();
        const baseNoExt = path.basename(filename, ext).toLowerCase();
        let category: SessionArtifactItem['category'] = 'other';
        let source: SessionArtifactItem['source'] = defaultSource;

        if (imageExts.has(ext)) {
          if (ext === '.webp' && (filename.toLowerCase().includes('recording') || filename.toLowerCase().includes('browser') || promptMap.has(baseNoExt))) {
            category = 'video';
          } else {
            category = 'image';
          }
        } else if (videoExts.has(ext)) {
          category = 'video';
        } else if (docExts.has(ext)) {
          category = 'document';
          if (filename.toLowerCase() === 'implementation_plan.md') {
            source = 'plan';
          } else if (filename.toLowerCase() === 'walkthrough.md') {
            source = 'walkthrough';
          }
        } else if (defaultSource === 'scratch') {
          category = 'scratch';
        }

        let prompt = promptMap.get(baseNoExt);
        if (!prompt) {
          for (const [key, val] of promptMap.entries()) {
            if (baseNoExt.includes(key) || key.includes(baseNoExt)) {
              prompt = val;
              break;
            }
          }
        }

        artifacts.push({
          name: filename,
          filePath,
          category,
          source,
          sizeBytes: stat.size,
          mtime: stat.mtime,
          prompt,
          mimeType: getMime(ext)
        });
      } catch {}
    };

    try {
      const rootEntries = fs.readdirSync(sessionPath, { withFileTypes: true });
      for (const entry of rootEntries) {
        if (entry.name.startsWith('.system_generated') || entry.name === '.git' || entry.name === 'node_modules') {
          continue;
        }
        if (entry.isFile()) {
          if (entry.name === 'metadata.json' || entry.name === '.brainhub_meta.json' || entry.name.startsWith('.')) continue;
          processFile(path.join(sessionPath, entry.name), entry.name, 'ai_generated');
        }
      }
    } catch {}

    const subDirs: { relPath: string; source: SessionArtifactItem['source'] }[] = [
      { relPath: '.user_uploaded', source: 'user_uploaded' },
      { relPath: '.tempmediaStorage', source: 'user_uploaded' },
      { relPath: 'tempmediaStorage', source: 'user_uploaded' },
      { relPath: 'artifacts', source: 'ai_generated' },
      { relPath: 'scratch', source: 'scratch' }
    ];

    for (const sub of subDirs) {
      const fullSubPath = path.join(sessionPath, sub.relPath);
      if (fs.existsSync(fullSubPath)) {
        try {
          const entries = fs.readdirSync(fullSubPath, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isFile()) {
              processFile(path.join(fullSubPath, entry.name), entry.name, sub.source);
            }
          }
        } catch {}
      }
    }

    const categoryWeight: Record<string, number> = {
      document: 1,
      image: 2,
      video: 3,
      scratch: 4,
      other: 5
    };

    artifacts.sort((a, b) => {
      const wa = categoryWeight[a.category] || 99;
      const wb = categoryWeight[b.category] || 99;
      if (wa !== wb) return wa - wb;
      return b.mtime.getTime() - a.mtime.getTime();
    });

    return artifacts;
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

    // Reject bogus placeholder or system/CI paths (while allowing /var/www/...)
    if (/^\/(checkout|my-workspace|workspace|path\/to|app|root|tmp|etc|proc|sys|dev|home\/runner)(\/|$)/i.test(normalized)) {
      return false;
    }
    if (/^\/var(\/|$)/i.test(normalized) && !/^\/var\/www\/[^\/]+/i.test(normalized)) {
      return false;
    }

    // On Windows, POSIX-style paths starting with '/' without a drive letter are invalid unless they are genuine macOS/Linux/DevContainer/WSL paths
    if (
      process.platform === 'win32' &&
      normalized.startsWith('/') &&
      !normalized.startsWith('//') &&
      !/^\/(users|home)\/[^\/]+\/[^\/]+/i.test(normalized) &&
      !/^\/(workspaces|mnt|opt|srv|var\/www)\/[^\/]+/i.test(normalized)
    ) {
      return false;
    }

    // Ignore Windows / System directories
    if (normalized.startsWith('c:/windows') || normalized.startsWith('c:/program files') || normalized.startsWith('c:/programdata')) {
      return false;
    }

    // Ignore temporary directories
    if (normalized.startsWith('/tmp') || normalized.includes('/tempmediastorage')) {
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

    // Layer 1: Look inside <user_information> first (highest fidelity workspace declarations)
    const userInfoMatch = content.match(/<user_information>([\s\S]*?)<\/user_information>/i);
    if (userInfoMatch) {
      const infoScope = userInfoMatch[1];

      // 1A: Multi-line bullet list under "Active Workspaces:"
      const multiLineActiveWs = infoScope.match(/Active Workspaces:\s*((?:\r?\n\s*-\s*[^\r\n<]+)+)/i);
      if (multiLineActiveWs && multiLineActiveWs[1]) {
        const bulletLines = multiLineActiveWs[1].split(/\r?\n/);
        for (const line of bulletLines) {
          const m = line.match(/^\s*-\s*([a-zA-Z]:[\\\/][^\r\n<]+|\/[a-zA-Z0-9_\-\.\/]+)/);
          if (m && this.isValidWorkspacePath(m[1])) {
            return this.cleanWorkspacePath(m[1]);
          }
        }
      }

      // 1B: Single-line workspace / working directory declarations inside <user_information>
      const infoSingleLineWs = infoScope.match(
        /(?:Command Working Directory|Active Workspace|Working Directory|Workspace Root):\s*([a-zA-Z]:[\\\/][^\r\n<]+|\/[a-zA-Z0-9_\-\.\/]+)/i
      );
      if (infoSingleLineWs && this.isValidWorkspacePath(infoSingleLineWs[1])) {
        return this.cleanWorkspacePath(infoSingleLineWs[1]);
      }

      // 1C: Explicit path mapping "d:/my-workspace -> project-repo" inside <user_information>
      const mappingMatch = infoScope.match(/([a-zA-Z]:[\\\/][^\r\n->]+?)\s*->/);
      if (mappingMatch && this.isValidWorkspacePath(mappingMatch[1])) {
        return this.cleanWorkspacePath(mappingMatch[1]);
      }

      const posixMappingMatch = infoScope.match(/(\/[a-zA-Z0-9_\-\.\/]+)\s*->/);
      if (posixMappingMatch && this.isValidWorkspacePath(posixMappingMatch[1])) {
        return this.cleanWorkspacePath(posixMappingMatch[1]);
      }
    }

    // Layer 2: Multi-line "Active Workspaces:" or single-line declarations anywhere in content
    const globalMultiLineWs = content.match(/Active Workspaces:\s*((?:\r?\n\s*-\s*[^\r\n<]+)+)/i);
    if (globalMultiLineWs && globalMultiLineWs[1]) {
      const bulletLines = globalMultiLineWs[1].split(/\r?\n/);
      for (const line of bulletLines) {
        const m = line.match(/^\s*-\s*([a-zA-Z]:[\\\/][^\r\n<]+|\/[a-zA-Z0-9_\-\.\/]+)/);
        if (m && this.isValidWorkspacePath(m[1])) {
          return this.cleanWorkspacePath(m[1]);
        }
      }
    }

    const activeWsMatch = content.match(
      /(?:Command Working Directory|Active Workspace|Working Directory|Workspace Root):\s*([a-zA-Z]:[\\\/][^\r\n<]+|\/[a-zA-Z0-9_\-\.\/]+)/i
    );
    if (activeWsMatch && this.isValidWorkspacePath(activeWsMatch[1])) {
      return this.cleanWorkspacePath(activeWsMatch[1]);
    }

    const fallbackMappingMatch = content.match(/([a-zA-Z]:[\\\/][^\r\n->]+?)\s*->/);
    if (fallbackMappingMatch && this.isValidWorkspacePath(fallbackMappingMatch[1])) {
      return this.cleanWorkspacePath(fallbackMappingMatch[1]);
    }

    const fallbackPosixMappingMatch = content.match(/(\/[a-zA-Z0-9_\-\.\/]+)\s*->/);
    if (fallbackPosixMappingMatch && this.isValidWorkspacePath(fallbackPosixMappingMatch[1])) {
      return this.cleanWorkspacePath(fallbackPosixMappingMatch[1]);
    }

    // Layer 3: Look for CWD in <ADDITIONAL_METADATA> or tool execution
    const cwdMatch = content.match(/CWD:\s*([a-zA-Z]:[\\\/][^\r\n<]+|\/[a-zA-Z0-9_\-\.\/]+)/i);
    if (cwdMatch && this.isValidWorkspacePath(cwdMatch[1])) {
      return this.cleanWorkspacePath(cwdMatch[1]);
    }

    const toolCwdMatch = content.match(/"Cwd":\s*"([a-zA-Z]:(?:\\\\|\/)[^"]+|\/[^"]+)"/i);
    if (toolCwdMatch && this.isValidWorkspacePath(toolCwdMatch[1])) {
      return this.cleanWorkspacePath(toolCwdMatch[1].replace(/\\\\/g, '\\'));
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

    // 2. Bounded parallel async search across remaining session transcript files and artifact docs
    const remainingSessions = sessions.filter((s) => !matchedIds.has(s.id));
    const BATCH_SIZE = 15;
    for (let i = 0; i < remainingSessions.length; i += BATCH_SIZE) {
      const batch = remainingSessions.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(async (s) => {
          try {
            const candidatePaths = s.paths && s.paths.length > 0 ? s.paths : [s.path];
            for (const sp of candidatePaths) {
              const transcriptPath = this.getTranscriptFilePath(sp);
              if (transcriptPath && fs.existsSync(transcriptPath)) {
                const content = await fs.promises.readFile(transcriptPath, 'utf8');
                if (content.toLowerCase().includes(q)) {
                  matchedIds.add(s.id);
                  return;
                }
              }

              if (s.hasArtifacts) {
                const planPath = path.join(sp, 'implementation_plan.md');
                if (fs.existsSync(planPath)) {
                  const planContent = await fs.promises.readFile(planPath, 'utf8');
                  if (planContent.toLowerCase().includes(q)) {
                    matchedIds.add(s.id);
                    return;
                  }
                }
                const walkthroughPath = path.join(sp, 'walkthrough.md');
                if (fs.existsSync(walkthroughPath)) {
                  const wtContent = await fs.promises.readFile(walkthroughPath, 'utf8');
                  if (wtContent.toLowerCase().includes(q)) {
                    matchedIds.add(s.id);
                    return;
                  }
                }
              }
            }
          } catch {}
        })
      );
    }

    return Array.from(matchedIds);
  }
}
