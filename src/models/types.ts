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
  type: 'USER_INPUT' | 'PLANNER_RESPONSE' | 'SUBAGENT_NOTIFICATION' | 'CHECKPOINT' | 'CONVERSATION_HISTORY' | 'KNOWLEDGE_ARTIFACTS' | 'RUN_COMMAND' | 'CODE_ACTION' | string;
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
