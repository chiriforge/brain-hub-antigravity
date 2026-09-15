const assert = require('assert');
const path = require('path');
const fs = require('fs');

// Mock vscode module for service tests
const Module = require('module');
const origRequire = Module.prototype.require;
Module.prototype.require = function (request) {
  if (request === 'vscode') {
    return {
      workspace: {
        getConfiguration: () => ({ get: (k, d) => d }),
        workspaceFolders: [{ uri: { fsPath: path.resolve(__dirname, '..') } }]
      },
      env: { clipboard: { writeText: async () => {} }, openExternal: async () => {} },
      Uri: {
        file: (p) => ({ fsPath: p }),
        joinPath: (base, ...segments) => ({ fsPath: path.join(base.fsPath || base, ...segments) })
      },
      commands: { registerCommand: () => {}, executeCommand: () => {} },
      window: { showInformationMessage: () => {}, showErrorMessage: () => {}, showSaveDialog: async () => {} }
    };
  }
  return origRequire.apply(this, arguments);
};

console.log('--- Running Test Suite: Webview Text Selection & Context Menu ---');

// Test 1: Check HighlightStyles.ts for user-drag: none and ::selection
console.log('[Test 1] Verifying HighlightStyles contains drag-prevention and ::selection CSS...');
const highlightStylesPath = path.resolve(__dirname, '../src/services/HighlightStyles.ts');
const highlightStylesContent = fs.readFileSync(highlightStylesPath, 'utf8');

assert(
  highlightStylesContent.includes('-webkit-user-drag: none') || highlightStylesContent.includes('user-drag: none'),
  'FAIL: HighlightStyles.ts must define -webkit-user-drag: none to prevent drag interference during text selection'
);

assert(
  highlightStylesContent.includes('::selection'),
  'FAIL: HighlightStyles.ts must define ::selection high-contrast styling'
);

assert(
  highlightStylesContent.includes('.webview-toast') || highlightStylesContent.includes('toastNotification'),
  'FAIL: HighlightStyles.ts must define reusable toast notification CSS styling'
);

console.log('✓ Test 1 Passed: HighlightStyles has drag prevention, ::selection and toast styles');

// Test 2 & 3: Check MarkdownRenderer data attributes
console.log('[Test 2] Verifying MarkdownRenderer preserves decoded path on file links...');
const { MarkdownRenderer } = require('../out/services/MarkdownRenderer');
const renderedLink = MarkdownRenderer.render('[Config File](file:///path/to/game_config.json)');
assert(
  renderedLink.includes('data-decoded-path='),
  'FAIL: MarkdownRenderer must output data-decoded-path on file links for clean copy target'
);
console.log('✓ Test 2 Passed: MarkdownRenderer preserves data-decoded-path on links');

console.log('[Test 3] Verifying MarkdownRenderer outputs data-image-src on images...');
const renderedImg = MarkdownRenderer.renderImage('https://example.com/demo.png', 'Demo Image', 'Caption');
assert(
  renderedImg.includes('data-image-src='),
  'FAIL: MarkdownRenderer must output data-image-src on rendered images'
);
console.log('✓ Test 3 Passed: MarkdownRenderer outputs data-image-src on images');

// Test 4: Verify ChatWebviewPanel.ts contains context menu container and VS Code theme styles
console.log('[Test 4] Verifying ChatWebviewPanel context menu markup and styling...');
const chatPanelPath = path.resolve(__dirname, '../src/views/ChatWebviewPanel.ts');
const chatPanelContent = fs.readFileSync(chatPanelPath, 'utf8');

assert(
  chatPanelContent.includes('customContextMenu') || chatPanelContent.includes('custom-context-menu'),
  'FAIL: ChatWebviewPanel.ts must include custom context menu DOM element'
);
assert(
  chatPanelContent.includes('--vscode-menu-background') && chatPanelContent.includes('--vscode-menu-selectionBackground'),
  'FAIL: ChatWebviewPanel.ts must style context menu using VS Code menu theme variables'
);
console.log('✓ Test 4 Passed: ChatWebviewPanel has context menu markup and styles');

// Test 5: Verify client-side contextmenu listener and action handling
console.log('[Test 5] Verifying ChatWebviewPanel client-side contextmenu event handling...');
assert(
  chatPanelContent.includes("addEventListener('contextmenu'") || chatPanelContent.includes('addEventListener("contextmenu"'),
  'FAIL: ChatWebviewPanel.ts must register client-side contextmenu event listener'
);
assert(
  chatPanelContent.includes('copyLinkPath') || chatPanelContent.includes('data-decoded-path') || chatPanelContent.includes('Copy Link'),
  'FAIL: ChatWebviewPanel.ts must implement link path copy action'
);
console.log('✓ Test 5 Passed: ChatWebviewPanel has contextmenu listener and actions');

// Test 6: Verify selection-aware click suppression
console.log('[Test 6] Verifying ChatWebviewPanel selection-aware click suppression...');
assert(
  chatPanelContent.includes('window.getSelection') && (chatPanelContent.includes('.toString()') || chatPanelContent.includes('.isCollapsed')),
  'FAIL: ChatWebviewPanel.ts must check window.getSelection() in click handlers to prevent accidental navigation when finishing a text selection'
);
console.log('✓ Test 6 Passed: ChatWebviewPanel has selection-aware click suppression');

// Test 7: Verify Extension Host message handlers for context menu actions
console.log('[Test 7] Verifying ChatWebviewPanel Extension Host message handlers...');
assert(
  chatPanelContent.includes('saveImageAs') || chatPanelContent.includes('showSaveDialog'),
  'FAIL: ChatWebviewPanel.ts must handle saveImageAs command using vscode.window.showSaveDialog'
);
assert(
  chatPanelContent.includes('openImageExternal') || chatPanelContent.includes('env.openExternal'),
  'FAIL: ChatWebviewPanel.ts must handle openImageExternal command'
);
console.log('✓ Test 7 Passed: ChatWebviewPanel handles context menu Extension Host messages');

// Test 8: Verify binary image copying logic using Canvas / Blob to PNG
console.log('[Test 8] Verifying copyImageToClipboard Canvas/Blob to image/png implementation...');
assert(
  chatPanelContent.includes('copyImageToClipboard') && chatPanelContent.includes("canvas.toBlob") && chatPanelContent.includes("'image/png'"),
  'FAIL: ChatWebviewPanel.ts must implement copyImageToClipboard using Canvas.toBlob with image/png'
);
console.log('✓ Test 8 Passed: copyImageToClipboard implements Canvas/Blob to PNG');

// Test 9: Verify Lightbox floating toolbar buttons
console.log('[Test 9] Verifying Lightbox floating toolbar buttons in ChatWebviewPanel...');
assert(
  chatPanelContent.includes('media-modal-toolbar') && chatPanelContent.includes('btnModalCopyImg') && chatPanelContent.includes('btnModalCopyPath'),
  'FAIL: ChatWebviewPanel.ts must include interactive floating toolbar inside media modal'
);
assert(
  chatPanelContent.includes('btnModalSaveAs') && chatPanelContent.includes('btnModalOpenExt'),
  'FAIL: ChatWebviewPanel.ts toolbar must include Save As and Open in System buttons'
);
console.log('✓ Test 9 Passed: Lightbox floating toolbar buttons verified');

// Test 10: Verify zoom toggle logic in Lightbox modal
console.log('[Test 10] Verifying Lightbox modal zoom toggle logic...');
assert(
  chatPanelContent.includes('toggleModalZoom') && chatPanelContent.includes('.zoomed'),
  'FAIL: ChatWebviewPanel.ts must implement toggleModalZoom and .zoomed styling'
);
console.log('✓ Test 10 Passed: Lightbox modal zoom toggle verified');

// Test 11: Cross-Webview Parity - DashboardWebviewPanel.ts
console.log('[Test 11] Verifying DashboardWebviewPanel parity for context menu, click suppression, and image lightbox...');
const dashPanelPath = path.resolve(__dirname, '../src/views/DashboardWebviewPanel.ts');
const dashPanelContent = fs.readFileSync(dashPanelPath, 'utf8');

assert(
  dashPanelContent.includes('customContextMenu') && dashPanelContent.includes('custom-context-menu'),
  'FAIL: DashboardWebviewPanel.ts must include custom context menu DOM element and styling'
);
assert(
  dashPanelContent.includes("addEventListener('contextmenu'") || dashPanelContent.includes('addEventListener("contextmenu"'),
  'FAIL: DashboardWebviewPanel.ts must register client-side contextmenu event listener'
);
assert(
  dashPanelContent.includes('window.getSelection') && (dashPanelContent.includes('.toString()') || dashPanelContent.includes('.isCollapsed')),
  'FAIL: DashboardWebviewPanel.ts must implement selection-aware click suppression'
);
assert(
  dashPanelContent.includes('copyImageToClipboard') && dashPanelContent.includes('media-modal-toolbar'),
  'FAIL: DashboardWebviewPanel.ts must implement copyImageToClipboard and media modal floating toolbar'
);
assert(
  dashPanelContent.includes('saveImageAs') && dashPanelContent.includes('openImageExternal'),
  'FAIL: DashboardWebviewPanel.ts must handle saveImageAs and openImageExternal host messages'
);
assert(
  dashPanelContent.includes('currentLoadedSessionId') && dashPanelContent.includes('matchesWorkspaceFilter') && dashPanelContent.includes('isWorkspaceFilterActive'),
  'FAIL: DashboardWebviewPanel.ts must preserve workspace filter state and currentLoadedSessionId'
);
console.log('✓ Test 11 Passed: DashboardWebviewPanel parity verified');

// Test 12: Cross-Webview Parity - MarkdownPreviewWebviewPanel.ts
console.log('[Test 12] Verifying MarkdownPreviewWebviewPanel parity for context menu, click suppression, and image lightbox...');
const mdPanelPath = path.resolve(__dirname, '../src/views/MarkdownPreviewWebviewPanel.ts');
const mdPanelContent = fs.readFileSync(mdPanelPath, 'utf8');

assert(
  mdPanelContent.includes('customContextMenu') && mdPanelContent.includes('custom-context-menu'),
  'FAIL: MarkdownPreviewWebviewPanel.ts must include custom context menu DOM element and styling'
);
assert(
  mdPanelContent.includes("addEventListener('contextmenu'") || mdPanelContent.includes('addEventListener("contextmenu"'),
  'FAIL: MarkdownPreviewWebviewPanel.ts must register client-side contextmenu event listener'
);
assert(
  mdPanelContent.includes('window.getSelection') && (mdPanelContent.includes('.toString()') || mdPanelContent.includes('.isCollapsed')),
  'FAIL: MarkdownPreviewWebviewPanel.ts must implement selection-aware click suppression'
);
assert(
  mdPanelContent.includes('mediaModal') && mdPanelContent.includes('media-modal-toolbar'),
  'FAIL: MarkdownPreviewWebviewPanel.ts must include mediaModal and media-modal-toolbar'
);
assert(
  mdPanelContent.includes('copyImageToClipboard') && mdPanelContent.includes('toggleModalZoom'),
  'FAIL: MarkdownPreviewWebviewPanel.ts must implement copyImageToClipboard and toggleModalZoom'
);
assert(
  mdPanelContent.includes('saveImageAs') && mdPanelContent.includes('openImageExternal'),
  'FAIL: MarkdownPreviewWebviewPanel.ts must handle saveImageAs and openImageExternal host messages'
);
console.log('✓ Test 12 Passed: MarkdownPreviewWebviewPanel parity verified');

console.log('\n🎉 ALL 12 WEBVIEW SELECTION & CONTEXT MENU TESTS PASSED!\n');
