const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

// Mock vscode
const Module = require('module');
const origRequire = Module.prototype.require;
Module.prototype.require = function (request) {
  if (request === 'vscode') {
    return {
      workspace: {
        getConfiguration: () => ({ get: (k, d) => d }),
        workspaceFolders: [{ uri: { fsPath: path.resolve(__dirname, '..') }, name: 'antigravity-history-viewer' }]
      },
      env: { clipboard: { writeText: async () => {} }, openExternal: async () => {} },
      Uri: {
        file: (p) => ({ fsPath: p }),
        joinPath: (base, ...segments) => ({ fsPath: path.join(base.fsPath || base, ...segments) })
      },
      TreeItem: class TreeItem {},
      TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
      EventEmitter: class EventEmitter { constructor() { this.event = () => {}; } fire() {} },
      ThemeIcon: class ThemeIcon { constructor(id) { this.id = id; } },
      ThemeColor: class ThemeColor { constructor(id) { this.id = id; } },
      commands: { registerCommand: () => {}, executeCommand: () => {} },
      window: { showInformationMessage: () => {}, showErrorMessage: () => {} }
    };
  }
  return origRequire.apply(this, arguments);
};

const { SessionScanner } = require('../out/services/SessionScanner');
const { DashboardWebviewPanel } = require('../out/views/DashboardWebviewPanel');
const { ChatWebviewPanel } = require('../out/views/ChatWebviewPanel');
const { MarkdownPreviewWebviewPanel } = require('../out/views/MarkdownPreviewWebviewPanel');

function assertScriptsValid(html, panelName) {
  const scriptRegex = /<script(?:\s+[^>]*)?>([\s\S]*?)<\/script>/gi;
  let match;
  let scriptIndex = 0;
  while ((match = scriptRegex.exec(html)) !== null) {
    const scriptContent = match[1];
    if (!scriptContent.trim()) continue;
    scriptIndex++;
    try {
      new vm.Script(scriptContent);
    } catch (e) {
      assert.fail(`Syntax error in ${panelName} script #${scriptIndex}: ${e.message}`);
    }
  }
  assert(scriptIndex > 0, `No scripts found in ${panelName}`);
}

async function run() {
  console.log('Validating webview client-side JavaScript syntax...');
  const scanner = SessionScanner.getInstance();
  const sessions = await scanner.scanSessions(false);
  const sampleSession = sessions[0] || {
    id: 'test-session',
    title: 'Test Session',
    path: path.resolve(__dirname, '..'),
    createdAt: new Date(),
    lastModified: new Date(),
    messageCount: 1
  };

  // 1. DashboardWebviewPanel
  const dashProto = DashboardWebviewPanel.prototype;
  const dummyDash = {
    selectedSessionId: sampleSession.id,
    isShowingCombinedThread: false,
    generateSessionListHtml: dashProto.generateSessionListHtml,
    renderSessionNavItemHtml: dashProto.renderSessionNavItemHtml,
    generateReaderHtml: dashProto.generateReaderHtml,
    groupMessages: dashProto.groupMessages,
    renderMessageItem: dashProto.renderMessageItem,
    renderSingleAutonomousStep: dashProto.renderSingleAutonomousStep,
    renderMessage: dashProto.renderMessage,
    extensionUri: { fsPath: path.resolve(__dirname, '..') },
    panel: { webview: { asWebviewUri: (u) => u } }
  };
  const dashHtml = dashProto.generateDashboardHtml.call(dummyDash, [sampleSession], sampleSession, [], [sampleSession], undefined, true);
  assertScriptsValid(dashHtml, 'DashboardWebviewPanel');
  console.log('✓ DashboardWebviewPanel scripts validated successfully');

  // 2. ChatWebviewPanel
  const chatProto = ChatWebviewPanel.prototype;
  const dummyChat = {
    currentSession: sampleSession,
    isShowingCombinedThread: false,
    groupMessages: chatProto.groupMessages,
    renderMessageItem: chatProto.renderMessageItem,
    renderSingleAutonomousStep: chatProto.renderSingleAutonomousStep,
    renderMessage: chatProto.renderMessage,
    extensionUri: { fsPath: path.resolve(__dirname, '..') },
    panel: { webview: { asWebviewUri: (u) => u } }
  };
  const chatHtml = chatProto.generateHtml.call(dummyChat, sampleSession, [], [sampleSession], true);
  assertScriptsValid(chatHtml, 'ChatWebviewPanel');
  console.log('✓ ChatWebviewPanel scripts validated successfully');

  // 3. MarkdownPreviewWebviewPanel
  const mdProto = MarkdownPreviewWebviewPanel.prototype;
  const dummyMd = {
    filePath: path.resolve(__dirname, '../ARCHITECTURE.md'),
    extensionUri: { fsPath: path.resolve(__dirname, '..') },
    panel: { webview: { asWebviewUri: (u) => u } }
  };
  const mdHtml = mdProto.generateHtml.call(dummyMd, '# Architecture Test', path.resolve(__dirname, '../ARCHITECTURE.md'));
  assertScriptsValid(mdHtml, 'MarkdownPreviewWebviewPanel');
  console.log('✓ MarkdownPreviewWebviewPanel scripts validated successfully');

  console.log('\n🎉 ALL WEBVIEW SCRIPTS PASSED SYNTAX VALIDATION!');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
