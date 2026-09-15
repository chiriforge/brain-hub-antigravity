const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const Module = require('module');

// 1. Setup VS Code mock environment for standalone Node test
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === 'vscode') {
    return {
      workspace: {
        getConfiguration: () => ({
          get: (key, def) => def,
          update: async () => {}
        }),
        workspaceFolders: []
      },
      Uri: {
        file: (f) => ({
          fsPath: f,
          path: f,
          scheme: 'file',
          toString: () => `file:///${f.replace(/\\/g, '/')}`
        }),
        parse: (u) => ({
          fsPath: u.replace(/^file:\/\/\/?/, '').replace(/\//g, path.sep),
          path: u,
          scheme: 'file'
        }),
        joinPath: (baseUri, ...pathSegments) => {
          const joined = path.join(baseUri.fsPath, ...pathSegments);
          return {
            fsPath: joined,
            path: joined,
            scheme: 'file',
            toString: () => `file:///${joined.replace(/\\/g, '/')}`
          };
        }
      },
      ViewColumn: { One: 1, Active: -1 },
      window: {
        showInformationMessage: () => {},
        showWarningMessage: () => {},
        showErrorMessage: () => {}
      },
      commands: {
        executeCommand: async () => {}
      },
      EventEmitter: class {
        constructor() {
          this.event = (listener) => ({ dispose: () => {} });
        }
        fire() {}
        dispose() {}
      },
      TreeItem: class {
        constructor(label, collapsibleState) {
          this.label = label;
          this.collapsibleState = collapsibleState;
        }
      },
      TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
      ThemeIcon: class {
        constructor(id, color) {
          this.id = id;
          this.color = color;
        }
      },
      ThemeColor: class {
        constructor(id) {
          this.id = id;
        }
      },
      MarkdownString: class {
        constructor() {
          this.value = '';
        }
        appendMarkdown(str) {
          this.value += str;
        }
      },
      env: {
        clipboard: { writeText: async () => {} },
        openExternal: async () => {}
      }
    };
  }
  return originalRequire.apply(this, arguments);
};

const { SessionScanner } = require('../out/services/SessionScanner');
const { MarkdownExporter } = require('../out/services/MarkdownExporter');
const { ProjectDocsArchiver } = require('../out/services/ProjectDocsArchiver');
const { HIGHLIGHT_CSS } = require('../out/services/HighlightStyles');
const { ChatWebviewPanel } = require('../out/views/ChatWebviewPanel');
const { DashboardWebviewPanel } = require('../out/views/DashboardWebviewPanel');

console.log('=== Running Comprehensive Verification for Session Artifacts Gallery ===');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-hub-verify-gallery-'));

try {
  // Test Section 1: CSS & Design System Verification
  console.log('1. Verifying HighlightStyles CSS tokens...');
  const css = HIGHLIGHT_CSS;
  assert(css.includes('.artifacts-modal-overlay'), 'CSS must define .artifacts-modal-overlay');
  assert(css.includes('.artifacts-modal-container'), 'CSS must define .artifacts-modal-container');
  assert(css.includes('.artifacts-modal-tabs'), 'CSS must define .artifacts-modal-tabs');
  assert(css.includes('.artifact-card'), 'CSS must define .artifact-card');
  assert(css.includes('.artifact-card-preview'), 'CSS must define .artifact-card-preview');
  assert(css.includes('.primary-artifact-btn'), 'CSS must define .primary-artifact-btn');
  console.log('✓ HighlightStyles CSS rules verified successfully!');

  // Test Section 2: SessionScanner Discovery & Prompt Binding
  console.log('2. Verifying SessionScanner discovery and prompt context binding...');
  const sessionDir = path.join(tempDir, 'gallery-session');
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(path.join(sessionDir, '.user_uploaded'), { recursive: true });
  fs.mkdirSync(path.join(sessionDir, 'scratch'), { recursive: true });

  fs.writeFileSync(path.join(sessionDir, 'implementation_plan.md'), '# Implementation Plan');
  fs.writeFileSync(path.join(sessionDir, 'walkthrough.md'), '# Walkthrough');
  fs.writeFileSync(path.join(sessionDir, 'architecture_diagram.png'), 'png-bytes');
  fs.writeFileSync(path.join(sessionDir, '.user_uploaded', 'reference_ui.webp'), 'webp-bytes');
  fs.writeFileSync(path.join(sessionDir, 'scratch', 'test_eval.py'), 'print("eval")');

  const simulatedMessages = [
    {
      index: 1,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      content: 'Here is the diagram',
      toolCalls: [
        {
          name: 'generate_image',
          args: {
            ImageName: 'architecture_diagram',
            Prompt: 'High-level microservice architecture blueprint'
          }
        }
      ]
    }
  ];

  const scanner = SessionScanner.getInstance();
  const artifacts = scanner.scanSessionArtifacts(sessionDir, simulatedMessages);

  assert.strictEqual(artifacts.length, 5, `Expected 5 artifacts, found ${artifacts.length}`);

  const planArt = artifacts.find(a => a.name === 'implementation_plan.md');
  const wtArt = artifacts.find(a => a.name === 'walkthrough.md');
  const imgArt = artifacts.find(a => a.name === 'architecture_diagram.png');
  const userArt = artifacts.find(a => a.name === 'reference_ui.webp');
  const scratchArt = artifacts.find(a => a.name === 'test_eval.py');

  assert(planArt && planArt.category === 'document' && planArt.source === 'plan', 'Plan artifact mismatch');
  assert(wtArt && wtArt.category === 'document' && wtArt.source === 'walkthrough', 'Walkthrough artifact mismatch');
  assert(imgArt && imgArt.category === 'image' && imgArt.source === 'ai_generated', 'Image artifact mismatch');
  assert.strictEqual(imgArt.prompt, 'High-level microservice architecture blueprint', 'Prompt binding failed');
  assert(userArt && userArt.category === 'image' && userArt.source === 'user_uploaded', 'User media mismatch');
  assert(scratchArt && scratchArt.category === 'scratch' && scratchArt.source === 'scratch', 'Scratch file mismatch');

  console.log('✓ SessionScanner artifact discovery and prompt binding verified!');

  // Test Section 3: MarkdownExporter Link Rewriting & ProjectDocsArchiver
  console.log('3. Verifying Markdown link rewriting and assets export...');
  const testSessionId = 'gallery-session-001';
  const localImgPath = path.join(sessionDir, 'architecture_diagram.png').replace(/\\/g, '/');
  const sampleMd = `# Summary Report\n\n![Arch Diagram](file:///${localImgPath})\n\n<img src="file:///${localImgPath}" alt="Diagram 2" />\n\nKeep external: ![Online](https://example.com/logo.png)`;

  const assetMap = new Map([
    ['architecture_diagram.png', '../assets/gallery-_architecture_diagram.png']
  ]);

  const rewritten = MarkdownExporter.rewriteLocalMarkdownLinks(sampleMd, testSessionId, sessionDir, assetMap);
  assert(rewritten.includes('![Arch Diagram](../assets/gallery-_architecture_diagram.png)'), 'Markdown image syntax was not rewritten');
  assert(rewritten.includes('<img src="../assets/gallery-_architecture_diagram.png" alt="Diagram 2" />'), 'HTML img src was not rewritten');
  assert(rewritten.includes('https://example.com/logo.png'), 'Remote image URL must be preserved');
  console.log('✓ Markdown relative link rewriter verified successfully!');

  // Test Section 4: ChatWebviewPanel HTML & Modal Markup
  console.log('4. Verifying ChatWebviewPanel modal markup & client controller...');
  const mockWebview = {
    asWebviewUri: (uri) => ({
      toString: () => `vscode-resource://${uri.fsPath.replace(/\\/g, '/')}`
    }),
    postMessage: async () => {},
    onDidReceiveMessage: () => ({ dispose: () => {} })
  };

  const mockPanel = {
    webview: mockWebview,
    title: '',
    onDidDispose: () => ({ dispose: () => {} }),
    dispose: () => {}
  };

  const sampleSession = {
    id: 'gallery-session-001',
    title: 'Test Session with Artifacts',
    path: sessionDir,
    createdAt: new Date(),
    lastModified: new Date(),
    messages: simulatedMessages,
    messageCount: 1,
    artifacts: artifacts,
    artifactCount: artifacts.length,
    planPath: path.join(sessionDir, 'implementation_plan.md'),
    walkthroughPath: path.join(sessionDir, 'walkthrough.md')
  };

  const chatPanelInstance = Object.create(ChatWebviewPanel.prototype);
  chatPanelInstance.panel = mockPanel;
  chatPanelInstance.extensionUri = { fsPath: tempDir };
  chatPanelInstance.currentSession = sampleSession;
  chatPanelInstance.isShowingCombinedThread = false;
  chatPanelInstance.getAppConfigState = () => ({
    messageOrder: 'newestFirst',
    defaultToolsState: 'collapsed',
    defaultAiStepsState: 'collapsed'
  });

  const chatHtml = chatPanelInstance['generateHtml'](sampleSession, simulatedMessages, []);

  // Verify modal container & tabs
  assert(chatHtml.includes('id="artifactsModal"'), 'ChatWebview must include #artifactsModal element');
  assert(chatHtml.includes('class="artifacts-modal-overlay"'), 'ChatWebview must include .artifacts-modal-overlay');
  assert(chatHtml.includes('id="artifactsGridContainer"'), 'ChatWebview must include #artifactsGridContainer');
  assert(chatHtml.includes('id="tabCountAll"'), 'ChatWebview must include tabCountAll badge');
  assert(chatHtml.includes('id="tabCountMedia"'), 'ChatWebview must include tabCountMedia badge');
  assert(chatHtml.includes('id="tabCountDocs"'), 'ChatWebview must include tabCountDocs badge');
  assert(chatHtml.includes('id="tabCountScratch"'), 'ChatWebview must include tabCountScratch badge');

  // Verify header trigger button
  assert(chatHtml.includes('primary-artifact-btn'), 'ChatWebview header must include .primary-artifact-btn');
  assert(chatHtml.includes(`All Artifacts (${artifacts.length})`), 'ChatWebview button must display correct total artifact count');

  // Verify client controller scripts
  assert(chatHtml.includes('function openArtifactsModal('), 'ChatWebview must contain openArtifactsModal');
  assert(chatHtml.includes('function closeArtifactsModal('), 'ChatWebview must contain closeArtifactsModal');
  assert(chatHtml.includes('function switchArtifactsTab('), 'ChatWebview must contain switchArtifactsTab');
  assert(chatHtml.includes('function renderArtifactsGrid('), 'ChatWebview must contain renderArtifactsGrid');
  assert(chatHtml.includes('function revealFileInOS('), 'ChatWebview must contain revealFileInOS');
  console.log('✓ ChatWebviewPanel HTML & client controller verified!');

  // Test Section 5: DashboardWebviewPanel HTML & Data Holder Markup
  console.log('5. Verifying DashboardWebviewPanel modal markup & data holder...');
  const dashboardInstance = Object.create(DashboardWebviewPanel.prototype);
  dashboardInstance.panel = mockPanel;
  dashboardInstance.extensionUri = { fsPath: tempDir };
  dashboardInstance.selectedSessionId = sampleSession.id;
  dashboardInstance.isShowingCombinedThread = false;
  dashboardInstance.getAppConfigState = () => ({
    messageOrder: 'newestFirst',
    defaultToolsState: 'collapsed',
    defaultAiStepsState: 'collapsed',
    sessionSortBy: 'lastModified'
  });

  const dashboardReaderHtml = dashboardInstance['generateReaderHtml'](
    sampleSession,
    simulatedMessages,
    [sampleSession],
    dashboardInstance.getAppConfigState(),
    false
  );

  assert(dashboardReaderHtml.includes('id="artifactsDataHolder"'), 'Dashboard reader must include #artifactsDataHolder element');
  assert(dashboardReaderHtml.includes('data-artifacts='), 'Dashboard reader must carry base64 serialized artifacts data');
  assert(dashboardReaderHtml.includes('primary-artifact-btn'), 'Dashboard reader header must include .primary-artifact-btn');
  assert(dashboardReaderHtml.includes(`All Artifacts (${artifacts.length})`), 'Dashboard button must display total artifact count');

  const fullDashboardHtml = dashboardInstance['generateDashboardHtml'](
    [sampleSession],
    sampleSession,
    [],
    [sampleSession],
    dashboardInstance.getAppConfigState(),
    true
  );

  assert(fullDashboardHtml.includes('id="artifactsModal"'), 'Full Dashboard HTML must include #artifactsModal element');
  assert(fullDashboardHtml.includes('dashboard-reader-wrapper'), 'Full Dashboard HTML must wrap reader and artifactsModal in .dashboard-reader-wrapper');
  assert(fullDashboardHtml.includes('function openArtifactsModal('), 'Dashboard must contain openArtifactsModal');
  assert(fullDashboardHtml.includes('function closeArtifactsModal('), 'Dashboard must contain closeArtifactsModal');
  assert(fullDashboardHtml.includes('function switchArtifactsTab('), 'Dashboard must contain switchArtifactsTab');
  assert(fullDashboardHtml.includes('function renderArtifactsGrid('), 'Dashboard must contain renderArtifactsGrid');

  // Test Section 6: Standardized Pills and SessionTreeItem Verification
  console.log('6. Verifying Standardized Pills and SessionTreeItem icons & tooltips...');
  const navItemHtml = dashboardInstance['renderSessionNavItemHtml'](sampleSession, false);
  assert(navItemHtml.includes('type-chat') && navItemHtml.includes('💬 Chat'), 'Side panel nav item must display 💬 Chat for single session');
  assert(navItemHtml.includes('type-artifact') && navItemHtml.includes('📦'), 'Side panel nav item must display 📦 artifact badge');

  assert(dashboardReaderHtml.includes('Single Chat'), 'Reader header must display Single Chat badge');
  assert(dashboardReaderHtml.includes('Artifacts</span>'), 'Reader header must display Artifacts badge');

  const { SessionTreeItem } = require('../out/providers/ChatHistoryTreeProvider');
  const treeItem = new SessionTreeItem(sampleSession);
  assert(treeItem.description.includes('💬') && treeItem.description.includes('📦'), 'SessionTreeItem description must include 💬 and 📦 badges');
  assert(treeItem.tooltip && treeItem.tooltip.value.includes('Single Conversation Chat'), 'SessionTreeItem tooltip must indicate Single Conversation Chat');
  assert(treeItem.tooltip.value.includes('📦 Artifacts'), 'SessionTreeItem tooltip must indicate Artifacts item count');
  console.log('✓ Standardized pills and TreeView item verified successfully!');

  console.log('=== All Session Artifacts Gallery Verifications Passed Successfully! ===');
} finally {
  // Cleanup test directory
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch (err) {
    // Ignore cleanup error
  }
}
