import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ChatMessage, ChatSession, ToolCallInfo } from '../models/types';
import { SessionScanner } from './SessionScanner';
import { SecretSanitizer } from './SecretSanitizer';

export class MarkdownExporter {
  public static async exportSession(session: ChatSession): Promise<void> {
    const config = vscode.workspace.getConfiguration('brainHub');
    const sanitize = config.get<boolean>('archiver.sanitizeSecrets', true);
    const customPatterns = config.get<string[]>('archiver.customSecretPatterns', []);

    const scanner = SessionScanner.getInstance();
    const data = await scanner.loadFullSession(session.id);

    if (!data) {
      vscode.window.showErrorMessage(`Could not load session ${session.id} for export.`);
      return;
    }

    const mdContent = MarkdownExporter.generateMarkdown(data.session, data.messages, sanitize, customPatterns);

    const safeTitle = (session.title || 'session')
      .replace(/[^a-zA-Z0-9_\-\u00C0-\u024F\u1EA0-\u1EF9]/g, '_')
      .substring(0, 40);
    const dateTag = (session.createdAt || session.lastModified)
      .toISOString()
      .replace(/[:.]/g, '-')
      .substring(0, 19);
    const defaultUri = vscode.Uri.file(`antigravity-${safeTitle}-${dateTag}.md`);

    const targetUri = await vscode.window.showSaveDialog({
      defaultUri,
      filters: {
        'Markdown Files': ['md']
      },
      title: 'Export Antigravity Chat Session'
    });

    if (!targetUri) {
      return;
    }

    try {
      await fs.promises.writeFile(targetUri.fsPath, mdContent, 'utf8');
      const action = await vscode.window.showInformationMessage(
        `Session exported to ${targetUri.fsPath}`,
        'Open File'
      );
      if (action === 'Open File') {
        const doc = await vscode.workspace.openTextDocument(targetUri);
        await vscode.window.showTextDocument(doc);
      }
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to export session: ${err.message}`);
    }
  }

  public static async exportBatchSessions(sessions: ChatSession[]): Promise<void> {
    if (!sessions || sessions.length === 0) {
      vscode.window.showWarningMessage('No sessions selected for export.');
      return;
    }

    const config = vscode.workspace.getConfiguration('brainHub');
    const sanitize = config.get<boolean>('archiver.sanitizeSecrets', true);
    const customPatterns = config.get<string[]>('archiver.customSecretPatterns', []);

    const targetUri = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: 'Select Export Destination Folder',
      title: 'Export Multiple Antigravity Chat Sessions'
    });

    if (!targetUri || targetUri.length === 0) {
      return;
    }

    const exportDir = targetUri[0].fsPath;
    const scanner = SessionScanner.getInstance();

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Exporting ${sessions.length} sessions to Markdown...`,
        cancellable: true
      },
      async (progress, token) => {
        let exportedCount = 0;
        const total = sessions.length;

        for (let i = 0; i < total; i++) {
          if (token.isCancellationRequested) {
            break;
          }
          const s = sessions[i];
          progress.report({
            message: `[${i + 1}/${total}] ${s.title.substring(0, 30)}...`,
            increment: (1 / total) * 100
          });

          try {
            const data = await scanner.loadFullSession(s.id);
            if (data) {
              const md = MarkdownExporter.generateMarkdown(data.session, data.messages, sanitize, customPatterns);
              const safeTitle = (s.title || 'session')
                .replace(/[^a-zA-Z0-9_\-\u00C0-\u024F\u1EA0-\u1EF9]/g, '_')
                .substring(0, 35);
              const dateTag = (s.createdAt || s.lastModified)
                .toISOString()
                .replace(/[:.]/g, '-')
                .substring(0, 19);
              const filename = `session_${dateTag}_${safeTitle}_${s.id.substring(0, 8)}.md`;
              const filePath = path.join(exportDir, filename);
              await fs.promises.writeFile(filePath, md, 'utf8');
              exportedCount++;
            }
          } catch (err) {
            console.warn(`Failed to export session ${s.id}:`, err);
          }
        }

        const action = await vscode.window.showInformationMessage(
          `Successfully exported ${exportedCount} sessions to: ${exportDir}`,
          'Open Destination Folder'
        );
        if (action === 'Open Destination Folder') {
          vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(exportDir));
        }
      }
    );
  }

  public static generateMarkdown(
    session: ChatSession,
    messages: ChatMessage[],
    sanitize: boolean = true,
    customPatterns: string[] = []
  ): string {
    const lines: string[] = [];

    // Helper for sanitizing
    const clean = (text: string | undefined | null): string => {
      if (!text) return '';
      return sanitize ? SecretSanitizer.sanitize(text, customPatterns) : text;
    };

    // Calculate metrics
    let userPromptCount = 0;
    let toolCallCount = 0;
    let errorCount = 0;
    let primaryGoal = session.firstPrompt || session.title || 'Antigravity Development Task';
    if (primaryGoal.length > 90) {
      primaryGoal = primaryGoal.substring(0, 87) + '...';
    }

    let firstTime: Date | null = session.createdAt ? new Date(session.createdAt) : null;
    let lastTime: Date | null = session.lastModified ? new Date(session.lastModified) : null;

    for (const msg of messages) {
      if (msg.type === 'USER_INPUT') {
        userPromptCount++;
      }
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        for (const tc of msg.toolCalls) {
          toolCallCount++;
          if (tc.status === 'ERROR' || (tc.exitCode !== undefined && tc.exitCode !== 0)) {
            errorCount++;
          }
        }
      }
      if (msg.timestamp) {
        if (!firstTime || msg.timestamp < firstTime) {
          firstTime = msg.timestamp;
        }
        if (!lastTime || msg.timestamp > lastTime) {
          lastTime = msg.timestamp;
        }
      }
    }

    let durationStr = 'N/A';
    if (firstTime && lastTime && lastTime.getTime() >= firstTime.getTime()) {
      const diffMs = lastTime.getTime() - firstTime.getTime();
      const minutes = Math.floor(diffMs / 60000);
      const seconds = Math.floor((diffMs % 60000) / 1000);
      durationStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
    }

    const sessionDateStr = (session.createdAt || session.lastModified).toLocaleString('en-US');

    // Header & Summary Card
    lines.push(`# 🪐 Antigravity Chat Session: ${clean(session.title)}`);
    lines.push('');
    lines.push('## 📊 Session Summary & Execution Metrics');
    lines.push('');
    lines.push('| Metric | Value | Metric | Value |');
    lines.push('| :--- | :--- | :--- | :--- |');
    lines.push(`| **Primary Goal** | \`${clean(primaryGoal).replace(/[`|\\]/g, ' ')}\` | **Session Date** | \`${sessionDateStr}\` |`);
    lines.push(`| **Session ID** | \`${session.id}\` | **Duration** | \`${durationStr}\` |`);
    lines.push(`| **Total Prompts** | \`${userPromptCount}\` | **Tool Executions** | \`${toolCallCount}\` |`);
    lines.push(`| **Total Steps** | \`${messages.length}\` | **Issues / Errors** | \`${errorCount}\` |`);
    if (session.workspacePath) {
      lines.push(`| **Workspace** | \`${clean(session.workspacePath)}\` | **Runtime** | \`${session.runtime || 'Antigravity IDE'}\` |`);
    } else {
      lines.push(`| **Runtime** | \`${session.runtime || 'Antigravity IDE'}\` | **Has Artifacts** | \`${session.hasArtifacts ? 'Yes' : 'No'}\` |`);
    }
    lines.push('');
    lines.push('---');
    lines.push('');

    // Messages
    for (const msg of messages) {
      const timeStr = msg.createdAt
        ? new Date(msg.createdAt).toLocaleTimeString('en-US')
        : `Step #${msg.index}`;

      if (msg.type === 'USER_INPUT') {
        lines.push(`### 👤 User <small style="color:#64748b;">(${timeStr})</small>`);
        lines.push('');
        lines.push('> [!NOTE]');
        lines.push('> **User Request & Goal:**');
        lines.push('>');
        lines.push(MarkdownExporter.indentMarkdown(clean(msg.cleanContent || msg.content || '(Empty prompt)'), 2));
        lines.push('');
      } else if (msg.type === 'PLANNER_RESPONSE' || msg.source === 'MODEL') {
        lines.push(`### 🤖 Antigravity AI <small style="color:#64748b;">(${timeStr})</small>`);
        lines.push('');

        // Thinking Block
        if (msg.thinking) {
          lines.push('<details>');
          lines.push(`<summary>🧠 <b>Agent Thought Process & Reasoning</b> <small style="color:#94a3b8;">(${timeStr})</small></summary>`);
          lines.push('');
          lines.push('> [!TIP]');
          lines.push('> **Internal Reasoning:**');
          lines.push('>');
          lines.push(MarkdownExporter.indentMarkdown(clean(msg.thinking), 2));
          lines.push('');
          lines.push('</details>');
          lines.push('');
        }

        // Tool Calls
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          for (const tc of msg.toolCalls) {
            lines.push(MarkdownExporter.formatToolCallMarkdown(tc, timeStr, sanitize, customPatterns));
          }
        }

        // Main AI Response Content
        if (msg.content && msg.content.trim()) {
          lines.push(clean(msg.content));
          lines.push('');
        }
      } else if (msg.type === 'CHECKPOINT') {
        lines.push(`> [!NOTE]`);
        lines.push(`> 📌 **System Context Checkpoint #${msg.index}** *(Context optimized at ${timeStr})*`);
        if (msg.content && msg.content.trim()) {
          lines.push('>');
          lines.push(MarkdownExporter.indentMarkdown(clean(msg.content), 2));
        }
        lines.push('');
      } else if (msg.type === 'SUBAGENT_NOTIFICATION') {
        lines.push(`> 📡 **Subagent Notification #${msg.index}**: ${clean(msg.content)}`);
        lines.push('');
      }
    }

    lines.push('---');
    lines.push(`*Generated automatically by [Brain Hub for Antigravity](https://github.com/hungle-vn/brain-hub-antigravity) at ${new Date().toLocaleString()}*`);

    return lines.join('\n');
  }

  private static indentMarkdown(text: string, spaces: number = 2): string {
    const indent = ' '.repeat(spaces);
    return text
      .split('\n')
      .map((line) => (line.trim() ? `${indent}${line}` : ''))
      .join('\n');
  }

  private static formatToolCallMarkdown(
    tc: ToolCallInfo,
    timeStr: string,
    sanitize: boolean = true,
    customPatterns: string[] = []
  ): string {
    const isError = tc.status === 'ERROR' || (tc.exitCode !== undefined && tc.exitCode !== 0);

    const clean = (text: string | undefined | null): string => {
      if (!text) return '';
      return sanitize ? SecretSanitizer.sanitize(text, customPatterns) : text;
    };

    // Format ask_question specifically
    if (tc.name === 'ask_question' && tc.args && typeof tc.args === 'object') {
      const sanitizedArgs = sanitize ? SecretSanitizer.sanitizeObject(tc.args, customPatterns) : tc.args;
      const questions = (sanitizedArgs as any).questions || [];
      const questionBlocks: string[] = [];
      for (const q of questions) {
        const qText = q.question || '';
        const options = (q.options || []).map((opt: string) => `  - [ ] ${opt}`).join('\n');
        questionBlocks.push(`**Q:** ${qText}\n${options}`);
      }
      return `
> [!IMPORTANT]
> ❓ **Interactive User Decision / Question Prompt** <small>(${timeStr})</small>
>
${MarkdownExporter.indentMarkdown(questionBlocks.join('\n\n'), 2)}
`;
    }

    if (isError) {
      const errOutput = clean(tc.output || 'Unknown error occurred during tool execution.');
      return `
> [!CAUTION]
> ❌ **Tool Error (\`${tc.name}\` - Exit code ${tc.exitCode || 1})** <small>(${timeStr})</small>
>
\`\`\`text
${errOutput}
\`\`\`
`;
    }

    let argsJson = '';
    if (tc.args) {
      const sanitizedArgs = sanitize ? SecretSanitizer.sanitizeObject(tc.args, customPatterns) : tc.args;
      argsJson = typeof sanitizedArgs === 'string' ? clean(sanitizedArgs) : JSON.stringify(sanitizedArgs, null, 2);
    }

    const rawOutput = tc.output || '';
    const cleanOutput = clean(rawOutput);
    const actionSummary = tc.description ? ` — <i>${clean(tc.description)}</i>` : '';

    return `
<details>
<summary>🛠️ <b>Action:</b> <code>${tc.name}</code>${actionSummary} <small style="color:#10b981;">(Success)</small></summary>

${argsJson ? `**Arguments:**\n\`\`\`json\n${argsJson}\n\`\`\`\n` : ''}
${cleanOutput ? `**Output:**\n\`\`\`text\n${cleanOutput.length > 2500 ? cleanOutput.substring(0, 2490) + '\n... (truncated)' : cleanOutput}\n\`\`\`\n` : ''}
</details>
`;
  }
}
