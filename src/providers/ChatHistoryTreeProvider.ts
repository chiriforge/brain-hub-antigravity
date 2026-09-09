import * as path from 'path';
import * as vscode from 'vscode';
import { ChatSession, TimeGroupKey } from '../models/types';
import { SessionScanner } from '../services/SessionScanner';

export type TreeItemType = TimeGroupTreeItem | SessionTreeItem;

export class ChatHistoryTreeProvider implements vscode.TreeDataProvider<TreeItemType> {
  private _onDidChangeTreeData: vscode.EventEmitter<TreeItemType | undefined | null | void> = new vscode.EventEmitter<
    TreeItemType | undefined | null | void
  >();
  readonly onDidChangeTreeData: vscode.Event<TreeItemType | undefined | null | void> = this._onDidChangeTreeData.event;

  private isWorkspaceFiltered: boolean = false;
  private cachedSessions: ChatSession[] = [];

  constructor() {
    const defaultFilter = vscode.workspace
      .getConfiguration('antigravityHistory')
      .get<boolean>('filterWorkspaceByDefault', false);
    this.isWorkspaceFiltered = defaultFilter;
  }

  public refresh(): void {
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
    const config = vscode.workspace.getConfiguration('antigravityHistory');
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

  public async getChildren(element?: TreeItemType): Promise<TreeItemType[]> {
    const scanner = SessionScanner.getInstance();

    if (!element) {
      this.cachedSessions = await scanner.scanSessions();

      let sessions = this.cachedSessions;

      if (this.isWorkspaceFiltered) {
        sessions = this.filterSessionsByWorkspace(sessions);
      }

      if (sessions.length === 0) {
        return [];
      }

      const groups = this.groupSessionsByTime(sessions);
      const groupItems: TimeGroupTreeItem[] = [];

      if (groups.today.length > 0) {
        groupItems.push(
          new TimeGroupTreeItem(
            'today',
            `Today (${groups.today.length})`,
            groups.today,
            vscode.TreeItemCollapsibleState.Expanded
          )
        );
      }

      if (groups.yesterday.length > 0) {
        groupItems.push(
          new TimeGroupTreeItem(
            'yesterday',
            `Yesterday (${groups.yesterday.length})`,
            groups.yesterday,
            vscode.TreeItemCollapsibleState.Expanded
          )
        );
      }

      if (groups.week.length > 0) {
        groupItems.push(
          new TimeGroupTreeItem(
            'week',
            `Previous 7 Days (${groups.week.length})`,
            groups.week,
            vscode.TreeItemCollapsibleState.Collapsed
          )
        );
      }

      if (groups.older.length > 0) {
        groupItems.push(
          new TimeGroupTreeItem(
            'older',
            `Older (${groups.older.length})`,
            groups.older,
            vscode.TreeItemCollapsibleState.Collapsed
          )
        );
      }

      return groupItems;
    }

    if (element instanceof TimeGroupTreeItem) {
      return element.sessions.map((session) => new SessionTreeItem(session));
    }

    return [];
  }

  private filterSessionsByWorkspace(sessions: ChatSession[]): ChatSession[] {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return sessions;
    }

    const currentWorkspacePaths = workspaceFolders.map((f) => f.uri.fsPath.toLowerCase());
    const currentWorkspaceNames = workspaceFolders.map((f) => f.name.toLowerCase());

    return sessions.filter((session) => {
      if (session.workspacePath) {
        const lowerWsPath = session.workspacePath.toLowerCase();
        for (const cPath of currentWorkspacePaths) {
          if (lowerWsPath.includes(cPath) || cPath.includes(lowerWsPath)) {
            return true;
          }
        }
      }

      if (session.workspaceName) {
        const lowerName = session.workspaceName.toLowerCase();
        for (const cName of currentWorkspaceNames) {
          if (lowerName === cName) {
            return true;
          }
        }
      }

      return false;
    });
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

    for (const session of sessions) {
      const time = (session.createdAt || session.lastModified).getTime();
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
  constructor(public readonly session: ChatSession) {
    super(session.title, vscode.TreeItemCollapsibleState.None);

    const isThread = Boolean((session.childIds && session.childIds.length > 0) || session.parentId);
    const typeIconStr = `${isThread ? '🧵 ' : ''}${session.hasArtifacts ? '🔖 ' : ''}`;
    const cDate = session.createdAt || session.lastModified;
    const lDate = session.lastModified || session.createdAt;
    const cTimeStr = this.formatRelativeTime(cDate);
    const lTimeStr = this.formatRelativeTime(lDate);
    const timeStr = (cDate.getTime() === lDate.getTime() || cTimeStr === lTimeStr)
      ? `📅 ${cTimeStr}`
      : `📅 ${cTimeStr} ➔ ${lTimeStr}`;
    const msgCountStr = `💬${session.messageCount}`;
    const wsStr = session.workspaceName ? ` • 📁 ${session.workspaceName}` : '';
    const pcStr = session.machineName ? ` • 💻 ${session.machineName}` : '';

    this.description = `${typeIconStr}${timeStr} • ${msgCountStr}${wsStr}${pcStr}`;

    this.contextValue = 'sessionItem';

    const md = new vscode.MarkdownString();
    md.appendMarkdown(`### ${session.title}\n\n`);
    md.appendMarkdown(`- **Session ID**: \`${session.id}\`\n`);
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
    if (session.parentId) {
      md.appendMarkdown(`- **🔗 Continued from**: \`${session.parentId}\`\n`);
    }
    if (session.childIds && session.childIds.length > 0) {
      md.appendMarkdown(`- **🧵 Continued in**: ${session.childIds.length} subsequent sessions\n`);
    }
    if (session.hasArtifacts) {
      md.appendMarkdown(`- **Artifacts**: ${session.planPath ? '📋 Plan ' : ''}${session.walkthroughPath ? '✅ Walkthrough' : ''}\n`);
    }
    md.appendMarkdown(`\n---\n\n*${session.firstPrompt.substring(0, 300)}${session.firstPrompt.length > 300 ? '...' : ''}*`);
    this.tooltip = md;

    if (session.hasArtifacts) {
      this.iconPath = new vscode.ThemeIcon('bookmark', new vscode.ThemeColor('charts.purple'));
    } else if (session.parentId || (session.childIds && session.childIds.length > 0)) {
      this.iconPath = new vscode.ThemeIcon('git-commit', new vscode.ThemeColor('charts.green'));
    } else {
      this.iconPath = new vscode.ThemeIcon('comment-discussion', new vscode.ThemeColor('charts.blue'));
    }

    this.command = {
      command: 'antigravityHistory.openChat',
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
