import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ChatMessage, ChatSession } from '../models/types';
import { SessionScanner } from './SessionScanner';
import { MarkdownExporter } from './MarkdownExporter';
import { SecretSanitizer } from './SecretSanitizer';

export type ArchiverMode = 'safeDocsOnly' | 'fullWithSanitization' | 'fullRaw';

export interface ArchiverOptions {
  mode?: ArchiverMode;
  autoGitignore?: boolean;
  sanitizeSecrets?: boolean;
  customSecretPatterns?: string[];
}

export class ProjectDocsArchiver {
  public static async archiveWorkspaceDocs(
    workspacePath?: string,
    options?: ArchiverOptions
  ): Promise<{ success: boolean; message: string; gitignored?: boolean }> {
    const ws = workspacePath || ProjectDocsArchiver.getActiveWorkspacePath();
    if (!ws) {
      return { success: false, message: 'No active workspace folder found.' };
    }

    // Resolve configuration defaults
    const config = vscode.workspace.getConfiguration('brainHub');
    const mode: ArchiverMode = options?.mode || config.get<ArchiverMode>('archiver.defaultMode', 'safeDocsOnly');
    const autoGitignore: boolean = options?.autoGitignore ?? config.get<boolean>('archiver.autoGitignore', true);
    const sanitizeSecrets: boolean = options?.sanitizeSecrets ?? config.get<boolean>('archiver.sanitizeSecrets', true);
    const customPatterns: string[] = options?.customSecretPatterns ?? config.get<string[]>('archiver.customSecretPatterns', []);

    // Check for .docs-ignore
    const ignoreFile = path.join(ws, '.docs-ignore');
    if (fs.existsSync(ignoreFile)) {
      return {
        success: false,
        message: 'Workspace contains a .docs-ignore file. Archival is skipped.'
      };
    }

    const scanner = SessionScanner.getInstance();
    const allSessions = await scanner.scanSessions();
    const wsLower = ws.toLowerCase().replace(/\\/g, '/');

    // Filter sessions matching workspace
    const wsSessions = allSessions.filter((s) => {
      if (!s.workspacePath) return false;
      const sWsLower = s.workspacePath.toLowerCase().replace(/\\/g, '/');
      return sWsLower === wsLower || wsLower.startsWith(sWsLower) || sWsLower.startsWith(wsLower);
    });

    if (wsSessions.length === 0) {
      return {
        success: false,
        message: 'No Antigravity chat sessions or artifacts found for the current workspace.'
      };
    }

    // Auto-update .gitignore to prevent accidental leakage
    let gitignored = false;
    if (autoGitignore) {
      gitignored = await ProjectDocsArchiver.ensureGitIgnoreProtection(ws, ['.docs/logs/', '.docs/scratch/']);
    }

    const docsDir = path.join(ws, '.docs');
    const plansDir = path.join(docsDir, 'plans');
    const walkDir = path.join(docsDir, 'walkthroughs');
    const researchDir = path.join(docsDir, 'research');
    const diagramsDir = path.join(docsDir, 'diagrams');
    const mediaDir = path.join(docsDir, 'media');
    const scratchDir = path.join(docsDir, 'scratch');
    const logsDir = path.join(docsDir, 'logs');

    const baseDirs = [docsDir, plansDir, walkDir, researchDir, diagramsDir, mediaDir];
    if (mode !== 'safeDocsOnly') {
      baseDirs.push(scratchDir, logsDir);
    }

    for (const d of baseDirs) {
      if (!fs.existsSync(d)) {
        await fs.promises.mkdir(d, { recursive: true });
      }
    }

    let copiedArtifactsCount = 0;
    let archivedLogsCount = 0;
    const timelineRows: string[] = [];

    // Sort sessions chronologically (oldest to newest)
    const sortedSessions = [...wsSessions].sort((a, b) => {
      const timeA = (a.createdAt || a.lastModified).getTime();
      const timeB = (b.createdAt || b.lastModified).getTime();
      return timeA - timeB;
    });

    let latestMarkdown = '';

    for (const session of sortedSessions) {
      const sessionData = await scanner.loadFullSession(session.id);
      if (!sessionData) continue;

      const dateTag = (session.createdAt || session.lastModified)
        .toISOString()
        .replace(/[:.]/g, '-')
        .substring(0, 19);
      const rawTitle = session.title || 'session';
      const safeTitle = rawTitle
        .replace(/[^a-zA-Z0-9_\-\u00C0-\u024F\u1EA0-\u1EF9]/g, '_')
        .substring(0, 30);

      // 1. Process Logs if not in safeDocsOnly mode
      if (mode !== 'safeDocsOnly') {
        const isSanitized = mode === 'fullWithSanitization' || sanitizeSecrets;
        const sessionMd = MarkdownExporter.generateMarkdown(
          sessionData.session,
          sessionData.messages,
          isSanitized,
          customPatterns
        );
        latestMarkdown = sessionMd;

        const logFileName = `session_${dateTag}_${safeTitle}_${session.id.substring(0, 8)}.md`;
        const logFilePath = path.join(logsDir, logFileName);
        await fs.promises.writeFile(logFilePath, sessionMd, 'utf8');
        archivedLogsCount++;

        // Compute timeline metrics with links
        let toolCount = 0;
        for (const m of sessionData.messages) {
          if (m.toolCalls) toolCount += m.toolCalls.length;
        }
        const dateDisplay = (session.createdAt || session.lastModified).toLocaleString('en-US');
        let goal = (session.firstPrompt || session.title || 'Session Task').replace(/[`|\\]/g, ' ').substring(0, 70);
        if (isSanitized) {
          goal = SecretSanitizer.sanitize(goal, customPatterns);
        }
        timelineRows.push(
          `| \`${dateDisplay}\` | [\`${session.id.substring(0, 8)}...\`](./logs/${encodeURIComponent(logFileName)}) | ${goal} | \`${sessionData.messages.length}\` | \`${session.userPromptCount}\` | \`${toolCount}\` |`
        );
      } else {
        // Safe mode timeline (no links to raw logs)
        let toolCount = 0;
        for (const m of sessionData.messages) {
          if (m.toolCalls) toolCount += m.toolCalls.length;
        }
        const dateDisplay = (session.createdAt || session.lastModified).toLocaleString('en-US');
        let goal = (session.firstPrompt || session.title || 'Session Task').replace(/[`|\\]/g, ' ').substring(0, 70);
        if (sanitizeSecrets) {
          goal = SecretSanitizer.sanitize(goal, customPatterns);
        }
        timelineRows.push(
          `| \`${dateDisplay}\` | \`${session.id.substring(0, 8)}...\` | ${goal} | \`${sessionData.messages.length}\` | \`${session.userPromptCount}\` | \`${toolCount}\` |`
        );
      }

      // 2. Copy Brain Artifacts if session directory exists
      if (session.path && fs.existsSync(session.path)) {
        try {
          const files = await fs.promises.readdir(session.path, { withFileTypes: true });
          for (const f of files) {
            if (f.name.startsWith('.') || f.name === 'tempmediaStorage' || f.name === 'scratch') continue;
            if (f.isFile()) {
              const srcFile = path.join(session.path, f.name);
              const lowerName = f.name.toLowerCase();
              const ext = path.extname(lowerName);

              let destFolder = researchDir;
              if (lowerName.includes('plan')) {
                destFolder = plansDir;
              } else if (lowerName.includes('walkthrough') || lowerName.includes('changelog') || lowerName.includes('release')) {
                destFolder = walkDir;
              } else if (['.mermaid', '.puml', '.drawio', '.svg'].includes(ext)) {
                destFolder = diagramsDir;
              } else if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp4'].includes(ext)) {
                destFolder = mediaDir;
              }

              const destFile = path.join(destFolder, `${path.parse(f.name).name}_${dateTag}${ext}`);
              await fs.promises.copyFile(srcFile, destFile);
              copiedArtifactsCount++;

              // Also maintain latest un-timestamped version for active plans/walkthroughs
              if (lowerName === 'implementation_plan.md' || lowerName === 'walkthrough.md') {
                await fs.promises.copyFile(srcFile, path.join(destFolder, f.name));
              }
            }
          }

          // Check scratch directory (Only if NOT in safeDocsOnly mode)
          if (mode !== 'safeDocsOnly') {
            const sessionScratch = path.join(session.path, 'scratch');
            if (fs.existsSync(sessionScratch)) {
              const scratchFiles = await fs.promises.readdir(sessionScratch, { withFileTypes: true });
              for (const sf of scratchFiles) {
                if (sf.isFile()) {
                  const srcSf = path.join(sessionScratch, sf.name);
                  const destSf = path.join(scratchDir, `${path.parse(sf.name).name}_${dateTag}${path.extname(sf.name)}`);
                  await fs.promises.copyFile(srcSf, destSf);
                  copiedArtifactsCount++;
                }
              }
            }
          }
        } catch (err) {
          console.warn(`Error copying artifacts for session ${session.id}:`, err);
        }
      }
    }

    // Write LATEST_SESSION.md if in full mode
    if (mode !== 'safeDocsOnly' && latestMarkdown) {
      await fs.promises.writeFile(path.join(logsDir, 'LATEST_SESSION.md'), latestMarkdown, 'utf8');
    }

    // Write TIMELINE.md
    const timelineContent = `# 📜 Antigravity Project Session Timeline

Cumulative historical log of all Antigravity development sessions in this project.
Mode: **${mode === 'safeDocsOnly' ? '🛡️ Safe Architecture Docs Only' : '📋 Full Session Archive (Sanitized)'}**

| Timestamp | Session ID | Goal / Objective | Total Steps | Prompts | Tools |
| :--- | :--- | :--- | :--- | :--- | :--- |
${timelineRows.reverse().join('\n')}

---
*Updated automatically by Brain Hub for Antigravity at ${new Date().toLocaleString()}*
`;
    const timelinePath = mode !== 'safeDocsOnly' ? path.join(logsDir, 'TIMELINE.md') : path.join(docsDir, 'TIMELINE.md');
    await fs.promises.writeFile(timelinePath, timelineContent, 'utf8');

    // Generate INDEX.md
    await ProjectDocsArchiver.generateIndexMarkdown(docsDir, ws, mode);

    const modeMsg = mode === 'safeDocsOnly' 
      ? `Archived ${copiedArtifactsCount} safe artifacts (Plans, Walkthroughs, Diagrams). Raw logs skipped for security.`
      : `Archived ${archivedLogsCount} sanitized session logs and ${copiedArtifactsCount} artifacts into .docs/`;

    return {
      success: true,
      message: modeMsg,
      gitignored
    };
  }

  public static async ensureGitIgnoreProtection(wsPath: string, patterns: string[]): Promise<boolean> {
    try {
      const gitignorePath = path.join(wsPath, '.gitignore');
      let content = '';
      if (fs.existsSync(gitignorePath)) {
        content = await fs.promises.readFile(gitignorePath, 'utf8');
      }

      const lines = content.split(/\r?\n/);
      const missingPatterns: string[] = [];

      for (const pattern of patterns) {
        const cleanPattern = pattern.trim().replace(/^[\/\\]+/, '').replace(/[\/\\]+$/, '');
        const exists = lines.some((l) => {
          const cleanLine = l.trim().replace(/^[\/\\]+/, '').replace(/[\/\\]+$/, '');
          return cleanLine === cleanPattern || cleanLine === `.docs/${cleanPattern}` || cleanLine === '.docs';
        });
        if (!exists) {
          missingPatterns.push(pattern);
        }
      }

      if (missingPatterns.length > 0) {
        const newBlock = `\n# Antigravity AI Session Logs & Scratch (Sensitive Transcripts)\n${missingPatterns.join('\n')}\n`;
        await fs.promises.writeFile(gitignorePath, content + newBlock, 'utf8');
        return true;
      }
    } catch (err) {
      console.warn('Failed to update .gitignore:', err);
    }
    return false;
  }

  private static async generateIndexMarkdown(docsDir: string, wsPath: string, mode: ArchiverMode = 'safeDocsOnly'): Promise<void> {
    const wsName = path.basename(wsPath);
    const lines: string[] = [];

    lines.push(`# 📚 Project Documentation Catalog — ${wsName}`);
    lines.push('');
    lines.push('> Automatically generated and organized by **Brain Hub for Antigravity**.');
    lines.push(`> Archival Mode: **${mode === 'safeDocsOnly' ? '🛡️ Safe Architecture Docs Only' : '📋 Full Catalog (Sanitized)'}**`);
    lines.push('');
    lines.push('---');
    lines.push('');

    const subfolders = [
      { id: 'plans', name: '📋 Implementation Plans & Architecture', dir: path.join(docsDir, 'plans') },
      { id: 'walkthroughs', name: '✅ Walkthroughs & Verification Logs', dir: path.join(docsDir, 'walkthroughs') },
      { id: 'research', name: '🔬 Research & Technical Analysis', dir: path.join(docsDir, 'research') },
      { id: 'diagrams', name: '📊 Architecture Diagrams & Visuals', dir: path.join(docsDir, 'diagrams') },
      { id: 'media', name: '🖼️ UI Mockups & Visual Assets', dir: path.join(docsDir, 'media') }
    ];

    if (mode !== 'safeDocsOnly') {
      subfolders.push(
        { id: 'scratch', name: '🧪 Test Scripts & Experiments', dir: path.join(docsDir, 'scratch') },
        { id: 'logs', name: '📜 Session Logs & Development History', dir: path.join(docsDir, 'logs') }
      );
    }

    for (const sub of subfolders) {
      lines.push(`## ${sub.name}`);
      lines.push('');

      if (!fs.existsSync(sub.dir)) {
        lines.push('*No files archived yet.*');
        lines.push('');
        continue;
      }

      const files = await fs.promises.readdir(sub.dir, { withFileTypes: true });
      const validFiles = files.filter((f) => f.isFile() && !f.name.startsWith('.'));

      if (validFiles.length === 0) {
        lines.push('*No files archived yet.*');
        lines.push('');
        continue;
      }

      lines.push('| File | Description / Title | Last Modified |');
      lines.push('| :--- | :--- | :--- |');

      for (const f of validFiles) {
        const filePath = path.join(sub.dir, f.name);
        const stats = await fs.promises.stat(filePath);
        const modTime = stats.mtime.toLocaleString('en-US');
        const title = await ProjectDocsArchiver.extractFileTitle(filePath);
        const relLink = `./${sub.id}/${encodeURIComponent(f.name)}`;
        lines.push(`| [\`${f.name}\`](${relLink}) | ${title} | \`${modTime}\` |`);
      }
      lines.push('');
    }

    if (fs.existsSync(path.join(docsDir, 'TIMELINE.md'))) {
      lines.push('## 📜 Project Timeline');
      lines.push('');
      lines.push('- [View Development Session Timeline](./TIMELINE.md)');
      lines.push('');
    }

    lines.push('---');
    lines.push(`*Catalog Master Index generated at ${new Date().toLocaleString()}*`);

    const indexPath = path.join(docsDir, 'INDEX.md');
    await fs.promises.writeFile(indexPath, lines.join('\n'), 'utf8');

    // Also mirror to README.md in .docs/
    await fs.promises.writeFile(path.join(docsDir, 'README.md'), lines.join('\n'), 'utf8');
  }

  private static async extractFileTitle(filePath: string): Promise<string> {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.md') {
      try {
        const content = await fs.promises.readFile(filePath, 'utf8');
        const firstLines = content.split('\n').slice(0, 15);
        for (const l of firstLines) {
          const trimmed = l.trim();
          if (trimmed.startsWith('# ')) {
            return trimmed.replace(/^#\s+/, '').replace(/[`|\\]/g, ' ').substring(0, 80);
          }
        }
      } catch {
        // ignore
      }
    }
    return `\`${path.basename(filePath)}\``;
  }

  public static getActiveWorkspacePath(): string | null {
    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
      return vscode.workspace.workspaceFolders[0].uri.fsPath;
    }
    return null;
  }
}

