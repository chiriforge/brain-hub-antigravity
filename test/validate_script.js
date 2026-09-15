const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Module = require('module');

const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === 'vscode') {
    return {
      workspace: {
        getConfiguration: () => ({ get: (k, d) => d }),
        workspaceFolders: []
      },
      Uri: {
        file: (f) => ({ fsPath: f, path: f, scheme: 'file', toString: () => 'uri://' + f }),
        joinPath: (b, ...p) => ({ fsPath: path.join(b.fsPath, ...p) })
      },
      EventEmitter: class {
        constructor() { this.event = () => ({ dispose: () => {} }); }
        fire() {}
        dispose() {}
      }
    };
  }
  return originalRequire.apply(this, arguments);
};

const { DashboardWebviewPanel } = require('../out/views/DashboardWebviewPanel');
const { ChatWebviewPanel } = require('../out/views/ChatWebviewPanel');

const sampleSession = {
  id: 'test-123',
  title: 'Test Session',
  path: 'C:/fake/path',
  createdAt: new Date(),
  lastModified: new Date(),
  messages: [],
  artifacts: []
};

// 1. Dashboard
const dashboardInstance = Object.create(DashboardWebviewPanel.prototype);
dashboardInstance.extensionUri = { fsPath: 'C:/fake' };
dashboardInstance.panel = {
  webview: {
    asWebviewUri: (u) => ({ toString: () => 'uri://' + u.fsPath })
  }
};
dashboardInstance.getAppConfigState = () => ({
  messageOrder: 'newestFirst',
  defaultToolsState: 'collapsed',
  defaultAiStepsState: 'collapsed',
  sessionSortBy: 'lastModified'
});

const dHtml = dashboardInstance['generateDashboardHtml']([sampleSession], sampleSession, [], [sampleSession], dashboardInstance.getAppConfigState(), true);
const dScriptMatches = dHtml.match(/<script(?:\s+[^>]*)?>([\s\S]*?)<\/script>/gi);
const dCode = dScriptMatches[0].replace(/<script(?:\s+[^>]*)?>/i, '').replace(/<\/script>/i, '');
try {
  new vm.Script(dCode, { filename: 'dashboardScript.js' });
  console.log('✓ Dashboard script syntax: VALID!');
} catch (err) {
  console.error('✗ Dashboard script ERROR:', err.message);
}

// 2. Chat Webview
const chatInstance = Object.create(ChatWebviewPanel.prototype);
chatInstance.extensionUri = { fsPath: 'C:/fake' };
chatInstance.panel = {
  webview: {
    asWebviewUri: (u) => ({ toString: () => 'uri://' + u.fsPath })
  }
};
chatInstance.getAppConfigState = () => ({
  messageOrder: 'newestFirst',
  defaultToolsState: 'collapsed',
  defaultAiStepsState: 'collapsed'
});

const cHtml = chatInstance['generateHtml'](sampleSession, [], []);
const cScriptMatches = cHtml.match(/<script(?:\s+[^>]*)?>([\s\S]*?)<\/script>/gi);
const cCode = cScriptMatches[0].replace(/<script(?:\s+[^>]*)?>/i, '').replace(/<\/script>/i, '');
try {
  new vm.Script(cCode, { filename: 'chatScript.js' });
  console.log('✓ Chat script syntax: VALID!');
} catch (err) {
  console.error('✗ Chat script ERROR:', err.message);
  const lines = cCode.split('\n');
  const lineNoMatch = err.stack.match(/chatScript\.js:(\d+)/);
  if (lineNoMatch) {
    const lineNo = parseInt(lineNoMatch[1], 10);
    console.error(`Line ${lineNo}:`);
    for (let i = Math.max(0, lineNo - 6); i < Math.min(lines.length, lineNo + 5); i++) {
      console.error(`${i + 1 === lineNo ? '-> ' : '   '}${i + 1}: ${lines[i]}`);
    }
  }
}
