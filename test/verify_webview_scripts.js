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

function createMockDom() {
  const listeners = { window: {}, document: {} };
  const mockElement = () => ({
    style: {},
    classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false },
    setAttribute: () => {},
    getAttribute: () => '',
    removeAttribute: () => {},
    appendChild: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    querySelectorAll: () => [],
    querySelector: () => null,
    scrollIntoView: () => {},
    scrollTo: () => {},
    scrollTop: 0,
    scrollHeight: 100,
    clientHeight: 100,
    value: '',
    innerText: '',
    innerHTML: '',
    focus: () => {},
    select: () => {}
  });

  const dom = {
    console: {
      log: () => {},
      warn: () => {},
      error: () => {}
    },
    setTimeout: (fn, ms) => {},
    clearTimeout: () => {},
    setInterval: () => {},
    clearInterval: () => {},
    encodeURIComponent,
    decodeURIComponent,
    encodeURI,
    decodeURI,
    JSON,
    Math,
    Set,
    Map,
    Array,
    Object,
    String,
    Number,
    Boolean,
    RegExp,
    Date,
    acquireVsCodeApi: () => ({ postMessage: () => {}, getState: () => ({}), setState: () => {} }),
    window: {
      addEventListener: (type, fn) => {
        listeners.window[type] = listeners.window[type] || [];
        listeners.window[type].push(fn);
      },
      removeEventListener: () => {},
      innerWidth: 1024,
      innerHeight: 768,
      scrollTo: () => {},
      getSelection: () => ({ isCollapsed: true, toString: () => '' })
    },
    document: {
      addEventListener: (type, fn) => {
        listeners.document[type] = listeners.document[type] || [];
        listeners.document[type].push(fn);
      },
      removeEventListener: () => {},
      getElementById: (id) => mockElement(),
      querySelector: (sel) => mockElement(),
      querySelectorAll: (sel) => [],
      createElement: (tag) => mockElement(),
      body: mockElement()
    },
    navigator: {
      clipboard: {
        writeText: async () => {},
        write: async () => {}
      }
    },
    IntersectionObserver: class {
      observe() {}
      disconnect() {}
    },
    Image: class {
      constructor() { this.width = 100; this.height = 100; }
    }
  };
  dom.window.document = dom.document;
  dom.window.navigator = dom.navigator;
  dom.window.window = dom.window;
  return { context: vm.createContext(dom), listeners };
}

function assertScriptsValid(html, panelName) {
  const scriptRegex = /<script(?:\s+[^>]*)?>([\s\S]*?)<\/script>/gi;
  let match;
  let scriptIndex = 0;
  while ((match = scriptRegex.exec(html)) !== null) {
    const scriptContent = match[1];
    if (!scriptContent.trim()) continue;
    scriptIndex++;
    try {
      const script = new vm.Script(scriptContent);
      const { context, listeners } = createMockDom();
      script.runInContext(context);

      if (listeners.document['DOMContentLoaded']) {
        listeners.document['DOMContentLoaded'].forEach(fn => fn());
      }
      if (listeners.window['message']) {
        listeners.window['message'].forEach(fn => fn({
          data: {
            command: 'updateReader',
            sessionId: 'test-session',
            chatHtml: '<div id="chatTimeline"><div>Message</div></div>'
          }
        }));
      }
    } catch (e) {
      console.error(e);
      assert.fail(`Error in ${panelName} script #${scriptIndex}: ${e.stack || e.message}`);
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
  assertScriptsValid(mdHtml, 'MarkdownPreviewWebviewPanel (ARCHITECTURE.md)');

  // Test README_VI.md specifically
  const viPath = path.resolve(__dirname, '../README_VI.md');
  const viRaw = fs.readFileSync(viPath, 'utf8');
  dummyMd.filePath = viPath;
  const viHtml = mdProto.generateHtml.call(dummyMd, '<div>' + viRaw.slice(0, 200) + '</div>', viRaw);
  assertScriptsValid(viHtml, 'MarkdownPreviewWebviewPanel (README_VI.md)');
  console.log('✓ MarkdownPreviewWebviewPanel scripts validated successfully');

  console.log('\n🎉 ALL WEBVIEW SCRIPTS PASSED SYNTAX VALIDATION!');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
