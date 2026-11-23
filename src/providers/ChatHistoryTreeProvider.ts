import * as path from 'path';
import * as vscode from 'vscode';
import { ChatSession, TimeGroupKey } from '../models/types';
import { SessionScanner } from '../services/SessionScanner';
import { TokenUsageMonitor } from '../services/TokenUsageMonitor';
import { ExecutorLayoutHelper } from '../views/ExecutorLayoutHelper';

export type TreeItemType = TimeGroupTreeItem | SessionTreeItem | LoadingTreeItem;

export class ChatHistoryTreeProvider implements vscode.TreeDataProvider<TreeItemType> {
  private _onDidChangeTreeData: vscode.EventEmitter<TreeItemType | undefined | null | void> = new vscode.EventEmitter<
    TreeItemType | undefined | null | void
  >();
  readonly onDidChangeTreeData: vscode.Event<TreeItemType | undefined | null | void> = this._onDidChangeTreeData.event;

  private isWorkspaceFiltered: boolean = false;
  private cachedSessions: ChatSession[] = [];
  private isScanning: boolean = false;

  public get allSessions(): ChatSession[] {
    return this.cachedSessions;
  }

  public set allSessions(sessions: ChatSession[]) {
    this.cachedSessions = Array.isArray(sessions) ? sessions : [];
  }

  constructor() {
    const defaultFilter = vscode.workspace
      .getConfiguration('brainHub')
      .get<boolean>('filterWorkspaceByDefault', false);
    this.isWorkspaceFiltered = defaultFilter;

    const scanner = SessionScanner.getInstance();
    if (scanner.hasValidCache()) {
      this.cachedSessions = scanner.getCachedSessions();
    }
  }

  public refresh(): void {
    const scanner = SessionScanner.getInstance();
    if (scanner.hasValidCache()) {
      this.cachedSessions = scanner.getCachedSessions();
    }
    this._onDidChangeTreeData.fire();
  }

  public toggleWorkspaceFilter(): boolean {
    this.isWorkspaceFiltered = !this.isWorkspaceFiltered;
    this.refresh();
    return this.isWorkspaceFiltered;
  }

  public setWorkspaceFilter(filtered: boolean): void {
    this.isWorkspaceFiltered = filtered;
    this.refresh();
  }

  public async toggleHideEmptyFilter(): Promise<boolean> {
    const config = vscode.workspace.getConfiguration('brainHub');
    const current = config.get<boolean>('hideEmptySessions', true);
    const updated = !current;
    await config.update('hideEmptySessions', updated, vscode.ConfigurationTarget.Global);
    this.refresh();
    return updated;
  }

  public getWorkspaceFilterState(): boolean {
    return this.isWorkspaceFiltered;
  }

  public getTreeItem(element: TreeItemType): vscode.TreeItem {
    return element;
  }

  public getChildren(element?: TreeItemType): vscode.ProviderResult<TreeItemType[]> {
    const scanner = SessionScanner.getInstance();

    if (!element) {
      if (this.cachedSessions.length === 0) {
        if (scanner.hasValidCache()) {
          this.cachedSessions = scanner.getCachedSessions();
        } else {
          if (!this.isScanning) {
            this.isScanning = true;
            scanner
              .scanSessions()
              .then((sessions) => {
                this.cachedSessions = sessions;
                this.isScanning = false;
                this._onDidChangeTreeData.fire();
              })
              .catch(() => {
                this.isScanning = false;
              });
          }
          return [new LoadingTreeItem()];
        }
      }

      return this.buildRootGroups(this.cachedSessions);
    }

    if (element instanceof TimeGroupTreeItem) {
      return element.sessions.map((session) => new SessionTreeItem(session, this.cachedSessions));
    }

    if (element instanceof SessionTreeItem) {
      const parentIdLower = element.session.id.toLowerCase();
      const refIds = new Set((element.session.executorRefs || []).map((r) => r.conversationId.toLowerCase()));
      const children = this.cachedSessions.filter(
        (s) =>
          s.id.toLowerCase() !== parentIdLower &&
          !element.ancestorIds.has(s.id.toLowerCase()) &&
          ((s.executorParentId && s.executorParentId.toLowerCase() === parentIdLower) ||
            (!s.executorParentId && refIds.has(s.id.toLowerCase())))
      );
      return children.map((child) => {
        const nextAncestors = new Set(element.ancestorIds);
        nextAncestors.add(child.id.toLowerCase());
        return new SessionTreeItem(child, this.cachedSessions, true, nextAncestors);
      });
    }

    return [];
  }

  private buildRootGroups(rawSessions: ChatSession[]): TimeGroupTreeItem[] {
    let sessions = rawSessions.filter((s) => !s.executorParentId);

    if (this.isWorkspaceFiltered) {
      sessions = this.filterSessionsByWorkspace(sessions);
    }

    if (sessions.length === 0) {
      return [];
    }

    const groups = this.groupSessionsByTime(sessions);
    const groupItems: TimeGroupTreeItem[] = [];

    const config = vscode.workspace.getConfiguration('brainHub');
    const expansionMode = config.get<string>('defaultGroupExpansion', 'smart');

    const hasToday = groups.today.length > 0;
    const hasYesterday = groups.yesterday.length > 0;
    const hasWeek = groups.week.length > 0;
    const hasOlder = groups.older.length > 0;

    const getCollapsibleState = (key: TimeGroupKey): vscode.TreeItemCollapsibleState => {
      if (expansionMode === 'allExpanded') {
        return vscode.TreeItemCollapsibleState.Expanded;
      }
      if (expansionMode === 'collapsed') {
        return vscode.TreeItemCollapsibleState.Collapsed;
      }
      // 'smart' mode:
      if (hasToday || hasYesterday) {
        return key === 'today' || key === 'yesterday'
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed;
      }
      if (hasWeek) {
        return key === 'week'
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed;
      }
      if (hasOlder) {
        return key === 'older'
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed;
      }
      return vscode.TreeItemCollapsibleState.Collapsed;
    };

    if (hasToday) {
      groupItems.push(
        new TimeGroupTreeItem(
          'today',
          `Today (${groups.today.length})`,
          groups.today,
          getCollapsibleState('today')
        )
      );
    }

    if (hasYesterday) {
      groupItems.push(
        new TimeGroupTreeItem(
          'yesterday',
          `Yesterday (${groups.yesterday.length})`,
          groups.yesterday,
          getCollapsibleState('yesterday')
        )
      );
    }

      if (hasWeek) {
        groupItems.push(
          new TimeGroupTreeItem(
            'week',
            `Previous 7 Days (${groups.week.length})`,
            groups.week,
            getCollapsibleState('week')
          )
        );
      }

      if (hasOlder) {
        groupItems.push(
          new TimeGroupTreeItem(
            'older',
            `Older (${groups.older.length})`,
            groups.older,
            getCollapsibleState('older')
          )
        );
      }

      return groupItems;
  }

  private filterSessionsByWorkspace(sessions: ChatSession[]): ChatSession[] {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return sessions;
    }

    return sessions.filter((session) =>
      workspaceFolders.some((f) => SessionScanner.matchSessionToWorkspaceFolder(session, f.uri.fsPath, f.name) !== null)
    );
  }

  private groupSessionsByTime(sessions: ChatSession[]): Record<TimeGroupKey, ChatSession[]> {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
    const startOfWeek = startOfToday - 7 * 24 * 60 * 60 * 1000;

    const result: Record<TimeGroupKey, ChatSession[]> = {
      today: [],
      yesterday: [],
      week: [],
      older: []
    };

    const sortBy = vscode.workspace.getConfiguration('brainHub').get<string>('sessionSortBy', 'lastModified');

    for (const session of sessions) {
      const targetDate = sortBy === 'createdAt'
        ? (session.createdAt || session.lastModified)
        : (session.lastModified || session.createdAt);
      const time = targetDate ? targetDate.getTime() : 0;
      if (time >= startOfToday) {
        result.today.push(session);
      } else if (time >= startOfYesterday) {
        result.yesterday.push(session);
      } else if (time >= startOfWeek) {
        result.week.push(session);
      } else {
        result.older.push(session);
      }
    }

    return result;
  }
}

export class TimeGroupTreeItem extends vscode.TreeItem {
  constructor(
    public readonly groupKey: TimeGroupKey,
    public readonly label: string,
    public readonly sessions: ChatSession[],
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(label, collapsibleState);
    this.contextValue = 'timeGroup';
    this.iconPath = new vscode.ThemeIcon('calendar');
  }
}

export class SessionTreeItem extends vscode.TreeItem {
  public readonly ancestorIds: Set<string>;

  constructor(
    public readonly session: ChatSession,
    allSessions: ChatSession[] = [],
    isChildExecutor: boolean = false,
    ancestorIds?: Set<string>
  ) {
    const sessionsList = Array.isArray(allSessions) ? allSessions : [];
    const parentIdLower = session.id.toLowerCase();
    const resolvedAncestors = new Set<string>(ancestorIds ? Array.from(ancestorIds) : []);
    resolvedAncestors.add(parentIdLower);
    const refIds = new Set((session.executorRefs || []).map((r) => r.conversationId.toLowerCase()));
    const directChildren = sessionsList.filter(
      (s) =>
        s.id.toLowerCase() !== parentIdLower &&
        !resolvedAncestors.has(s.id.toLowerCase()) &&
        ((s.executorParentId && s.executorParentId.toLowerCase() === parentIdLower) ||
          (!s.executorParentId && refIds.has(s.id.toLowerCase())))
    );
    const hasChildren = directChildren.length > 0;
    const descendants = hasChildren ? ExecutorLayoutHelper.collectExecutorDescendants(session, sessionsList) : [];
    const hasLiveChild = descendants.some((d) => d.executorStatus === 'running');
    const collapsible = hasChildren
      ? (hasLiveChild ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed)
      : vscode.TreeItemCollapsibleState.None;

    const displayTitle = isChildExecutor && session.executorRole
      ? `${session.executorRole}: ${session.title}`
      : session.title;
    super(displayTitle, collapsible);
    this.ancestorIds = resolvedAncestors;

    const isThread = Boolean((session.childIds && session.childIds.length > 0) || session.parentId);
    const totalArtifacts = session.artifactCount || (session.artifacts ? session.artifacts.length : (session.hasArtifacts ? 1 : 0));
    const hasArtifacts = Boolean(session.hasArtifacts || totalArtifacts > 0);

    const threadPrefix = isThread ? '🧵 ' : '💬 ';
    const artifactPrefix = hasArtifacts ? `📦${totalArtifacts > 0 ? totalArtifacts : ''} ` : '';
    const typeIconStr = `${threadPrefix}${artifactPrefix}`;
    const cDate = session.createdAt || session.lastModified;
    const lDate = session.lastModified || session.createdAt;
    const cTimeStr = this.formatRelativeTime(cDate);
    const lTimeStr = this.formatRelativeTime(lDate);
    const timeStr = (cDate.getTime() === lDate.getTime() || cTimeStr === lTimeStr)
      ? `📅 ${cTimeStr}`
      : `📅 ${cTimeStr} ➔ ${lTimeStr}`;
    const msgCountStr = `💬${session.messageCount}`;
    const hasTreeRollup = Boolean(
      !session.executorParentId &&
      session.treeTokenUsage &&
      session.treeTokenUsage.executorCount > 1 &&
      session.treeTokenUsage.cumulativeTokens > 0
    );
    const hasTokenUsage = Boolean(session.tokenUsage && session.tokenUsage.peakContextTokens > 0);
    let tokenStr = '';
    if (hasTreeRollup && session.treeTokenUsage) {
      const treeCum = SessionScanner.formatCompactTokens(session.treeTokenUsage.cumulativeTokens);
      const treeCachePct = Math.round(Number(session.treeTokenUsage.overallCacheHitRatio || 0));
      const peakStr = hasTokenUsage && session.tokenUsage
        ? `${SessionScanner.formatCompactTokens(session.tokenUsage.peakContextTokens)} ctx · `
        : '';
      tokenStr = ` • ⚡ ${peakStr}Σ ${treeCum} tree (${treeCachePct}% cache)`;
    } else if (hasTokenUsage && session.tokenUsage) {
      tokenStr = ` • ⚡ ${SessionScanner.formatCompactTokens(session.tokenUsage.peakContextTokens)} ctx (${Math.round(Number(session.tokenUsage.overallCacheHitRatio || 0))}% cache)`;
    }
    const wsStr = session.workspaceName ? ` • 📁 ${session.workspaceName}` : '';
    const pcStr = session.machineName ? ` • 💻 ${session.machineName}` : '';

    let execBadgeStr = '';
    if (isChildExecutor) {
      const st = ExecutorLayoutHelper.getStatusDisplay(session.executorStatus);
      const steps = session.stepCount ?? session.messageCount ?? 0;
      const actionStr = session.latestAction ? ` · ${session.latestAction}` : '';
      execBadgeStr = `${st.icon} ${st.label} · ${steps} steps${actionStr} • `;
    } else if (hasChildren || session.swarmSummary) {
      const summaryBadge = ExecutorLayoutHelper.buildExecutorTreeSummaryBadge(session, sessionsList);
      if (summaryBadge.badgeText) {
        execBadgeStr = `${summaryBadge.badgeText} • `;
      }
    }

    this.description = `${execBadgeStr}${typeIconStr}${timeStr} • ${msgCountStr}${tokenStr}${wsStr}${pcStr}`;

    this.contextValue = 'sessionItem';

    const md = new vscode.MarkdownString();
    md.appendMarkdown(`### ${session.title}\n\n`);
    md.appendMarkdown(`- **Session ID**: \`${session.id}\`\n`);
    if (isThread) {
      md.appendMarkdown(`- **🧵 Type**: Connected Conversation Thread\n`);
    } else {
      md.appendMarkdown(`- **💬 Type**: Single Conversation Chat\n`);
    }
    if (session.machineName) {
      md.appendMarkdown(`- **💻 PC Name**: \`${session.machineName}\`\n`);
    }
    if (session.workspaceName || session.workspacePath) {
      md.appendMarkdown(`- **📁 Project Folder**: \`${session.workspacePath || session.workspaceName}\`\n`);
    }
    const cFull = cDate.toLocaleString();
    const lFull = lDate.toLocaleString();
    const dateFullDisplay = (cDate.getTime() === lDate.getTime() || cFull === lFull)
      ? cFull
      : `${cFull} ➔ ${lFull}`;
    md.appendMarkdown(`- **📅 Date**: ${dateFullDisplay}\n`);
    md.appendMarkdown(`- **Messages**: ${session.messageCount} (${session.userPromptCount} user prompts)\n`);
    if (hasTokenUsage && session.tokenUsage) {
      const peakCompact = SessionScanner.formatCompactTokens(session.tokenUsage.peakContextTokens);
      const latestCompact = SessionScanner.formatCompactTokens(session.tokenUsage.latestContextTokens);
      const cachedCompact = SessionScanner.formatCompactTokens(session.tokenUsage.totalCacheReadTokens);
      const outCompact = SessionScanner.formatCompactTokens(session.tokenUsage.totalOutputTokens);
      const cachePct = Number(session.tokenUsage.overallCacheHitRatio || 0).toFixed(1);
      const cost = TokenUsageMonitor.calculateTokenCost(session.tokenUsage);
      const costStr = TokenUsageMonitor.formatUsdCost(cost.totalCost);
      md.appendMarkdown(
        `- **⚡ Token Telemetry**: Peak **${peakCompact}** (${session.tokenUsage.peakContextTokens.toLocaleString()} ctx) · Latest **${latestCompact}** · Cache Hit **${cachePct}%** · Σ Cached **${cachedCompact}** · Σ Out **${outCompact}** · Est. Cost **~${costStr}**\n`
      );
    }
    if (hasTreeRollup && session.treeTokenUsage) {
      const treeCum = SessionScanner.formatCompactTokens(session.treeTokenUsage.cumulativeTokens);
      const treeIn = SessionScanner.formatCompactTokens(session.treeTokenUsage.totalInputTokens);
      const treeCached = SessionScanner.formatCompactTokens(session.treeTokenUsage.totalCacheReadTokens);
      const treeOut = SessionScanner.formatCompactTokens(session.treeTokenUsage.totalOutputTokens);
      const treeCachePct = Number(session.treeTokenUsage.overallCacheHitRatio || 0).toFixed(1);
      const treeCost = TokenUsageMonitor.calculateTokenCost(session.treeTokenUsage);
      const treeCostStr = TokenUsageMonitor.formatUsdCost(treeCost.totalCost);
      md.appendMarkdown(
        `- **🌳 Tree Rollup (${session.treeTokenUsage.executorCount} executors)**: Total **${treeCum}** · In **${treeIn}** · Cached **${treeCached}** (${treeCachePct}%) · Out **${treeOut}** · Est. Cost **~${treeCostStr}**\n`
      );
    }
    if (session.parentId) {
      md.appendMarkdown(`- **🔗 Continued from**: \`${session.parentId}\`\n`);
    }
    if (session.childIds && session.childIds.length > 0) {
      md.appendMarkdown(`- **🧵 Continued in**: ${session.childIds.length} subsequent sessions\n`);
    }
    if (hasArtifacts) {
      md.appendMarkdown(`- **📦 Artifacts**: ${totalArtifacts} item(s) (${session.planPath ? '📋 Plan ' : ''}${session.walkthroughPath ? '✅ Walkthrough' : ''})\n`);
    } else {
      md.appendMarkdown(`- **📦 Artifacts**: None\n`);
    }
    const promptPreview = session.firstPrompt
      ? `${session.firstPrompt.substring(0, 300)}${session.firstPrompt.length > 300 ? '...' : ''}`
      : '';
    if (promptPreview) {
      md.appendMarkdown(`\n---\n\n*${promptPreview}*`);
    }
    this.tooltip = md;

    if (isThread) {
      this.iconPath = new vscode.ThemeIcon(
        'git-commit',
        new vscode.ThemeColor(hasArtifacts ? 'charts.purple' : 'charts.green')
      );
    } else {
      this.iconPath = new vscode.ThemeIcon(
        'comment-discussion',
        new vscode.ThemeColor(hasArtifacts ? 'charts.purple' : 'charts.blue')
      );
    }

    this.command = {
      command: 'brainHub.openChat',
      title: 'Open Chat in Brain Hub',
      arguments: [session]
    };
  }

  private formatRelativeTime(date: Date): string {
    const now = new Date();
    const isToday =
      date.getDate() === now.getDate() &&
      date.getMonth() === now.getMonth() &&
      date.getFullYear() === now.getFullYear();

    if (isToday) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const isYesterday =
      date.getDate() === yesterday.getDate() &&
      date.getMonth() === yesterday.getMonth() &&
      date.getFullYear() === yesterday.getFullYear();

    if (isYesterday) {
      return `Yesterday ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }

    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
}

export class LoadingTreeItem extends vscode.TreeItem {
  constructor(message: string = 'Scanning Antigravity sessions...') {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('loading~spin');
    this.description = 'Please wait...';
    this.contextValue = 'loading';
  }
}
