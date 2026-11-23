export type ExecutorLiveStatus = 'running' | 'waiting' | 'done' | 'error' | 'killed';

export interface ExecutorSessionRef {
  conversationId: string;
  role?: string;
  typeName?: string;
  title?: string;
  state?: string;
  spawnStepIndex?: number;
  kind: 'subagent' | 'swarm_worker' | 'narrator' | 'monitor';
  sourceAuthority?: 'subagent_descriptor' | 'swarm_member' | 'invoke_subagent' | 'inferred_sender';
  status?: ExecutorLiveStatus;
  stepCount?: number;
  latestAction?: string;
  lastActiveAt?: string;
  model?: string;
  tokenUsage?: TokenUsageSummary;
}

export interface TreeTokenRollup {
  executorCount: number;
  totalInputTokens: number;
  totalCacheReadTokens: number;
  totalOutputTokens: number;
  cumulativeTokens: number;
  overallCacheHitRatio: number;
  modelBreakdown?: Record<string, ModelTokenTotals>;
  cost?: TokenCostBreakdown;
}

export interface SwarmSessionSummary {
  title?: string;
  headline?: string;
  goalTitle?: string;
  goalLine?: string;
  phaseLabel?: string;
  memberCount: number;
  workingMemberCount: number;
  boardMessageCount: number;
  threadCount?: number;
  workstreamCount?: number;
  hasOverview?: boolean;
  isRemoteOnly?: boolean;
}

export interface SwarmWorkstreamInfo {
  name: string;
  owners?: string[];
  state?: string;
  progress?: string;
  note?: string;
  tasks?: string[];
}

export interface SwarmOverviewData {
  headline?: string;
  runningSummary?: string;
  goal?: string;
  phase?: string;
  workstreams: SwarmWorkstreamInfo[];
  attention?: string[];
  milestones?: string[];
  risks?: string[];
  tasksMap?: Record<string, string>;
}

export interface SwarmMemberInfo {
  name: string;
  conversationId?: string;
  role?: string;
  model?: string;
  status?: string;
  wakeMode?: string;
  killed?: boolean;
  waitSince?: string;
  lastReadSeq?: number;
  channels?: string[];
  workspaceMode?: string;
  workspace?: string;
}

export interface SwarmBoardMessage {
  seq?: number;
  agent?: string;
  text?: string;
  time?: string;
  channel?: string;
  control?: Record<string, any>;
}

export interface SwarmSessionData {
  title?: string;
  overview?: SwarmOverviewData;
  members: SwarmMemberInfo[];
  boardMessages: SwarmBoardMessage[];
  isRemoteOnly?: boolean;
}

export interface InterAgentMessageMeta {
  senderId?: string;
  senderLabel?: string;
  recipientId?: string;
  messageTitle?: string;
  kind: 'task_assignment' | 'executor_report' | 'system_sdk' | 'status_notice';
}

export interface ToolCallInfo {
  name: string;
  args?: Record<string, any> | string;
  status?: string;
  exitCode?: number;
  output?: string;
  description?: string;
}

export interface ChatMessage {
  index: number;
  userIndex?: number;
  source: 'USER_EXPLICIT' | 'MODEL' | 'SYSTEM' | string;
  type: 'USER_INPUT' | 'PLANNER_RESPONSE' | 'SUBAGENT_NOTIFICATION' | 'CHECKPOINT' | 'CONVERSATION_HISTORY' | 'KNOWLEDGE_ARTIFACTS' | 'RUN_COMMAND' | 'CODE_ACTION' | 'INVOKE_SUBAGENT' | 'SYSTEM_MESSAGE' | 'SYSTEM_SDK' | string;
  status?: string;
  content: string;
  cleanContent: string;
  systemPayloads?: string[];
  thinking?: string;
  toolCalls?: ToolCallInfo[];
  mediaAttachments?: string[];
  createdAt?: string;
  timestamp?: Date;
  truncatedFields?: string[];
  sessionOriginId?: string;
  inputTokens?: number;
  cacheReadTokens?: number;
  outputTokens?: number;
  totalContextTokens?: number;
  cacheHitRatio?: number;
  isCacheMiss?: boolean;
  model?: string;
  interAgentMeta?: InterAgentMessageMeta;
}

export interface TokenStepMetric {
  stepIndex: number;
  inputTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  totalContextTokens: number;
  cacheHitRatio: number;
  isCacheMiss: boolean;
  timestamp?: string;
  toolNames?: string[];
  model?: string;
}

export interface ModelTokenTotals {
  inputTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  stepCount: number;
}

export interface ModelPricingRule {
  pattern: string;
  label?: string;
  inputPer1M: number;
  outputPer1M: number;
  cachedPer1M: number;
  warningThreshold?: number;
  criticalThreshold?: number;
}

export interface ModelPricingRates {
  label?: string;
  inputPer1M: number;
  outputPer1M: number;
  cachedPer1M: number;
}

export interface ModelPricingConfig {
  rules: ModelPricingRule[];
  defaultPricing: ModelPricingRates;
}

export interface TokenModelCostItem {
  model: string;
  label: string;
  inputTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  stepCount: number;
  inputCost: number;
  cachedCost: number;
  outputCost: number;
  totalCost: number;
  cacheSavings: number;
}

export interface TokenCostBreakdown {
  inputCost: number;
  cachedCost: number;
  outputCost: number;
  totalCost: number;
  cacheSavings: number;
  byModel: TokenModelCostItem[];
}

export interface ProjectTokenRollup {
  sessionCount: number;
  totalInputTokens: number;
  totalCacheReadTokens: number;
  totalOutputTokens: number;
  cumulativeTokens: number;
  overallCacheHitRatio: number;
  cost: TokenCostBreakdown;
}

export interface TokenUsageSummary {
  plannerStepCount: number;
  latestStepIndex: number;
  latestInputTokens: number;
  latestCacheReadTokens: number;
  latestOutputTokens: number;
  latestContextTokens: number;
  latestCacheHitRatio: number;
  peakContextTokens: number;
  peakStepIndex: number;
  baselineContextTokens: number;
  totalInputTokens: number;
  totalCacheReadTokens: number;
  totalOutputTokens: number;
  cumulativeTokens: number;
  overallCacheHitRatio: number;
  cacheMissCount: number;
  hasCacheMissAtTail: boolean;
  primaryModel?: string;
  modelBreakdown?: Record<string, ModelTokenTotals>;
  stepMetrics: TokenStepMetric[];
}

export interface SessionArtifactItem {
  name: string;
  filePath: string;
  category: 'document' | 'image' | 'video' | 'scratch' | 'other';
  source: 'ai_generated' | 'user_uploaded' | 'plan' | 'walkthrough' | 'scratch' | 'other';
  sizeBytes: number;
  mtime: Date;
  prompt?: string;
  mimeType?: string;
}

export interface ChatSession {
  id: string;
  path: string;
  paths?: string[];
  title: string;
  firstPrompt: string;
  allPrompts?: string[];
  searchKeywords?: string;
  lastModified: Date;
  createdAt?: Date;
  messageCount: number;
  userPromptCount: number;
  workspaceName?: string;
  workspacePath?: string;
  machineName?: string;
  hasArtifacts: boolean;
  planPath?: string;
  walkthroughPath?: string;
  artifacts?: SessionArtifactItem[];
  artifactCount?: number;
  parentId?: string;
  rootId?: string;
  childIds?: string[];
  threadTitle?: string;
  isEmpty?: boolean;
  runtime?: 'IDE' | 'CLI' | 'Desktop' | 'Custom';
  tokenUsage?: TokenUsageSummary;
  executorRefs?: ExecutorSessionRef[];
  executorParentId?: string;
  executorRootId?: string;
  executorDepth?: number;
  executorRole?: string;
  executorTypeName?: string;
  executorStatus?: ExecutorLiveStatus;
  stepCount?: number;
  latestAction?: string;
  treeTokenUsage?: TreeTokenRollup;
  swarmSummary?: SwarmSessionSummary;
}

export interface ConversationThread {
  id: string;
  title: string;
  sessions: ChatSession[];
  lastModified: Date;
  totalMessages: number;
}

export type TimeGroupKey = 'today' | 'yesterday' | 'week' | 'older';

export interface TimeGroup {
  key: TimeGroupKey;
  label: string;
  icon: string;
  sessions: ChatSession[];
}

export interface SearchResultItem {
  session: ChatSession;
  matchSnippet: string;
  matchedField: 'title' | 'prompt' | 'content' | 'id';
}
