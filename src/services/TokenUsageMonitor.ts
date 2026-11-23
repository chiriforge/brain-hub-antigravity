import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  ChatMessage,
  ChatSession,
  ModelPricingConfig,
  ModelPricingRates,
  ModelPricingRule,
  ModelTokenTotals,
  ProjectTokenRollup,
  TokenCostBreakdown,
  TokenModelCostItem,
  TokenUsageSummary,
  TreeTokenRollup
} from '../models/types';
import { SessionScanner } from './SessionScanner';

export interface TailFileState {
  filePath: string;
  sessionId: string;
  lastByteOffset: number;
  lastMtimeMs: number;
  partialLineBuffer: string;
  rawStepsByIndex: Map<number, any>;
  fallbackOrderedSteps: any[];
  fallbackSigSet: Set<string>;
  latestSummary: TokenUsageSummary;
}

export interface TokenThresholdConfig {
  warningThreshold: number;
  criticalThreshold: number;
}

export interface StatusBarPresentation {
  text: string;
  severity: 'normal' | 'warning' | 'critical';
  backgroundColorId?: 'statusBarItem.warningBackground' | 'statusBarItem.errorBackground';
  tooltipMarkdown: string;
}

export const DEFAULT_MODEL_PRICING_RULES: ModelPricingRule[] = [
  {
    pattern: 'hydrogen',
    label: 'Gemini 4 Hydrogen',
    inputPer1M: 1.5,
    outputPer1M: 7.5,
    cachedPer1M: 0.075,
    warningThreshold: 205000,
    criticalThreshold: 240000
  },
  {
    pattern: '3.8-flash',
    label: 'Gemini 3.8 Flash',
    inputPer1M: 0.75,
    outputPer1M: 3.75,
    cachedPer1M: 0.075,
    warningThreshold: 200000,
    criticalThreshold: 235000
  },
  {
    pattern: 'flash',
    label: 'Gemini Flash',
    inputPer1M: 0.75,
    outputPer1M: 3.75,
    cachedPer1M: 0.075,
    warningThreshold: 200000,
    criticalThreshold: 235000
  },
  {
    pattern: 'argon',
    label: 'Gemini 4 Argon',
    inputPer1M: 2.0,
    outputPer1M: 10.0,
    cachedPer1M: 0.1,
    warningThreshold: 285000,
    criticalThreshold: 335000
  },
  {
    pattern: 'carbon',
    label: 'Gemini 4 Carbon',
    inputPer1M: 2.0,
    outputPer1M: 10.0,
    cachedPer1M: 0.1,
    warningThreshold: 285000,
    criticalThreshold: 335000
  },
  {
    pattern: 'claude',
    label: 'Claude',
    inputPer1M: 3.0,
    outputPer1M: 15.0,
    cachedPer1M: 0.3,
    warningThreshold: 150000,
    criticalThreshold: 180000
  }
];

export const DEFAULT_FALLBACK_PRICING: ModelPricingRates = {
  label: 'Default (Hydrogen)',
  inputPer1M: 1.5,
  outputPer1M: 7.5,
  cachedPer1M: 0.075
};

export class TokenUsageMonitor {
  private static instance: TokenUsageMonitor;
  private statusBarItem?: vscode.StatusBarItem;
  private tailStates: Map<string, TailFileState> = new Map();
  private fileReadLocks: Map<string, Promise<TokenUsageSummary>> = new Map();
  private activeSessionId?: string;
  private activeSessionMeta?: Pick<ChatSession, 'id' | 'title' | 'workspaceName' | 'workspacePath' | 'path'>;
  private activeWatchers: fs.FSWatcher[] = [];
  private pollTimer?: NodeJS.Timeout;
  private debounceTimer?: NodeJS.Timeout;
  private isRefreshing: boolean = false;
  private pendingRefresh: boolean = false;
  private pendingPreferredSessionId?: string;
  private activeRefreshPromise?: Promise<void>;

  private constructor() {}

  public static getInstance(): TokenUsageMonitor {
    if (!TokenUsageMonitor.instance) {
      TokenUsageMonitor.instance = new TokenUsageMonitor();
    }
    return TokenUsageMonitor.instance;
  }

  public static normalizeThresholds(config?: Partial<TokenThresholdConfig>): TokenThresholdConfig {
    const rawWarn = Number(config?.warningThreshold);
    const rawCrit = Number(config?.criticalThreshold);
    const safeWarn = Number.isFinite(rawWarn) && rawWarn > 0 ? Math.floor(rawWarn) : 100000;
    const safeCrit = Number.isFinite(rawCrit) && rawCrit > 0 ? Math.floor(rawCrit) : 150000;
    return {
      warningThreshold: Math.min(safeWarn, safeCrit),
      criticalThreshold: Math.max(safeWarn, safeCrit)
    };
  }

  public static getThresholdsFromSettings(): TokenThresholdConfig {
    const cfg = vscode.workspace.getConfiguration('brainHub');
    const warningThreshold = cfg.get<number>('tokenWarningThreshold', 100000);
    const criticalThreshold = cfg.get<number>('tokenCriticalThreshold', 150000);
    return TokenUsageMonitor.normalizeThresholds({ warningThreshold, criticalThreshold });
  }

  public static sanitizeNonNegativeRate(val: unknown, fallback: number = 0): number {
    const num = Number(val);
    if (!Number.isFinite(num) || num < 0) {
      return fallback;
    }
    return num;
  }

  public static normalizePricingConfig(config?: Partial<ModelPricingConfig>): ModelPricingConfig {
    const rawRules = Array.isArray(config?.rules) ? config!.rules : DEFAULT_MODEL_PRICING_RULES;
    const rules: ModelPricingRule[] = [];
    for (const r of rawRules) {
      if (!r || typeof r.pattern !== 'string' || !r.pattern.trim()) {
        continue;
      }
      const rawWarn = Number(r.warningThreshold);
      const rawCrit = Number(r.criticalThreshold);
      const hasWarn = Number.isFinite(rawWarn) && rawWarn > 0;
      const hasCrit = Number.isFinite(rawCrit) && rawCrit > 0;
      let warningThreshold = hasWarn ? Math.floor(rawWarn) : undefined;
      let criticalThreshold = hasCrit ? Math.floor(rawCrit) : undefined;
      if (warningThreshold !== undefined && criticalThreshold !== undefined && warningThreshold > criticalThreshold) {
        const minVal = Math.min(warningThreshold, criticalThreshold);
        const maxVal = Math.max(warningThreshold, criticalThreshold);
        warningThreshold = minVal;
        criticalThreshold = maxVal;
      }
      rules.push({
        pattern: r.pattern.trim(),
        label: typeof r.label === 'string' && r.label.trim() ? r.label.trim() : r.pattern.trim(),
        inputPer1M: TokenUsageMonitor.sanitizeNonNegativeRate(r.inputPer1M, 0),
        outputPer1M: TokenUsageMonitor.sanitizeNonNegativeRate(r.outputPer1M, 0),
        cachedPer1M: TokenUsageMonitor.sanitizeNonNegativeRate(r.cachedPer1M, 0),
        ...(warningThreshold !== undefined ? { warningThreshold } : {}),
        ...(criticalThreshold !== undefined ? { criticalThreshold } : {})
      });
    }

    const rawDefault = config?.defaultPricing;
    const defaultPricing: ModelPricingRates = {
      label:
        rawDefault && typeof rawDefault.label === 'string' && rawDefault.label.trim()
          ? rawDefault.label.trim()
          : DEFAULT_FALLBACK_PRICING.label,
      inputPer1M: TokenUsageMonitor.sanitizeNonNegativeRate(
        rawDefault?.inputPer1M,
        DEFAULT_FALLBACK_PRICING.inputPer1M
      ),
      outputPer1M: TokenUsageMonitor.sanitizeNonNegativeRate(
        rawDefault?.outputPer1M,
        DEFAULT_FALLBACK_PRICING.outputPer1M
      ),
      cachedPer1M: TokenUsageMonitor.sanitizeNonNegativeRate(
        rawDefault?.cachedPer1M,
        DEFAULT_FALLBACK_PRICING.cachedPer1M
      )
    };

    return { rules, defaultPricing };
  }

  public static getPricingFromSettings(): ModelPricingConfig {
    const cfg = vscode.workspace.getConfiguration('brainHub');
    const rules = cfg.get<ModelPricingRule[]>('modelPricing', DEFAULT_MODEL_PRICING_RULES);
    const defaultPricing = cfg.get<ModelPricingRates>('defaultModelPricing', DEFAULT_FALLBACK_PRICING);
    return TokenUsageMonitor.normalizePricingConfig({ rules, defaultPricing });
  }

  public static resolveModelPricing(
    modelName?: string,
    pricingConfig?: Partial<ModelPricingConfig>
  ): ModelPricingRates {
    const norm = pricingConfig
      ? TokenUsageMonitor.normalizePricingConfig(pricingConfig)
      : TokenUsageMonitor.getPricingFromSettings();
    const normalizedModel = typeof modelName === 'string' ? modelName.trim().toLowerCase() : '';
    if (normalizedModel && normalizedModel !== 'unknown') {
      for (const rule of norm.rules) {
        if (normalizedModel.includes(rule.pattern.toLowerCase())) {
          return {
            label: rule.label || rule.pattern,
            inputPer1M: rule.inputPer1M,
            outputPer1M: rule.outputPer1M,
            cachedPer1M: rule.cachedPer1M
          };
        }
      }
    }
    return norm.defaultPricing;
  }

  public static getLatestModelName(summary?: Partial<TokenUsageSummary> | null): string | undefined {
    if (!summary) {
      return undefined;
    }
    if (Array.isArray(summary.stepMetrics)) {
      for (let i = summary.stepMetrics.length - 1; i >= 0; i--) {
        const m = summary.stepMetrics[i]?.model;
        if (typeof m === 'string' && m.trim() && m.trim().toLowerCase() !== 'unknown') {
          return m.trim();
        }
      }
    }
    if (typeof summary.primaryModel === 'string' && summary.primaryModel.trim() && summary.primaryModel.trim().toLowerCase() !== 'unknown') {
      return summary.primaryModel.trim();
    }
    return undefined;
  }

  public static resolveModelThresholds(
    modelName?: string,
    pricingConfig?: Partial<ModelPricingConfig>,
    fallbackThresholds?: Partial<TokenThresholdConfig>
  ): TokenThresholdConfig {
    const baseFallback = fallbackThresholds
      ? TokenUsageMonitor.normalizeThresholds(fallbackThresholds)
      : TokenUsageMonitor.getThresholdsFromSettings();
    const norm = pricingConfig
      ? TokenUsageMonitor.normalizePricingConfig(pricingConfig)
      : TokenUsageMonitor.getPricingFromSettings();
    const normalizedModel = typeof modelName === 'string' ? modelName.trim().toLowerCase() : '';
    if (normalizedModel && normalizedModel !== 'unknown') {
      for (const rule of norm.rules) {
        if (normalizedModel.includes(rule.pattern.toLowerCase())) {
          if (rule.warningThreshold !== undefined || rule.criticalThreshold !== undefined) {
            return TokenUsageMonitor.normalizeThresholds({
              warningThreshold: rule.warningThreshold ?? baseFallback.warningThreshold,
              criticalThreshold: rule.criticalThreshold ?? baseFallback.criticalThreshold
            });
          }
          break;
        }
      }
    }
    return baseFallback;
  }

  public static resolveEffectiveThresholds(
    summary?: Partial<TokenUsageSummary> | null,
    fallbackThresholds?: Partial<TokenThresholdConfig>,
    pricingConfig?: Partial<ModelPricingConfig>
  ): TokenThresholdConfig {
    const modelName = TokenUsageMonitor.getLatestModelName(summary);
    return TokenUsageMonitor.resolveModelThresholds(modelName, pricingConfig, fallbackThresholds);
  }

  public static formatUsdCost(amount?: number): string {
    const safe = TokenUsageMonitor.sanitizeNonNegativeRate(amount, 0);
    if (safe === 0) {
      return '$0.00';
    }
    if (safe < 0.01) {
      return `$${safe.toFixed(4)}`;
    }
    return `$${safe.toFixed(2)}`;
  }

  public static calculateTokenCost(
    summary?: Partial<TokenUsageSummary> | null,
    pricingConfig?: Partial<ModelPricingConfig>
  ): TokenCostBreakdown {
    const empty: TokenCostBreakdown = {
      inputCost: 0,
      cachedCost: 0,
      outputCost: 0,
      totalCost: 0,
      cacheSavings: 0,
      byModel: []
    };
    if (!summary) {
      return empty;
    }

    const norm = pricingConfig
      ? TokenUsageMonitor.normalizePricingConfig(pricingConfig)
      : TokenUsageMonitor.getPricingFromSettings();

    const breakdownEntries: Array<[string, { inputTokens: number; cacheReadTokens: number; outputTokens: number; stepCount: number }]> = [];
    if (summary.modelBreakdown && typeof summary.modelBreakdown === 'object' && Object.keys(summary.modelBreakdown).length > 0) {
      for (const [k, v] of Object.entries(summary.modelBreakdown)) {
        if (v) {
          breakdownEntries.push([
            k,
            {
              inputTokens: SessionScanner.coerceNonNegativeInt(v.inputTokens),
              cacheReadTokens: SessionScanner.coerceNonNegativeInt(v.cacheReadTokens),
              outputTokens: SessionScanner.coerceNonNegativeInt(v.outputTokens),
              stepCount: SessionScanner.coerceNonNegativeInt(v.stepCount)
            }
          ]);
        }
      }
    } else {
      const totalIn = SessionScanner.coerceNonNegativeInt(summary.totalInputTokens);
      const totalCache = SessionScanner.coerceNonNegativeInt(summary.totalCacheReadTokens);
      const totalOut = SessionScanner.coerceNonNegativeInt(summary.totalOutputTokens);
      if (totalIn > 0 || totalCache > 0 || totalOut > 0) {
        breakdownEntries.push([
          summary.primaryModel || 'unknown',
          {
            inputTokens: totalIn,
            cacheReadTokens: totalCache,
            outputTokens: totalOut,
            stepCount: SessionScanner.coerceNonNegativeInt(summary.plannerStepCount)
          }
        ]);
      }
    }

    let inputCost = 0;
    let cachedCost = 0;
    let outputCost = 0;
    let cacheSavings = 0;
    const byModel: TokenModelCostItem[] = [];

    for (const [modelKey, totals] of breakdownEntries) {
      const lookupName = modelKey === 'unknown' ? summary.primaryModel : modelKey;
      const rates = TokenUsageMonitor.resolveModelPricing(lookupName, norm);
      const mInCost = (totals.inputTokens / 1_000_000) * rates.inputPer1M;
      const mCachedCost = (totals.cacheReadTokens / 1_000_000) * rates.cachedPer1M;
      const mOutCost = (totals.outputTokens / 1_000_000) * rates.outputPer1M;
      const mTotalCost = mInCost + mCachedCost + mOutCost;
      const mSavings = Math.max(0, (totals.cacheReadTokens / 1_000_000) * (rates.inputPer1M - rates.cachedPer1M));

      inputCost += mInCost;
      cachedCost += mCachedCost;
      outputCost += mOutCost;
      cacheSavings += mSavings;

      byModel.push({
        model: modelKey,
        label: rates.label || (lookupName || 'Default'),
        inputTokens: totals.inputTokens,
        cacheReadTokens: totals.cacheReadTokens,
        outputTokens: totals.outputTokens,
        stepCount: totals.stepCount,
        inputCost: mInCost,
        cachedCost: mCachedCost,
        outputCost: mOutCost,
        totalCost: mTotalCost,
        cacheSavings: mSavings
      });
    }

    return {
      inputCost,
      cachedCost,
      outputCost,
      totalCost: inputCost + cachedCost + outputCost,
      cacheSavings,
      byModel
    };
  }

  public static aggregateProjectTokenUsage(
    sessions: Array<Pick<ChatSession, 'workspacePath' | 'tokenUsage'> & Partial<Pick<ChatSession, 'id' | 'treeTokenUsage' | 'executorParentId' | 'executorRootId'>>>,
    pricingConfig?: Partial<ModelPricingConfig>
  ): ProjectTokenRollup {
    const norm = pricingConfig
      ? TokenUsageMonitor.normalizePricingConfig(pricingConfig)
      : TokenUsageMonitor.getPricingFromSettings();

    const presentIds = new Set<string>();
    for (const s of sessions || []) {
      if (s?.id) {
        presentIds.add(s.id.toLowerCase());
      }
    }

    let sessionCount = 0;
    let totalInputTokens = 0;
    let totalCacheReadTokens = 0;
    let totalOutputTokens = 0;
    const mergedBreakdown: Record<string, { inputTokens: number; cacheReadTokens: number; outputTokens: number; stepCount: number }> = {};

    for (const s of sessions || []) {
      // Skip child executors whose coordinator/root is already present in this aggregation list (rolled up in treeTokenUsage)
      if (
        s?.executorParentId &&
        (presentIds.has(s.executorParentId.toLowerCase()) ||
          (s.executorRootId && presentIds.has(s.executorRootId.toLowerCase())))
      ) {
        continue;
      }

      sessionCount++;
      const tu: Partial<TokenUsageSummary> | undefined =
        !s?.executorParentId && s?.treeTokenUsage && s.treeTokenUsage.executorCount > 1
          ? {
              totalInputTokens: s.treeTokenUsage.totalInputTokens,
              totalCacheReadTokens: s.treeTokenUsage.totalCacheReadTokens,
              totalOutputTokens: s.treeTokenUsage.totalOutputTokens,
              modelBreakdown: s.treeTokenUsage.modelBreakdown,
              primaryModel: s.tokenUsage?.primaryModel,
              plannerStepCount: s.tokenUsage?.plannerStepCount
            }
          : s?.tokenUsage;
      if (!tu) {
        continue;
      }
      const sIn = SessionScanner.coerceNonNegativeInt(tu.totalInputTokens);
      const sCache = SessionScanner.coerceNonNegativeInt(tu.totalCacheReadTokens);
      const sOut = SessionScanner.coerceNonNegativeInt(tu.totalOutputTokens);
      totalInputTokens += sIn;
      totalCacheReadTokens += sCache;
      totalOutputTokens += sOut;

      if (tu.modelBreakdown && typeof tu.modelBreakdown === 'object' && Object.keys(tu.modelBreakdown).length > 0) {
        for (const [mKey, mVal] of Object.entries(tu.modelBreakdown)) {
          if (!mVal) continue;
          const targetKey = mKey === 'unknown' && tu.primaryModel ? tu.primaryModel : mKey;
          if (!mergedBreakdown[targetKey]) {
            mergedBreakdown[targetKey] = { inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, stepCount: 0 };
          }
          mergedBreakdown[targetKey].inputTokens += SessionScanner.coerceNonNegativeInt(mVal.inputTokens);
          mergedBreakdown[targetKey].cacheReadTokens += SessionScanner.coerceNonNegativeInt(mVal.cacheReadTokens);
          mergedBreakdown[targetKey].outputTokens += SessionScanner.coerceNonNegativeInt(mVal.outputTokens);
          mergedBreakdown[targetKey].stepCount += SessionScanner.coerceNonNegativeInt(mVal.stepCount);
        }
      } else if (sIn > 0 || sCache > 0 || sOut > 0) {
        const targetKey = tu.primaryModel || 'unknown';
        if (!mergedBreakdown[targetKey]) {
          mergedBreakdown[targetKey] = { inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, stepCount: 0 };
        }
        mergedBreakdown[targetKey].inputTokens += sIn;
        mergedBreakdown[targetKey].cacheReadTokens += sCache;
        mergedBreakdown[targetKey].outputTokens += sOut;
        mergedBreakdown[targetKey].stepCount += SessionScanner.coerceNonNegativeInt(tu.plannerStepCount);
      }
    }

    const totalContextSum = totalInputTokens + totalCacheReadTokens;
    const overallCacheHitRatio =
      totalContextSum > 0 ? Math.round((totalCacheReadTokens / totalContextSum) * 1000) / 10 : 0;
    const cumulativeTokens = totalInputTokens + totalCacheReadTokens + totalOutputTokens;
    const cost = TokenUsageMonitor.calculateTokenCost(
      {
        totalInputTokens,
        totalCacheReadTokens,
        totalOutputTokens,
        modelBreakdown: Object.keys(mergedBreakdown).length > 0 ? mergedBreakdown : undefined
      },
      norm
    );

    return {
      sessionCount,
      totalInputTokens,
      totalCacheReadTokens,
      totalOutputTokens,
      cumulativeTokens,
      overallCacheHitRatio,
      cost
    };
  }

  public static formatStatusBarState(
    summary: TokenUsageSummary,
    session?: Pick<ChatSession, 'id' | 'title' | 'workspaceName' | 'workspacePath'> | null,
    thresholds?: Partial<TokenThresholdConfig>,
    pricingConfig?: Partial<ModelPricingConfig>,
    treeRollup?: TreeTokenRollup,
    childExecutors?: Array<Pick<ChatSession, 'id' | 'title' | 'executorRole' | 'executorStatus' | 'tokenUsage'>>
  ): StatusBarPresentation {
    const normThresholds = TokenUsageMonitor.resolveEffectiveThresholds(summary, thresholds, pricingConfig);
    const ctxTokens = SessionScanner.coerceNonNegativeInt(summary?.latestContextTokens);
    const outTokens = SessionScanner.coerceNonNegativeInt(summary?.latestOutputTokens);
    const stepIdx = SessionScanner.coerceNonNegativeInt(summary?.latestStepIndex);
    const cachePct = Math.round(Number(summary?.latestCacheHitRatio) || 0);
    const hasCacheMiss = Boolean(summary?.hasCacheMissAtTail);

    let severity: 'normal' | 'warning' | 'critical' = 'normal';
    let icon = '$(pulse)';
    let backgroundColorId: 'statusBarItem.warningBackground' | 'statusBarItem.errorBackground' | undefined = undefined;

    if (ctxTokens >= normThresholds.criticalThreshold) {
      severity = 'critical';
      icon = '$(flame)';
      backgroundColorId = 'statusBarItem.errorBackground';
    } else if (ctxTokens >= normThresholds.warningThreshold || hasCacheMiss) {
      severity = 'warning';
      icon = '$(warning)';
      backgroundColorId = 'statusBarItem.warningBackground';
    }

    const ctxCompact = SessionScanner.formatCompactTokens(ctxTokens);
    const outCompact = SessionScanner.formatCompactTokens(outTokens);
    const cacheMissSuffix = hasCacheMiss && severity !== 'critical' ? ' · Cache Miss' : '';
    const subagentCount = treeRollup && treeRollup.executorCount > 1 ? treeRollup.executorCount - 1 : 0;
    const activeChildCount = (childExecutors || []).filter((c) => c.executorStatus === 'running').length;
    const multiExecSuffix =
      subagentCount > 0
        ? ` · 🤖${activeChildCount > 0 ? `${activeChildCount}/${subagentCount}` : subagentCount}`
        : '';
    const text = `${icon} Ctx: ${ctxCompact} (${cachePct}% cache) | Out: ${outCompact} | #${stepIdx}${cacheMissSuffix}${multiExecSuffix}`;

    const escapeMdPipes = (val: string): string => val.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
    const sessionTitle = escapeMdPipes(session?.title || 'Active Session');
    const sessionIdShort = session?.id ? session.id.substring(0, 8) : 'unknown';
    const wsDisplay = session?.workspaceName || (session?.workspacePath ? path.basename(session.workspacePath) : 'All Workspaces');

    const latestInFmt = SessionScanner.coerceNonNegativeInt(summary?.latestInputTokens).toLocaleString();
    const latestCacheFmt = SessionScanner.coerceNonNegativeInt(summary?.latestCacheReadTokens).toLocaleString();
    const latestOutFmt = outTokens.toLocaleString();
    const latestCtxFmt = ctxTokens.toLocaleString();
    const peakCtxFmt = SessionScanner.coerceNonNegativeInt(summary?.peakContextTokens).toLocaleString();
    const baselineCtxFmt = SessionScanner.coerceNonNegativeInt(summary?.baselineContextTokens).toLocaleString();
    const totalInFmt = SessionScanner.coerceNonNegativeInt(summary?.totalInputTokens).toLocaleString();
    const totalCacheFmt = SessionScanner.coerceNonNegativeInt(summary?.totalCacheReadTokens).toLocaleString();
    const totalOutFmt = SessionScanner.coerceNonNegativeInt(summary?.totalOutputTokens).toLocaleString();
    const cumulativeFmt = SessionScanner.coerceNonNegativeInt(summary?.cumulativeTokens).toLocaleString();
    const overallCacheRatio = Number(summary?.overallCacheHitRatio || 0).toFixed(1);
    const cacheMissCount = SessionScanner.coerceNonNegativeInt(summary?.cacheMissCount);
    const cost = TokenUsageMonitor.calculateTokenCost(summary, pricingConfig);
    const totalCostFmt = TokenUsageMonitor.formatUsdCost(cost.totalCost);
    const inCostFmt = TokenUsageMonitor.formatUsdCost(cost.inputCost);
    const cachedCostFmt = TokenUsageMonitor.formatUsdCost(cost.cachedCost);
    const outCostFmt = TokenUsageMonitor.formatUsdCost(cost.outputCost);
    const savedCostFmt = TokenUsageMonitor.formatUsdCost(cost.cacheSavings);

    const lines: string[] = [
      `### $(pulse) Antigravity Token & Context Telemetry`,
      `**Session:** ${sessionTitle} (\`${sessionIdShort}\`) · 📁 \`${wsDisplay}\``,
      ``,
      `| Metric | Latest Step (\`#${stepIdx}\`) | Session Summary |`,
      `| :--- | :--- | :--- |`,
      `| **Context Window** | **${latestCtxFmt}** (\`${ctxCompact}\`) | **Peak:** ${peakCtxFmt} (\`#${SessionScanner.coerceNonNegativeInt(summary?.peakStepIndex)}\`) |`,
      `| **KV Cache Read** | ${latestCacheFmt} (**${Number(summary?.latestCacheHitRatio || 0).toFixed(1)}%**) | **Σ Cached:** ${totalCacheFmt} (${overallCacheRatio}%) |`,
      `| **Uncached Input** | +${latestInFmt} | **Σ Input:** ${totalInFmt} (Base: ${baselineCtxFmt}) |`,
      `| **Model Output** | ${latestOutFmt} | **Σ Output:** ${totalOutFmt} |`,
      `| **Cumulative** | ${SessionScanner.coerceNonNegativeInt(summary?.plannerStepCount)} AI turns | **Σ Total:** ${cumulativeFmt} · **Misses:** ${cacheMissCount} |`,
      `| **Est. Cost (USD)** | **${totalCostFmt}** | In ${inCostFmt} · Cached ${cachedCostFmt} · Out ${outCostFmt} (Saved ${savedCostFmt}) |`
    ];

    if (treeRollup && treeRollup.executorCount > 1) {
      const treeCost = TokenUsageMonitor.calculateTokenCost(treeRollup, pricingConfig);
      const treeCostFmt = TokenUsageMonitor.formatUsdCost(treeCost.totalCost);
      const treeCumFmt = SessionScanner.coerceNonNegativeInt(treeRollup.cumulativeTokens).toLocaleString();
      const treeInFmt = SessionScanner.formatCompactTokens(treeRollup.totalInputTokens);
      const treeCacheFmt = SessionScanner.formatCompactTokens(treeRollup.totalCacheReadTokens);
      const treeOutFmt = SessionScanner.formatCompactTokens(treeRollup.totalOutputTokens);
      lines.push(
        `| **Tree Total (${treeRollup.executorCount} executors)** | **${treeCostFmt}** | **Σ ${treeCumFmt}** (In ${treeInFmt} · Cache ${treeCacheFmt} · Out ${treeOutFmt}) |`
      );
      if (childExecutors && childExecutors.length > 0) {
        lines.push(``, `**Subagents:**`);
        for (const ch of childExecutors.slice(0, 8)) {
          const chRole = escapeMdPipes(ch.executorRole || ch.title || ch.id.substring(0, 8));
          const chCum = SessionScanner.formatCompactTokens(ch.tokenUsage?.cumulativeTokens || 0);
          const chCost = TokenUsageMonitor.formatUsdCost(
            TokenUsageMonitor.calculateTokenCost(ch.tokenUsage, pricingConfig).totalCost
          );
          const chStatus = ch.executorStatus || 'done';
          lines.push(`- \`${ch.id.substring(0, 8)}\` **${chRole}** (${chStatus}): ${chCum} · ${chCost}`);
        }
      }
    }

    if (severity === 'critical') {
      const critLabel = SessionScanner.formatCompactTokens(normThresholds.criticalThreshold);
      lines.push(
        ``,
        `---`,
        `🔴 **Critical Context Threshold Exceeded (>= ${critLabel} tokens):** Run \`/compact\` in Antigravity chat to summarize context and prevent KV cache expiration spikes.`
      );
    } else if (hasCacheMiss) {
      lines.push(
        ``,
        `---`,
        `⚠️ **Mid-Session KV Cache Miss Detected at Step #${stepIdx}:** \`cache_read_tokens\` dropped to \`0\` (${latestInFmt} uncached input tokens). Consider running \`/compact\` if context continues growing.`
      );
    } else if (severity === 'warning') {
      const warnLabel = SessionScanner.formatCompactTokens(normThresholds.warningThreshold);
      const critLabel = SessionScanner.formatCompactTokens(normThresholds.criticalThreshold);
      lines.push(
        ``,
        `---`,
        `🟡 **Approaching Context Threshold (${warnLabel} / ${critLabel}):** Consider running \`/compact\` soon to keep prompt cache efficiency high.`
      );
    } else {
      lines.push(``, `*Click to inspect full step-by-step token chart in Brain Hub Dashboard.*`);
    }

    return {
      text,
      severity,
      backgroundColorId,
      tooltipMarkdown: lines.join('\n')
    };
  }

  private static escapeHtml(text: string): string {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  public static renderTokenUsageSvgChart(
    tokenUsage: TokenUsageSummary,
    warningThreshold: number = 100000,
    criticalThreshold: number = 150000
  ): string {
    const normThresholds = TokenUsageMonitor.normalizeThresholds({ warningThreshold, criticalThreshold });
    const steps = Array.isArray(tokenUsage?.stepMetrics) ? tokenUsage.stepMetrics : [];
    if (steps.length === 0) {
      return '';
    }

    const peakCtx = SessionScanner.coerceNonNegativeInt(tokenUsage.peakContextTokens);
    const maxScale = Math.max(peakCtx, normThresholds.criticalThreshold, 10000);
    const chartHeight = 120;
    const padTop = 14;
    const padBottom = 20;
    const padLeft = 44;
    const padRight = 14;
    const plotHeight = chartHeight - padTop - padBottom;
    const barGap = 3;
    const barWidth = Math.max(6, Math.min(22, Math.floor(540 / Math.max(steps.length, 1)) - barGap));
    const plotWidth = Math.max(260, steps.length * (barWidth + barGap));
    const svgWidth = padLeft + plotWidth + padRight;

    const warnY = padTop + Math.round((1 - Math.min(1, normThresholds.warningThreshold / maxScale)) * plotHeight);
    const critY = padTop + Math.round((1 - Math.min(1, normThresholds.criticalThreshold / maxScale)) * plotHeight);

    const barsHtml: string[] = [];
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      const stepIdx = SessionScanner.coerceNonNegativeInt(s.stepIndex);
      const inTok = SessionScanner.coerceNonNegativeInt(s.inputTokens);
      const cacheTok = SessionScanner.coerceNonNegativeInt(s.cacheReadTokens);
      const outTok = SessionScanner.coerceNonNegativeInt(s.outputTokens);
      const totalCtx = SessionScanner.coerceNonNegativeInt(s.totalContextTokens);
      const cachePct = Number(s.cacheHitRatio || 0).toFixed(1);
      const x = padLeft + i * (barWidth + barGap);

      const totalBarHeight = totalCtx > 0 ? Math.max(2, Math.min(plotHeight, Math.round((totalCtx / maxScale) * plotHeight))) : 0;
      const cacheBarHeight = totalCtx > 0 ? Math.round((cacheTok / totalCtx) * totalBarHeight) : 0;
      const inputBarHeight = Math.max(0, totalBarHeight - cacheBarHeight);

      const cacheY = padTop + plotHeight - cacheBarHeight;
      const inputY = cacheY - inputBarHeight;
      const inputClass = s.isCacheMiss ? 'token-bar-miss' : 'token-bar-input';
      const toolLabel = Array.isArray(s.toolNames) && s.toolNames.length > 0 ? ` | Tools: ${s.toolNames.join(', ')}` : '';
      const missLabel = s.isCacheMiss ? ' [CACHE MISS]' : '';
      const tooltip = TokenUsageMonitor.escapeHtml(
        `Step #${stepIdx}${missLabel} — Context: ${totalCtx.toLocaleString()} (Cache: ${cacheTok.toLocaleString()} [${cachePct}%], +Input: ${inTok.toLocaleString()}) | Output: ${outTok.toLocaleString()}${toolLabel}`
      );

      barsHtml.push(`<g class="token-bar-group" data-step-index="${stepIdx}">`);
      barsHtml.push(`<title>${tooltip}</title>`);
      if (cacheBarHeight > 0) {
        barsHtml.push(
          `<rect class="token-bar-cache" x="${x}" y="${cacheY}" width="${barWidth}" height="${cacheBarHeight}" rx="1.5" />`
        );
      }
      if (inputBarHeight > 0) {
        barsHtml.push(
          `<rect class="${inputClass}" x="${x}" y="${inputY}" width="${barWidth}" height="${inputBarHeight}" rx="1.5" />`
        );
      }
      if (i === 0 || i === steps.length - 1 || s.isCacheMiss || stepIdx === tokenUsage.peakStepIndex || (steps.length <= 16 && i % 2 === 0) || i % Math.max(1, Math.floor(steps.length / 8)) === 0) {
        barsHtml.push(
          `<text class="token-axis-label" x="${x + Math.floor(barWidth / 2)}" y="${chartHeight - 5}" text-anchor="middle">#${stepIdx}</text>`
        );
      }
      barsHtml.push(`</g>`);
    }

    const maxLabel = SessionScanner.formatCompactTokens(maxScale);
    const warnLabel = SessionScanner.formatCompactTokens(normThresholds.warningThreshold);
    const critLabel = SessionScanner.formatCompactTokens(normThresholds.criticalThreshold);

    return [
      `<div class="token-step-chart-scroll">`,
      `<svg class="token-step-chart" viewBox="0 0 ${svgWidth} ${chartHeight}" width="100%" height="${chartHeight}" role="img" aria-label="Step-by-step context window and prompt cache token chart">`,
      `<line class="token-grid-baseline" x1="${padLeft}" y1="${padTop + plotHeight}" x2="${svgWidth - padRight}" y2="${padTop + plotHeight}" />`,
      `<line class="token-threshold-line token-threshold-warn" x1="${padLeft}" y1="${warnY}" x2="${svgWidth - padRight}" y2="${warnY}" stroke-dasharray="4 3" />`,
      `<text class="token-threshold-label token-threshold-warn-label" x="${padLeft - 4}" y="${Math.max(10, warnY + 3)}" text-anchor="end">${warnLabel}</text>`,
      `<line class="token-threshold-line token-threshold-crit" x1="${padLeft}" y1="${critY}" x2="${svgWidth - padRight}" y2="${critY}" stroke-dasharray="4 3" />`,
      `<text class="token-threshold-label token-threshold-crit-label" x="${padLeft - 4}" y="${Math.max(10, critY + 3)}" text-anchor="end">${critLabel}</text>`,
      `<text class="token-axis-label" x="${padLeft - 4}" y="${padTop + plotHeight}" text-anchor="end">0</text>`,
      `<text class="token-axis-label" x="${padLeft - 4}" y="${padTop + 4}" text-anchor="end">${maxLabel}</text>`,
      barsHtml.join(''),
      `</svg>`,
      `</div>`
    ].join('');
  }

  private static resolveBannerStatusMeta(
    tokenUsage: TokenUsageSummary,
    thresholds?: Partial<TokenThresholdConfig>,
    pricingConfig?: Partial<ModelPricingConfig>
  ) {
    const normThresholds = TokenUsageMonitor.resolveEffectiveThresholds(tokenUsage, thresholds, pricingConfig);
    const latestCtx = SessionScanner.coerceNonNegativeInt(tokenUsage.latestContextTokens);
    const peakCtx = SessionScanner.coerceNonNegativeInt(tokenUsage.peakContextTokens);
    const baselineCtx = SessionScanner.coerceNonNegativeInt(tokenUsage.baselineContextTokens);
    const latestStepIdx = SessionScanner.coerceNonNegativeInt(tokenUsage.latestStepIndex);
    const plannerSteps = SessionScanner.coerceNonNegativeInt(tokenUsage.plannerStepCount);
    const totalIn = SessionScanner.coerceNonNegativeInt(tokenUsage.totalInputTokens);
    const totalCache = SessionScanner.coerceNonNegativeInt(tokenUsage.totalCacheReadTokens);
    const totalOut = SessionScanner.coerceNonNegativeInt(tokenUsage.totalOutputTokens);
    const cumulative = SessionScanner.coerceNonNegativeInt(tokenUsage.cumulativeTokens);
    const cacheMissCount = SessionScanner.coerceNonNegativeInt(tokenUsage.cacheMissCount);
    const latestCacheRatio = Number(tokenUsage.latestCacheHitRatio || 0).toFixed(1);
    const overallCacheRatio = Number(tokenUsage.overallCacheHitRatio || 0).toFixed(1);
    const hasCacheMiss = Boolean(tokenUsage.hasCacheMissAtTail);
    const modelName = TokenUsageMonitor.getLatestModelName(tokenUsage);
    const modelLabel = modelName ? TokenUsageMonitor.resolveModelPricing(modelName, pricingConfig).label || modelName : 'Default';

    const warnCompact = SessionScanner.formatCompactTokens(normThresholds.warningThreshold);
    const critCompact = SessionScanner.formatCompactTokens(normThresholds.criticalThreshold);
    let severity: 'normal' | 'warning' | 'critical' = 'normal';
    let statusEmoji = '🟢';
    let statusClass = 'token-ok';
    let statusTitle = `${modelLabel}: Context ${latestCtx.toLocaleString()} normal (Warn ${warnCompact} / Crit ${critCompact})${cacheMissCount > 0 ? ` · ${cacheMissCount} cache miss` : ''}`;

    if (latestCtx >= normThresholds.criticalThreshold) {
      severity = 'critical';
      statusEmoji = '🔴';
      statusClass = 'token-crit';
      statusTitle = `${modelLabel}: Context (${latestCtx.toLocaleString()}) >= critical (${critCompact}). Run /compact in Antigravity chat.`;
    } else if (hasCacheMiss) {
      severity = 'warning';
      statusEmoji = '🟡';
      statusClass = 'token-warn';
      statusTitle = `${modelLabel}: Mid-session KV Cache Miss at step #${latestStepIdx} (Warn ${warnCompact} / Crit ${critCompact}).`;
    } else if (latestCtx >= normThresholds.warningThreshold) {
      severity = 'warning';
      statusEmoji = '🟡';
      statusClass = 'token-warn';
      statusTitle = `${modelLabel}: Context (${latestCtx.toLocaleString()}) >= warning (${warnCompact} / Crit ${critCompact}). Near /compact.`;
    }

    const cost = TokenUsageMonitor.calculateTokenCost(tokenUsage, pricingConfig);
    const totalCostStr = TokenUsageMonitor.formatUsdCost(cost.totalCost);
    const inCostStr = TokenUsageMonitor.formatUsdCost(cost.inputCost);
    const cachedCostStr = TokenUsageMonitor.formatUsdCost(cost.cachedCost);
    const outCostStr = TokenUsageMonitor.formatUsdCost(cost.outputCost);
    const savedCostStr = TokenUsageMonitor.formatUsdCost(cost.cacheSavings);
    const modelBreakdownTip =
      cost.byModel.length > 0
        ? ` | Models: ${cost.byModel
            .map((m) => `${m.label}: ${TokenUsageMonitor.formatUsdCost(m.totalCost)} (${m.stepCount} turns)`)
            .join(', ')}`
        : '';
    const costTooltip = `Estimated USD Cost: ${totalCostStr} (Input: ${inCostStr} + Cached: ${cachedCostStr} + Output: ${outCostStr} | Cache Saved: ${savedCostStr}${modelBreakdownTip})`;

    return {
      normThresholds,
      latestCtx,
      peakCtx,
      baselineCtx,
      latestStepIdx,
      plannerSteps,
      totalIn,
      totalCache,
      totalOut,
      cumulative,
      latestCacheRatio,
      overallCacheRatio,
      warnCompact,
      critCompact,
      severity,
      statusEmoji,
      statusClass,
      statusTitle,
      totalCostStr,
      costTooltip
    };
  }

  public static renderCollapsedTokenSummary(
    tokenUsage?: TokenUsageSummary,
    thresholds?: Partial<TokenThresholdConfig>,
    pricingConfig?: Partial<ModelPricingConfig>
  ): { statusDotHtml: string; tokenTextHtml: string } {
    if (!tokenUsage || SessionScanner.coerceNonNegativeInt(tokenUsage.plannerStepCount) === 0) {
      return { statusDotHtml: '', tokenTextHtml: '' };
    }
    const m = TokenUsageMonitor.resolveBannerStatusMeta(tokenUsage, thresholds, pricingConfig);
    const statusDotHtml = `<span class="token-status-dot ${m.statusClass}" title="${TokenUsageMonitor.escapeHtml(m.statusTitle)}">${m.statusEmoji}</span>`;
    const parts = [
      `<span class="collapsed-tok-item" title="${TokenUsageMonitor.escapeHtml(m.costTooltip)}">💰${m.totalCostStr}</span>`,
      `<span class="collapsed-tok-item" title="Latest Context Window: ${m.latestCtx.toLocaleString()}">⚡${SessionScanner.formatCompactTokens(m.latestCtx)}</span>`,
      `<span class="collapsed-tok-item" title="Total Uncached Input: ${m.totalIn.toLocaleString()}">📥${SessionScanner.formatCompactTokens(m.totalIn)}</span>`,
      `<span class="collapsed-tok-item" title="Total KV Cache Read: ${m.totalCache.toLocaleString()}">💾${SessionScanner.formatCompactTokens(m.totalCache)}</span>`,
      `<span class="collapsed-tok-item" title="Total Output: ${m.totalOut.toLocaleString()}">📤${SessionScanner.formatCompactTokens(m.totalOut)}</span>`,
      `<span class="collapsed-tok-item" title="Peak Context Window: ${m.peakCtx.toLocaleString()}">🏔️${SessionScanner.formatCompactTokens(m.peakCtx)}</span>`,
      `<span class="collapsed-tok-item" title="Latest Cache Hit: ${m.latestCacheRatio}% (Overall Σ${m.overallCacheRatio}%)">♻️${m.latestCacheRatio}%</span>`
    ];
    return {
      statusDotHtml,
      tokenTextHtml: parts.join('')
    };
  }

  public static renderReaderTokenBannerHtml(
    tokenUsage?: TokenUsageSummary,
    thresholds?: Partial<TokenThresholdConfig>,
    pricingConfig?: Partial<ModelPricingConfig>,
    treeTokenUsage?: TreeTokenRollup
  ): string {
    if (!tokenUsage || SessionScanner.coerceNonNegativeInt(tokenUsage.plannerStepCount) === 0) {
      if (!treeTokenUsage || treeTokenUsage.executorCount <= 1 || treeTokenUsage.cumulativeTokens <= 0) {
        return `<div class="token-telemetry-banner token-telemetry-empty" id="readerTokenBanner" style="display:none;"></div>`;
      }
    }

    const effectiveSummary: TokenUsageSummary =
      tokenUsage && SessionScanner.coerceNonNegativeInt(tokenUsage.plannerStepCount) > 0
        ? tokenUsage
        : SessionScanner.computeTokenUsageFromRawSteps([]);

    const m = TokenUsageMonitor.resolveBannerStatusMeta(effectiveSummary, thresholds, pricingConfig);
    const statusBadgeHtml = `<span class="token-status-pill ${m.statusClass}" title="${TokenUsageMonitor.escapeHtml(m.statusTitle)}">${m.statusEmoji}</span>`;
    const svgChartHtml = TokenUsageMonitor.renderTokenUsageSvgChart(
      effectiveSummary,
      m.normThresholds.warningThreshold,
      m.normThresholds.criticalThreshold
    );

    const orderedDescSteps = [...(Array.isArray(effectiveSummary.stepMetrics) ? effectiveSummary.stepMetrics : [])].sort(
      (a, b) => SessionScanner.coerceNonNegativeInt(b.stepIndex) - SessionScanner.coerceNonNegativeInt(a.stepIndex)
    );

    const stepRows = orderedDescSteps
      .map((s) => {
        const sIdx = SessionScanner.coerceNonNegativeInt(s.stepIndex);
        const sCtx = SessionScanner.coerceNonNegativeInt(s.totalContextTokens);
        const sCache = SessionScanner.coerceNonNegativeInt(s.cacheReadTokens);
        const sIn = SessionScanner.coerceNonNegativeInt(s.inputTokens);
        const sOut = SessionScanner.coerceNonNegativeInt(s.outputTokens);
        const sRatio = Number(s.cacheHitRatio || 0).toFixed(1);
        const tools = Array.isArray(s.toolNames) && s.toolNames.length > 0 ? TokenUsageMonitor.escapeHtml(s.toolNames.join(', ')) : '—';
        const rowClass = s.isCacheMiss ? ' class="token-step-row-miss"' : '';
        const missTag = s.isCacheMiss ? ` <span class="step-cache-miss-badge">⚠️ Miss</span>` : '';
        return `<tr${rowClass}><td>#${sIdx}${missTag}</td><td><strong>${SessionScanner.formatCompactTokens(sCtx)}</strong> <span class="token-dim">(${sCtx.toLocaleString()})</span></td><td>${SessionScanner.formatCompactTokens(sCache)} <span class="token-dim">(${sRatio}%)</span></td><td>+${SessionScanner.formatCompactTokens(sIn)}</td><td>${SessionScanner.formatCompactTokens(sOut)}</td><td class="token-tools-cell">${tools}</td></tr>`;
      })
      .join('');

    return [
      `<div class="token-telemetry-banner token-severity-${m.severity}" id="readerTokenBanner">`,
      `<details class="token-telemetry-drawer" id="tokenTelemetryDrawer" data-step="token-telemetry-drawer">`,
      `<summary class="token-telemetry-summary">`,
      `<span class="token-metric-pill token-cost-pill" title="${TokenUsageMonitor.escapeHtml(m.costTooltip)}">💰${m.totalCostStr}</span>`,
      `<span class="token-metric-pill" title="Latest Context Window at Step #${m.latestStepIdx}: ${m.latestCtx.toLocaleString()} tokens">⚡${SessionScanner.formatCompactTokens(m.latestCtx)}<span class="token-dim">(#${m.latestStepIdx})</span>${statusBadgeHtml}</span>`,
      `<span class="token-metric-pill" title="Cumulative Uncached Input Tokens: ${m.totalIn.toLocaleString()}">📥${SessionScanner.formatCompactTokens(m.totalIn)}</span>`,
      `<span class="token-metric-pill" title="Cumulative KV Cache Read Tokens: ${m.totalCache.toLocaleString()}">💾${SessionScanner.formatCompactTokens(m.totalCache)}</span>`,
      `<span class="token-metric-pill" title="Cumulative Model Output Tokens: ${m.totalOut.toLocaleString()} | Total Session Tokens: ${m.cumulative.toLocaleString()}">📤${SessionScanner.formatCompactTokens(m.totalOut)}</span>`,
      `<span class="token-metric-pill" title="Peak Context Window: ${m.peakCtx.toLocaleString()} tokens (Baseline #1: ${m.baselineCtx.toLocaleString()})">🏔️${SessionScanner.formatCompactTokens(m.peakCtx)}</span>`,
      `<span class="token-metric-pill" title="Latest Prompt Cache Hit Ratio: ${m.latestCacheRatio}% | Session Overall Cache Hit: ${m.overallCacheRatio}% (${m.totalCache.toLocaleString()} cached tokens)">♻️${m.latestCacheRatio}%<span class="token-dim">(Σ${m.overallCacheRatio}%)</span></span>`,
      `<span class="token-drawer-toggle-hint" title="Toggle Token Usage Chart & Step Table (${m.plannerSteps} turns)">▾Chart(${m.plannerSteps})</span>`,
      `</summary>`,
      `<div class="token-telemetry-drawer-body">`,
      `<div class="token-chart-legend">`,
      `<span><i class="token-legend-swatch token-swatch-cache"></i> KV Cache Read (<code>cache_read_tokens</code>)</span>`,
      `<span><i class="token-legend-swatch token-swatch-input"></i> Uncached Input (<code>input_tokens</code>)</span>`,
      `<span><i class="token-legend-swatch token-swatch-miss"></i> Mid-Session Cache Miss (&gt;25k uncached)</span>`,
      `<span><i class="token-legend-line token-line-warn"></i> Warn (${m.warnCompact})</span>`,
      `<span><i class="token-legend-line token-line-crit"></i> Critical (${m.critCompact})</span>`,
      `</div>`,
      svgChartHtml,
      `<div class="token-step-table-wrap">`,
      `<table class="token-step-table">`,
      `<thead><tr><th>Step</th><th>Context Window</th><th>KV Cache Read</th><th>Uncached +In</th><th>Output</th><th>Tools Invoked</th></tr></thead>`,
      `<tbody>${stepRows}</tbody>`,
      `</table>`,
      `</div>`,
      `</div>`,
      `</details>`,
      treeTokenUsage && treeTokenUsage.executorCount > 1
        ? (() => {
            const tCost = TokenUsageMonitor.calculateTokenCost(treeTokenUsage, pricingConfig);
            const tCostStr = TokenUsageMonitor.formatUsdCost(tCost.totalCost);
            const subCount = treeTokenUsage.executorCount - 1;
            const subLabel = `${subCount} subagent${subCount === 1 ? '' : 's'}`;
            const tTooltip = `Tree Total across Coordinator + ${subLabel}: ${treeTokenUsage.cumulativeTokens.toLocaleString()} tokens (${tCostStr})`;
            return `<div class="tree-token-rollup-strip" title="${TokenUsageMonitor.escapeHtml(tTooltip)}"><span class="tree-rollup-label">🤖 Tree Total (Coordinator + ${subLabel}):</span> <span class="tree-rollup-pill">💰${tCostStr}</span> <span class="tree-rollup-pill">Σ${SessionScanner.formatCompactTokens(treeTokenUsage.cumulativeTokens)}</span> <span class="tree-rollup-pill">📥${SessionScanner.formatCompactTokens(treeTokenUsage.totalInputTokens)}</span> <span class="tree-rollup-pill">💾${SessionScanner.formatCompactTokens(treeTokenUsage.totalCacheReadTokens)}</span> <span class="tree-rollup-pill">📤${SessionScanner.formatCompactTokens(treeTokenUsage.totalOutputTokens)}</span> <span class="tree-rollup-pill">♻️${Number(treeTokenUsage.overallCacheHitRatio || 0).toFixed(1)}%</span></div>`;
          })()
        : '',
      `</div>`
    ].join('');
  }

  public static renderStepTokenBadgeHtml(
    msg?: Partial<Pick<ChatMessage, 'inputTokens' | 'cacheReadTokens' | 'outputTokens' | 'totalContextTokens' | 'cacheHitRatio' | 'isCacheMiss'>> | null
  ): string {
    if (!msg) {
      return '';
    }
    const inTok = SessionScanner.coerceNonNegativeInt(msg.inputTokens);
    const cacheTok = SessionScanner.coerceNonNegativeInt(msg.cacheReadTokens);
    const outTok = SessionScanner.coerceNonNegativeInt(msg.outputTokens);
    const totalCtx = SessionScanner.coerceNonNegativeInt(
      msg.totalContextTokens !== undefined ? msg.totalContextTokens : inTok + cacheTok
    );
    if (totalCtx <= 0 && outTok <= 0) {
      return '';
    }
    const cacheRatio =
      msg.cacheHitRatio !== undefined
        ? Number(msg.cacheHitRatio || 0)
        : totalCtx > 0
          ? Math.round((cacheTok / totalCtx) * 1000) / 10
          : 0;

    const ctxCompact = SessionScanner.formatCompactTokens(totalCtx);
    const inCompact = SessionScanner.formatCompactTokens(inTok);
    const outCompact = SessionScanner.formatCompactTokens(outTok);
    const tooltip = `Context: ${totalCtx.toLocaleString()} | Input: ${inTok.toLocaleString()} | Cache Read: ${cacheTok.toLocaleString()} (${cacheRatio.toFixed(1)}%) | Output: ${outTok.toLocaleString()}`;

    const badge = `<span class="step-token-badge" title="${TokenUsageMonitor.escapeHtml(tooltip)}">⚡ Ctx: ${ctxCompact} (${cacheRatio.toFixed(1)}% cache) · +In: ${inCompact} · Out: ${outCompact}</span>`;
    const missBadge = msg.isCacheMiss
      ? `<span class="step-cache-miss-badge" title="KV Cache Miss: 0 cache_read_tokens with >25k input_tokens">⚠️ Cache Miss</span>`
      : '';
    return `${badge}${missBadge}`;
  }

  public static renderSessionTokenBadgeHtml(
    tokenUsage?: TokenUsageSummary,
    thresholds?: Partial<TokenThresholdConfig>,
    pricingConfig?: Partial<ModelPricingConfig>
  ): string {
    if (!tokenUsage) {
      return '';
    }
    const peakCtx = SessionScanner.coerceNonNegativeInt(tokenUsage.peakContextTokens);
    if (peakCtx <= 0) {
      return '';
    }
    const normThresholds = TokenUsageMonitor.resolveEffectiveThresholds(tokenUsage, thresholds, pricingConfig);
    const latestCtx = SessionScanner.coerceNonNegativeInt(tokenUsage.latestContextTokens);
    const overallCache = Number(tokenUsage.overallCacheHitRatio || 0);
    const totalCache = SessionScanner.coerceNonNegativeInt(tokenUsage.totalCacheReadTokens);
    const totalOut = SessionScanner.coerceNonNegativeInt(tokenUsage.totalOutputTokens);
    const cost = TokenUsageMonitor.calculateTokenCost(tokenUsage, pricingConfig);
    const costFmt = TokenUsageMonitor.formatUsdCost(cost.totalCost);

    let sevClass = 'token-ok';
    if (peakCtx >= normThresholds.criticalThreshold || latestCtx >= normThresholds.criticalThreshold) {
      sevClass = 'token-crit';
    } else if (
      peakCtx >= normThresholds.warningThreshold ||
      latestCtx >= normThresholds.warningThreshold ||
      Boolean(tokenUsage.hasCacheMissAtTail)
    ) {
      sevClass = 'token-warn';
    }

    const peakCompact = SessionScanner.formatCompactTokens(peakCtx);
    const cachePct = Math.round(overallCache);
    const tooltip = `Peak Context: ${peakCtx.toLocaleString()} tokens (Latest: ${latestCtx.toLocaleString()}) | Cache Hit: ${overallCache.toFixed(1)}% (Σ Cached: ${totalCache.toLocaleString()}) | Σ Output: ${totalOut.toLocaleString()} | Est. Cost: ${costFmt}`;
    return `<span class="meta-tag session-token-badge ${sevClass}" title="${TokenUsageMonitor.escapeHtml(tooltip)}">⚡ ${peakCompact} ctx · ${cachePct}% cache · ${costFmt}</span>`;
  }

  public static renderSidebarRollupHtml(
    rollup: ProjectTokenRollup,
    scopeLabel: string = 'Visible Chats'
  ): string {
    const inCompact = SessionScanner.formatCompactTokens(rollup.totalInputTokens);
    const cacheCompact = SessionScanner.formatCompactTokens(rollup.totalCacheReadTokens);
    const outCompact = SessionScanner.formatCompactTokens(rollup.totalOutputTokens);
    const costStr = TokenUsageMonitor.formatUsdCost(rollup.cost.totalCost);
    const inCostStr = TokenUsageMonitor.formatUsdCost(rollup.cost.inputCost);
    const cacheCostStr = TokenUsageMonitor.formatUsdCost(rollup.cost.cachedCost);
    const outCostStr = TokenUsageMonitor.formatUsdCost(rollup.cost.outputCost);
    const savedStr = TokenUsageMonitor.formatUsdCost(rollup.cost.cacheSavings);
    const tooltip = `${scopeLabel} (${rollup.sessionCount} chats) | Σ Input: ${rollup.totalInputTokens.toLocaleString()} (${inCostStr}) | Σ Cached: ${rollup.totalCacheReadTokens.toLocaleString()} (${cacheCostStr}) | Σ Output: ${rollup.totalOutputTokens.toLocaleString()} (${outCostStr}) | Cache Saved: ${savedStr}`;

    return [
      `<div class="sidebar-token-rollup" id="sidebarTokenRollup" title="${TokenUsageMonitor.escapeHtml(tooltip)}">`,
      `<div class="sidebar-rollup-header">`,
      `<span class="sidebar-rollup-scope" id="sidebarRollupScope">${TokenUsageMonitor.escapeHtml(scopeLabel)} (${rollup.sessionCount})</span>`,
      `<span class="sidebar-rollup-cost" id="sidebarRollupCost">💰 ~${costStr}</span>`,
      `</div>`,
      `<div class="sidebar-rollup-metrics" id="sidebarRollupMetrics">`,
      `<span>📥 ${inCompact}</span>`,
      `<span>💾 ${cacheCompact}</span>`,
      `<span>📤 ${outCompact}</span>`,
      `<span>♻️ ${Number(rollup.overallCacheHitRatio || 0).toFixed(0)}%</span>`,
      `</div>`,
      `</div>`
    ].join('');
  }

  public static getTokenTelemetryCss(): string {
    return `
      .token-telemetry-banner {
        margin: 2px 0 0 0;
        border: none;
        background: transparent;
        color: var(--vscode-foreground);
        font-size: var(--vscode-font-size, 13px);
      }
      .tree-token-rollup-strip {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 4px;
        padding: 3px 8px;
        border-radius: 4px;
        font-size: 11.5px;
        background: var(--vscode-editorWidget-background, rgba(128, 128, 128, 0.08));
        border: 1px solid var(--vscode-panel-border, rgba(128, 128, 128, 0.22));
      }
      .tree-rollup-label {
        font-weight: 600;
        color: var(--vscode-foreground);
      }
      .tree-rollup-pill {
        color: var(--vscode-descriptionForeground);
        white-space: nowrap;
      }
      .token-telemetry-drawer {
        width: 100%;
      }
      .token-telemetry-summary {
        display: flex;
        align-items: center;
        gap: 2px 7px;
        padding: 1px 0;
        cursor: pointer;
        user-select: none;
        list-style: none;
        flex-wrap: wrap;
        line-height: 1.35;
      }
      .token-telemetry-summary::-webkit-details-marker {
        display: none;
      }
      .token-metric-pill {
        display: inline-flex;
        align-items: center;
        gap: 0;
        padding: 0;
        background: transparent;
        border: none;
        color: var(--vscode-foreground);
        font-size: var(--vscode-font-size, 13px);
        font-family: var(--vscode-font-family, inherit);
        white-space: nowrap;
      }
      .token-dim {
        opacity: 0.72;
        font-size: 0.9em;
      }
      .token-status-pill,
      .token-status-dot {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        margin-left: 2px;
        background: transparent;
        border: none;
        font-size: 11px;
        line-height: 1;
        white-space: nowrap;
      }
      .session-token-badge.token-ok {
        background: rgba(40, 167, 69, 0.16);
        color: var(--vscode-testing-iconPassed, #4ec9b0);
        border: 1px solid rgba(40, 167, 69, 0.35);
      }
      .session-token-badge.token-warn {
        background: rgba(204, 167, 0, 0.18);
        color: var(--vscode-editorWarning-foreground, #cca700);
        border: 1px solid rgba(204, 167, 0, 0.4);
      }
      .session-token-badge.token-crit {
        background: rgba(241, 76, 76, 0.18);
        color: var(--vscode-editorError-foreground, #f14c4c);
        border: 1px solid rgba(241, 76, 76, 0.45);
      }
      .token-drawer-toggle-hint {
        margin-left: auto;
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
        white-space: nowrap;
        flex-shrink: 0;
      }
      .token-drawer-toggle-hint:hover {
        color: var(--vscode-foreground);
      }
      .token-telemetry-drawer-body {
        margin-top: 4px;
        padding: 6px 8px 8px 8px;
        border: 1px solid var(--vscode-panel-border, rgba(128, 128, 128, 0.25));
        border-radius: 4px;
        background: var(--vscode-editorWidget-background, rgba(128, 128, 128, 0.06));
      }
      .token-chart-legend {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin-bottom: 6px;
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
      }
      .token-legend-swatch {
        display: inline-block;
        width: 10px;
        height: 10px;
        border-radius: 2px;
        vertical-align: middle;
        margin-right: 3px;
      }
      .token-swatch-cache,
      .token-bar-cache {
        background: var(--vscode-charts-blue, #3794ff);
        fill: var(--vscode-charts-blue, #3794ff);
      }
      .token-swatch-input,
      .token-bar-input {
        background: var(--vscode-charts-orange, #d18616);
        fill: var(--vscode-charts-orange, #d18616);
      }
      .token-swatch-miss,
      .token-bar-miss {
        background: var(--vscode-editorError-foreground, #f14c4c);
        fill: var(--vscode-editorError-foreground, #f14c4c);
      }
      .token-legend-line {
        display: inline-block;
        width: 14px;
        height: 0;
        border-top: 2px dashed;
        vertical-align: middle;
        margin-right: 3px;
      }
      .token-line-warn {
        border-color: var(--vscode-editorWarning-foreground, #cca700);
      }
      .token-line-crit {
        border-color: var(--vscode-editorError-foreground, #f14c4c);
      }
      .token-step-chart-scroll {
        width: 100%;
        overflow-x: auto;
        margin-bottom: 8px;
      }
      .token-step-chart {
        display: block;
        min-width: 280px;
        max-height: 130px;
      }
      .token-grid-baseline {
        stroke: var(--vscode-panel-border, rgba(128, 128, 128, 0.4));
        stroke-width: 1;
      }
      .token-threshold-warn {
        stroke: var(--vscode-editorWarning-foreground, #cca700);
        stroke-width: 1;
      }
      .token-threshold-crit {
        stroke: var(--vscode-editorError-foreground, #f14c4c);
        stroke-width: 1;
      }
      .token-threshold-label,
      .token-axis-label {
        font-size: 9px;
        fill: var(--vscode-descriptionForeground);
        font-family: var(--vscode-editor-font-family, monospace);
      }
      .token-step-table-wrap {
        position: relative;
        isolation: isolate;
        max-height: 220px;
        overflow-y: auto;
        border: 1px solid var(--vscode-panel-border, rgba(128, 128, 128, 0.2));
        border-radius: 4px;
        background: var(--vscode-editor-background, #1e1e1e);
      }
      .token-step-table {
        width: 100%;
        margin: 0;
        border-collapse: separate;
        border-spacing: 0;
        font-size: 11px;
      }
      .token-step-table th,
      .token-step-table td {
        padding: 4px 8px;
        text-align: left;
        border: none;
        border-bottom: 1px solid var(--vscode-panel-border, rgba(128, 128, 128, 0.15));
      }
      .token-step-table thead th {
        position: sticky;
        top: 0;
        z-index: 2;
        background: var(--vscode-editor-background, #1e1e1e);
        box-shadow: inset 0 -1px 0 var(--vscode-panel-border, rgba(128, 128, 128, 0.3)), inset 0 0 0 999px rgba(128, 128, 128, 0.08);
        color: var(--vscode-descriptionForeground);
        font-weight: 600;
        vertical-align: middle;
        border-bottom: 1px solid var(--vscode-panel-border, rgba(128, 128, 128, 0.3));
        white-space: nowrap;
      }
      .token-step-row-miss {
        background: rgba(241, 76, 76, 0.1);
      }
      .token-tools-cell {
        max-width: 220px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .step-token-badge {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 1px 7px;
        margin-left: 6px;
        border-radius: 999px;
        font-size: 10.5px;
        font-family: var(--vscode-editor-font-family, monospace);
        background: var(--vscode-badge-background, rgba(128, 128, 128, 0.18));
        color: var(--vscode-badge-foreground, var(--vscode-foreground));
        border: 1px solid var(--vscode-panel-border, rgba(128, 128, 128, 0.25));
        white-space: nowrap;
      }
      .step-cache-miss-badge {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        padding: 1px 6px;
        margin-left: 4px;
        border-radius: 999px;
        font-size: 10.5px;
        font-weight: 600;
        background: rgba(241, 76, 76, 0.18);
        color: var(--vscode-editorError-foreground, #f14c4c);
        border: 1px solid rgba(241, 76, 76, 0.45);
        white-space: nowrap;
      }
      .session-token-badge {
        font-family: var(--vscode-editor-font-family, monospace);
        font-size: 10.5px;
      }
      .sidebar-token-rollup {
        margin-top: 8px;
        padding: 6px 8px;
        border-radius: 5px;
        border: 1px solid var(--vscode-panel-border, rgba(128, 128, 128, 0.22));
        background: var(--vscode-editor-background, rgba(128, 128, 128, 0.08));
        font-size: 11px;
      }
      .sidebar-rollup-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        margin-bottom: 3px;
        font-weight: 600;
      }
      .sidebar-rollup-scope {
        color: var(--vscode-descriptionForeground);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .sidebar-rollup-cost {
        color: var(--vscode-charts-green, #4ec9b0);
        font-family: var(--vscode-editor-font-family, monospace);
        white-space: nowrap;
      }
      .sidebar-rollup-metrics {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        font-family: var(--vscode-editor-font-family, monospace);
        font-size: 10.5px;
        color: var(--vscode-foreground);
        opacity: 0.9;
      }
      body.vscode-light .token-status-pill.token-ok,
      body.vscode-light .session-token-badge.token-ok {
        background: rgba(27, 127, 55, 0.12);
        color: var(--vscode-testing-iconPassed, #1b7f37);
      }
      body.vscode-light .token-status-pill.token-warn,
      body.vscode-light .session-token-badge.token-warn {
        background: rgba(154, 103, 0, 0.14);
        color: var(--vscode-editorWarning-foreground, #9a6700);
      }
      body.vscode-light .token-status-pill.token-crit,
      body.vscode-light .session-token-badge.token-crit {
        background: rgba(207, 34, 46, 0.14);
        color: var(--vscode-editorError-foreground, #cf222e);
      }
      body.vscode-high-contrast .token-telemetry-banner,
      body.vscode-high-contrast .step-token-badge,
      body.vscode-high-contrast .step-cache-miss-badge,
      body.vscode-high-contrast .session-token-badge {
        border-width: 1.5px;
        border-color: var(--vscode-contrastBorder, #ffffff);
      }
    `;
  }

  public getTailStateForTest(filePath: string): TailFileState | undefined {
    return this.tailStates.get(path.resolve(filePath));
  }

  public getActiveSessionId(): string | undefined {
    return this.activeSessionId;
  }

  public async readIncrementalTokenUsage(filePath: string, sessionId: string): Promise<TokenUsageSummary> {
    const resolvedPath = path.resolve(filePath);
    const existingLock = this.fileReadLocks.get(resolvedPath);
    if (existingLock) {
      return existingLock.then(() => this.performIncrementalRead(resolvedPath, sessionId));
    }

    const readPromise = this.performIncrementalRead(resolvedPath, sessionId).finally(() => {
      this.fileReadLocks.delete(resolvedPath);
    });
    this.fileReadLocks.set(resolvedPath, readPromise);
    return readPromise;
  }

  private async performIncrementalRead(resolvedPath: string, sessionId: string): Promise<TokenUsageSummary> {
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(resolvedPath);
    } catch {
      this.tailStates.delete(resolvedPath);
      return SessionScanner.computeTokenUsageFromRawSteps([]);
    }

    let state = this.tailStates.get(resolvedPath);
    if (!state || state.sessionId !== sessionId || stat.size < state.lastByteOffset) {
      state = {
        filePath: resolvedPath,
        sessionId,
        lastByteOffset: 0,
        lastMtimeMs: 0,
        partialLineBuffer: '',
        rawStepsByIndex: new Map<number, any>(),
        fallbackOrderedSteps: [],
        fallbackSigSet: new Set<string>(),
        latestSummary: SessionScanner.computeTokenUsageFromRawSteps([])
      };
      this.tailStates.set(resolvedPath, state);
    }

    if (stat.size === state.lastByteOffset && stat.mtimeMs === state.lastMtimeMs && state.lastByteOffset > 0) {
      return state.latestSummary;
    }

    const bytesToRead = stat.size - state.lastByteOffset;
    if (bytesToRead <= 0) {
      state.lastMtimeMs = stat.mtimeMs;
      return state.latestSummary;
    }

    let chunkText = '';
    let handle: fs.promises.FileHandle | undefined;
    try {
      handle = await fs.promises.open(resolvedPath, 'r');
      const buffer = Buffer.alloc(bytesToRead);
      const { bytesRead } = await handle.read(buffer, 0, bytesToRead, state.lastByteOffset);
      chunkText = buffer.subarray(0, bytesRead).toString('utf8');
      state.lastByteOffset += bytesRead;
      state.lastMtimeMs = stat.mtimeMs;
    } catch {
      return state.latestSummary;
    } finally {
      if (handle) {
        try {
          await handle.close();
        } catch {}
      }
    }

    const combined = state.partialLineBuffer + chunkText;
    const rawLines = combined.split(/\r?\n/);
    // The last element after split(/\r?\n/) is '' if combined ended with \n, or an incomplete trailing line if not
    state.partialLineBuffer = rawLines.pop() || '';

    for (const line of rawLines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      try {
        const data = JSON.parse(trimmed);
        if (typeof data.step_index === 'number') {
          const prev = state.rawStepsByIndex.get(data.step_index);
          if (prev) {
            const prevLen = (prev.content || '').length + (prev.thinking || '').length;
            const currLen = (data.content || '').length + (data.thinking || '').length;
            const prevTrunc = Array.isArray(prev.truncated_fields) ? prev.truncated_fields.length : 0;
            const currTrunc = Array.isArray(data.truncated_fields) ? data.truncated_fields.length : 0;
            if (currLen >= prevLen || currTrunc <= prevTrunc) {
              state.rawStepsByIndex.set(data.step_index, data);
            }
          } else {
            state.rawStepsByIndex.set(data.step_index, data);
          }
        } else {
          const sig = `${data.type || ''}:${data.created_at || ''}:${(data.content || '').slice(0, 120)}`;
          if (!state.fallbackSigSet.has(sig)) {
            state.fallbackSigSet.add(sig);
            state.fallbackOrderedSteps.push(data);
          }
        }
      } catch {
        // Ignore malformed JSON line
      }
    }

    const indexedSteps = Array.from(state.rawStepsByIndex.entries())
      .sort((a, b) => a[0] - b[0])
      .map((entry) => entry[1]);
    const allOrderedSteps = [...indexedSteps, ...state.fallbackOrderedSteps];
    state.latestSummary = SessionScanner.computeTokenUsageFromRawSteps(allOrderedSteps);
    return state.latestSummary;
  }

  public initialize(context: vscode.ExtensionContext): void {
    if (!this.statusBarItem) {
      this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
      this.statusBarItem.command = 'brainHub.openActiveTokenSession';
      context.subscriptions.push(this.statusBarItem);
    }

    this.startWatching();
    this.triggerRefresh();
  }

  public startWatching(): void {
    this.stopWatching();
    const enabled = vscode.workspace.getConfiguration('brainHub').get<boolean>('enableTokenStatusBar', true);
    if (!enabled) {
      if (this.statusBarItem) {
        this.statusBarItem.hide();
      }
      return;
    }

    const scanner = SessionScanner.getInstance();
    const dirs = scanner.getAllTargetDirectories();
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        continue;
      }
      const listener: fs.WatchListener<string> = (_event, filename) => {
        if (filename && !filename.includes('transcript') && !filename.endsWith('.jsonl')) {
          if (!scanner.isRelevantWatchEvent(filename)) {
            return;
          }
        }
        this.scheduleRefresh(60);
      };
      try {
        const w = fs.watch(dir, { persistent: false, recursive: true }, listener);
        this.activeWatchers.push(w);
      } catch {
        try {
          const wFallback = fs.watch(dir, { persistent: false }, listener);
          this.activeWatchers.push(wFallback);
        } catch {}
      }
    }

    this.pollTimer = setInterval(() => {
      this.scheduleRefresh(60);
    }, 3000);
  }

  public stopWatching(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    for (const w of this.activeWatchers) {
      try {
        w.close();
      } catch {}
    }
    this.activeWatchers = [];
  }

  public scheduleRefresh(delayMs: number = 60): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      this.triggerRefresh();
    }, delayMs);
  }

  public async triggerRefresh(preferredSessionId?: string): Promise<void> {
    const enabled = vscode.workspace.getConfiguration('brainHub').get<boolean>('enableTokenStatusBar', true);
    if (!enabled) {
      if (this.statusBarItem) {
        this.statusBarItem.hide();
      }
      return;
    }

    if (this.isRefreshing) {
      this.pendingRefresh = true;
      if (preferredSessionId !== undefined) {
        this.pendingPreferredSessionId = preferredSessionId;
      }
      if (this.activeRefreshPromise) {
        await this.activeRefreshPromise;
      }
      return;
    }

    this.isRefreshing = true;
    this.pendingPreferredSessionId = preferredSessionId;
    this.activeRefreshPromise = (async () => {
      try {
        do {
          this.pendingRefresh = false;
          const nextPreferred = this.pendingPreferredSessionId;
          this.pendingPreferredSessionId = undefined;
          await this.refreshActiveSessionStatusBar(nextPreferred);
        } while (this.pendingRefresh);
      } finally {
        this.isRefreshing = false;
        this.activeRefreshPromise = undefined;
      }
    })();

    await this.activeRefreshPromise;
  }

  private async refreshActiveSessionStatusBar(preferredSessionId?: string): Promise<void> {
    const scanner = SessionScanner.getInstance();
    let sessions = scanner.hasValidCache() ? scanner.getCachedSessions(false) : [];
    if (sessions.length === 0) {
      try {
        sessions = await scanner.scanSessions(false, false);
      } catch {
        sessions = [];
      }
    }

    let candidate: ChatSession | undefined;
    if (preferredSessionId) {
      candidate = sessions.find((s) => s.id === preferredSessionId);
    }

    if (!candidate) {
      const wsFolders = vscode.workspace.workspaceFolders || [];
      if (wsFolders.length > 0) {
        const wsSessions = sessions.filter((s) =>
          wsFolders.some((f) => SessionScanner.matchSessionToWorkspaceFolder(s, f.uri.fsPath, f.name) !== null)
        );
        if (wsSessions.length > 0) {
          candidate = wsSessions.find((s) => !s.executorParentId) || wsSessions[0];
        }
      }
    }

    if (!candidate && sessions.length > 0) {
      candidate = sessions.find((s) => !s.executorParentId) || sessions[0];
    }

    if (!candidate || !candidate.path) {
      if (this.statusBarItem) {
        this.statusBarItem.hide();
      }
      return;
    }

    this.activeSessionId = candidate.id;
    this.activeSessionMeta = {
      id: candidate.id,
      title: candidate.title,
      workspaceName: candidate.workspaceName,
      workspacePath: candidate.workspacePath,
      path: candidate.path
    };

    const transcriptFile = scanner.getTranscriptFilePath(candidate.path, false);
    let summary: TokenUsageSummary | undefined = candidate.tokenUsage;
    if (transcriptFile && fs.existsSync(transcriptFile)) {
      summary = await this.readIncrementalTokenUsage(transcriptFile, candidate.id);
      candidate.tokenUsage = summary;
    }

    // Incrementally tail active/linked descendant executors under the same execution tree
    const rootKey = (candidate.executorRootId || candidate.id).toLowerCase();
    const descendants = sessions.filter(
      (s) =>
        s.id.toLowerCase() !== candidate!.id.toLowerCase() &&
        ((s.executorRootId && s.executorRootId.toLowerCase() === rootKey) ||
          (s.executorParentId && s.executorParentId.toLowerCase() === candidate!.id.toLowerCase()))
    );

    let treeRollup: TreeTokenRollup | undefined = candidate.treeTokenUsage;
    if (descendants.length > 0) {
      for (const child of descendants) {
        if (!child.path) continue;
        const childTf = scanner.getTranscriptFilePath(child.path, false);
        if (childTf && fs.existsSync(childTf)) {
          child.tokenUsage = await this.readIncrementalTokenUsage(childTf, child.id);
        }
      }
      const treeMembers = [candidate, ...descendants];
      let totalIn = 0;
      let totalCache = 0;
      let totalOut = 0;
      const modelBreakdown: Record<string, ModelTokenTotals> = {};
      for (const m of treeMembers) {
        const tu = m.tokenUsage;
        if (!tu) continue;
        const mIn = SessionScanner.coerceNonNegativeInt(tu.totalInputTokens);
        const mCache = SessionScanner.coerceNonNegativeInt(tu.totalCacheReadTokens);
        const mOut = SessionScanner.coerceNonNegativeInt(tu.totalOutputTokens);
        totalIn += mIn;
        totalCache += mCache;
        totalOut += mOut;
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
      const cumulative = totalIn + totalCache + totalOut;
      const ctxSum = totalIn + totalCache;
      treeRollup = {
        executorCount: treeMembers.length,
        totalInputTokens: totalIn,
        totalCacheReadTokens: totalCache,
        totalOutputTokens: totalOut,
        cumulativeTokens: cumulative,
        overallCacheHitRatio: ctxSum > 0 ? Math.round((totalCache / ctxSum) * 1000) / 10 : 0,
        modelBreakdown: Object.keys(modelBreakdown).length > 0 ? modelBreakdown : undefined
      };
      if (!candidate.executorParentId) {
        candidate.treeTokenUsage = treeRollup;
      }
    }

    if (!summary || summary.plannerStepCount === 0) {
      if (this.statusBarItem) {
        this.statusBarItem.hide();
      }
      return;
    }

    if (this.statusBarItem) {
      const thresholds = TokenUsageMonitor.getThresholdsFromSettings();
      const pricing = TokenUsageMonitor.getPricingFromSettings();
      const state = TokenUsageMonitor.formatStatusBarState(
        summary,
        this.activeSessionMeta,
        thresholds,
        pricing,
        treeRollup,
        descendants
      );
      this.statusBarItem.text = state.text;
      this.statusBarItem.backgroundColor = state.backgroundColorId
        ? new vscode.ThemeColor(state.backgroundColorId)
        : undefined;
      const md = new vscode.MarkdownString(state.tooltipMarkdown);
      md.isTrusted = true;
      md.supportThemeIcons = true;
      this.statusBarItem.tooltip = md;
      this.statusBarItem.show();
    }
  }

  public dispose(): void {
    this.stopWatching();
    this.tailStates.clear();
    this.fileReadLocks.clear();
    if (this.statusBarItem) {
      this.statusBarItem.dispose();
      this.statusBarItem = undefined;
    }
  }
}
