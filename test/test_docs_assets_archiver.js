const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Mock vscode module for standalone execution
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === 'vscode') {
    return {
      workspace: {
        getConfiguration: () => ({
          get: (key, def) => def
        })
      },
      Uri: {
        file: (f) => ({ fsPath: f, path: f, scheme: 'file' })
      },
      window: {
        showInformationMessage: async () => undefined,
        showErrorMessage: async () => undefined,
        showWarningMessage: async () => undefined
      },
      commands: {
        executeCommand: async () => undefined
      }
    };
  }
  return originalRequire.apply(this, arguments);
};

const { MarkdownExporter } = require('../out/services/MarkdownExporter');
const { ProjectDocsArchiver } = require('../out/services/ProjectDocsArchiver');
const { SessionScanner } = require('../out/services/SessionScanner');

console.log('Testing ProjectDocsArchiver Assets Export & Relative Link Rewriter...');

// Test 1: MarkdownExporter.rewriteLocalMarkdownLinks
console.log('1. Testing MarkdownExporter.rewriteLocalMarkdownLinks...');
const sessionId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const sessionPath = 'C:\\Users\\dev\\.gemini\\antigravity-ide\\brain\\' + sessionId;

const sampleMarkdown = `
# Session Summary
Here is the generated design:
![Mockup](file:///C:/Users/dev/.gemini/antigravity-ide/brain/${sessionId}/dashboard_mockup.png)
And an uploaded screenshot:
![Screenshot](file:///C:/Users/dev/.gemini/antigravity-ide/brain/${sessionId}/.user_uploaded/bug_report.jpg)
And an HTML img tag:
<img src="file:///C:/Users/dev/.gemini/antigravity-ide/brain/${sessionId}/architecture_diagram.svg" width="600" />
External link to keep intact:
![External](https://cdn.example.com/logo.png)
`;

const assetMap = new Map();
assetMap.set('dashboard_mockup.png', '../assets/a1b2c3d4_dashboard_mockup.png');
assetMap.set('bug_report.jpg', '../assets/a1b2c3d4_bug_report.jpg');

const rewritten = MarkdownExporter.rewriteLocalMarkdownLinks(sampleMarkdown, sessionId, sessionPath, assetMap);

assert(rewritten.includes('![Mockup](../assets/a1b2c3d4_dashboard_mockup.png)'), 'dashboard_mockup link not rewritten properly');
assert(rewritten.includes('![Screenshot](../assets/a1b2c3d4_bug_report.jpg)'), 'bug_report link not rewritten properly');
assert(rewritten.includes('<img src="../assets/a1b2c3d4_architecture_diagram.svg" width="600" />'), 'HTML img tag not rewritten properly');
assert(rewritten.includes('![External](https://cdn.example.com/logo.png)'), 'External image link was erroneously altered');

console.log('✓ MarkdownExporter.rewriteLocalMarkdownLinks passed successfully!');

// Test 2: Full Archiver integration test with temporary workspace
console.log('2. Testing ProjectDocsArchiver.archiveProjectDocs with assets directory...');
const tempWs = fs.mkdtempSync(path.join(os.tmpdir(), 'archiver-ws-test-'));
const tempBrain = fs.mkdtempSync(path.join(os.tmpdir(), 'archiver-brain-test-'));

try {
  const sessionDir = path.join(tempBrain, sessionId);
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(path.join(sessionDir, '.user_uploaded'), { recursive: true });
  fs.mkdirSync(path.join(sessionDir, '.system_generated', 'logs'), { recursive: true });

  fs.writeFileSync(path.join(sessionDir, 'implementation_plan.md'), '# Implementation Plan');
  fs.writeFileSync(path.join(sessionDir, 'dashboard_mockup.png'), 'fake-image-bytes');
  fs.writeFileSync(path.join(sessionDir, '.user_uploaded', 'user_snap.png'), 'fake-snap-bytes');

  // Minimal transcript with workspace reference
  const transcriptContent = JSON.stringify({
    step_index: 0,
    source: 'USER_EXPLICIT',
    type: 'USER_INPUT',
    content: `Work in ${tempWs} please\n![Mockup](file:///${sessionDir.replace(/\\/g, '/')}/dashboard_mockup.png)`
  }) + '\n';
  fs.writeFileSync(path.join(sessionDir, '.system_generated', 'logs', 'transcript.jsonl'), transcriptContent);

  // Set mock workspace in SessionScanner
  const scanner = SessionScanner.getInstance();
  const sessionData = {
    id: sessionId,
    path: sessionDir,
    title: 'Test Archiver Session',
    firstPrompt: `Work in ${tempWs}`,
    lastModified: new Date(),
    messageCount: 1,
    userPromptCount: 1,
    workspacePath: tempWs,
    hasArtifacts: true
  };
  scanner.scanSessions = async () => [sessionData];
  scanner.loadFullSession = async (id) => ({
    session: sessionData,
    messages: [
      {
        index: 0,
        type: 'USER_INPUT',
        content: `Work in ${tempWs}\n![Mockup](file:///${sessionDir.replace(/\\/g, '/')}/dashboard_mockup.png)`
      }
    ]
  });

  // Run Archiver
  const archiverPromise = ProjectDocsArchiver.archiveWorkspaceDocs(tempWs, { mode: 'fullWithSanitization', autoGitignore: false, sanitizeSecrets: false });
  archiverPromise.then(result => {
    assert(result.success, 'Archiver failed: ' + result.message);

    // Verify .docs/assets exists and contains prefixed files
    const assetsFolder = path.join(tempWs, '.docs', 'assets');
    assert(fs.existsSync(assetsFolder), '.docs/assets directory was not created!');

    const assetFiles = fs.readdirSync(assetsFolder);
    assert(assetFiles.includes('a1b2c3d4_dashboard_mockup.png'), 'a1b2c3d4_dashboard_mockup.png missing in assets!');
    assert(assetFiles.includes('a1b2c3d4_user_snap.png'), 'a1b2c3d4_user_snap.png missing in assets!');

    // Verify .docs/logs contains rewritten markdown
    const logsFolder = path.join(tempWs, '.docs', 'logs');
    assert(fs.existsSync(logsFolder), '.docs/logs directory was not created!');
    const logFiles = fs.readdirSync(logsFolder).filter(f => f.startsWith('session_'));
    assert(logFiles.length > 0, 'No session log files created!');

    const logContent = fs.readFileSync(path.join(logsFolder, logFiles[0]), 'utf8');
    assert(logContent.includes('../assets/a1b2c3d4_dashboard_mockup.png'), 'Session log did not rewrite image link to ../assets/!');

    console.log('✓ ProjectDocsArchiver.archiveProjectDocs verified with .docs/assets/ and link rewriting!');
    console.log('=== All Phase 2 Archiver Tests Passed Successfully! ===');
  }).catch(err => {
    console.error('Archiver test rejected:', err);
    process.exit(1);
  });

} catch (e) {
  console.error('Test execution failed:', e);
  process.exit(1);
} finally {
  setTimeout(() => {
    try {
      fs.rmSync(tempWs, { recursive: true, force: true });
      fs.rmSync(tempBrain, { recursive: true, force: true });
    } catch {}
  }, 1000);
}
