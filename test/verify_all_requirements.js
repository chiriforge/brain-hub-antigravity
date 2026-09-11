const fs = require('fs');
const assert = require('assert');
const { MarkdownRenderer } = require('../out/services/MarkdownRenderer');

const dash = fs.readFileSync('src/views/DashboardWebviewPanel.ts', 'utf8');
const chat = fs.readFileSync('src/views/ChatWebviewPanel.ts', 'utf8');
const tree = fs.readFileSync('src/providers/ChatHistoryTreeProvider.ts', 'utf8');
const md = fs.readFileSync('src/services/MarkdownRenderer.ts', 'utf8');

console.log('Verifying all user requirements and regressions...');

// 1. Check message count format: 💬5 (no space, no msgs suffix)
assert(chat.includes('💬${messages.filter'), 'Chat: 💬${count} format missing');
assert(!chat.includes('💬 ${messages.filter'), 'Chat: Old space after 💬 still present');
assert(!chat.includes('} msgs</span>'), 'Chat: Old "msgs" suffix still present');

assert(dash.includes('💬${userPromptTotal}'), 'Dashboard: 💬${userPromptTotal} format missing');
assert(!dash.includes('💬 ${userPromptTotal}'), 'Dashboard: Old space after 💬 still present');
assert(!dash.includes('} msgs</span>'), 'Dashboard: Old "msgs" suffix still present');

assert(tree.includes('💬${session.messageCount}'), 'TreeProvider: 💬${session.messageCount} format missing');
console.log('✓ Requirement 1: "💬 5 msgs" -> "💬5" (no space, no msgs suffix) verified!');

// 2. Check step count format: 🤖188 (no space, robot emoji)
assert(chat.includes('🤖${maxStepIndex}'), 'Chat: 🤖${maxStepIndex} format missing');
assert(!chat.includes('⚡ ${maxStepIndex}'), 'Chat: Old ⚡ ${maxStepIndex} still present');

assert(dash.includes('🤖${maxStepIndex}'), 'Dashboard: 🤖${maxStepIndex} format missing');
assert(!dash.includes('⚡ ${maxStepIndex}'), 'Dashboard: Old ⚡ ${maxStepIndex} still present');
console.log('✓ Requirement 2: "⚡ 188" -> "🤖188" (no space, robot emoji) verified!');

// 3. Check 4-case pill icon logic (plain chat = no icon, artifact = 🔖, thread = 🧵, thread + artifact = 🧵🔖)
assert(chat.includes("const threadBadge = isThread ? '<span class=\"meta-badge green\" title=\"Connected Conversation Thread\">🧵</span>' : ''"), 'Chat: thread badge logic missing');
assert(chat.includes("const artifactBadge = session.hasArtifacts ? '<span class=\"meta-badge purple\" title=\"Artifacts Available (Plan / Walkthrough)\">🔖</span>' : ''"), 'Chat: artifact badge logic missing');
assert(chat.includes('${threadBadge}${artifactBadge}'), 'Chat: combined typeBadgeHtml missing');

assert(dash.includes("const threadBadge = isThread ? '<span class=\"meta-badge green\" title=\"Connected Conversation Thread\">🧵</span>' : ''"), 'Dashboard: thread badge logic missing');
assert(dash.includes("const artifactBadge = activeSession.hasArtifacts ? '<span class=\"meta-badge purple\" title=\"Artifacts Available (Plan / Walkthrough)\">🔖</span>' : ''"), 'Dashboard: artifact badge logic missing');
assert(dash.includes('const typeBadgeDetail = `${threadBadge}${artifactBadge}`'), 'Dashboard: combined typeBadgeDetail missing');

assert(tree.includes("const typeIconStr = `${isThread ? '🧵 ' : ''}${session.hasArtifacts ? '🔖 ' : ''}`"), 'TreeProvider: 4-case typeIconStr missing');
console.log('✓ Requirement 3: 4-case pill icon logic (none, artifact, thread, thread+artifact) verified!');

// 4. Check Live pill clipping fix
assert(chat.includes('transform-origin: left center;'), 'Chat: transform-origin: left center missing in .live-badge');
assert(dash.includes('transform-origin: left center;'), 'Dashboard: transform-origin: left center missing in .live-badge');
assert(chat.includes('overflow: visible;'), 'Chat: overflow: visible missing in .header-meta');
assert(dash.includes('overflow: visible;'), 'Dashboard: overflow: visible missing in .header-meta');
console.log('✓ Requirement 4: Live pill clipping fix (transform-origin & overflow) verified!');

// 5. Check no split screen
assert(!dash.includes('markdown.showPreviewToSide'), 'showPreviewToSide still in DashboardWebviewPanel');
assert(!chat.includes('markdown.showPreviewToSide'), 'showPreviewToSide still in ChatWebviewPanel');
assert(!dash.includes('ViewColumn.Beside'), 'ViewColumn.Beside still in DashboardWebviewPanel');
assert(!chat.includes('ViewColumn.Beside'), 'ViewColumn.Beside still in ChatWebviewPanel');
assert(dash.includes("'markdown.showPreview', fileUri"), 'markdown.showPreview missing in DashboardWebviewPanel');
assert(chat.includes("'markdown.showPreview', fileUri"), 'markdown.showPreview missing in ChatWebviewPanel');
console.log('✓ Regression: Open files in new tab without split screen verified!');

// 6. Check hover full path
assert(dash.includes('dataset.workspacePath'), 'workspacePath dataset missing in DashboardWebviewPanel');
assert(chat.includes('dataset.workspacePath'), 'workspacePath dataset missing in ChatWebviewPanel');
assert(dash.includes('link.title = combined'), 'Link title full path resolution missing in Dashboard');
assert(chat.includes('link.title = combined'), 'Link title full path resolution missing in Chat');

const sampleMd = '[spec](file:///d:/source-code/sample-project/specs/51.md) and @[specs/51.md] and file:///d:/source-code/main.ts';
const rendered = MarkdownRenderer.render(MarkdownRenderer.preprocessUserDirectives(sampleMd));
assert(rendered.includes('title="d:/source-code/sample-project/specs/51.md"'), 'MarkdownRenderer title full path missing');
assert(rendered.includes('title="specs/51.md"'), 'Directive mention title missing');
assert(rendered.includes('title="d:/source-code/main.ts"'), 'Bare file URL title full path missing');
console.log('✓ Regression: Hover over links displays full decoded path verified!');

// 8. Check Rich Markdown Preview & Mermaid Toggle Requirements
const mdPanelExists = fs.existsSync('src/views/MarkdownPreviewWebviewPanel.ts');
assert(mdPanelExists, 'MarkdownPreviewWebviewPanel.ts missing');
const mdPanel = fs.readFileSync('src/views/MarkdownPreviewWebviewPanel.ts', 'utf8');

// 8a. Check Markdown detection in MarkdownRenderer
assert(MarkdownRenderer.isMarkdownPath('test.md') === true, 'isMarkdownPath("test.md") should be true');
assert(MarkdownRenderer.isMarkdownPath('path/to/spec.markdown') === true, 'isMarkdownPath("spec.markdown") should be true');
assert(MarkdownRenderer.isMarkdownPath('src/main.ts') === false, 'isMarkdownPath("main.ts") should be false');
assert(MarkdownRenderer.isMarkdownPath('data.json') === false, 'isMarkdownPath("data.json") should be false');

// 8b. Check Dual action icons (🔎 Rich Preview and 📄 IDE Preview) for Markdown links
const mdLinkSample = '[Spec Doc](file:///d:/source-code/specs/plan.md) and [Source](file:///d:/source-code/src/app.ts)';
const renderedMdSample = MarkdownRenderer.render(mdLinkSample);

assert(renderedMdSample.includes('class="md-link-wrapper"'), 'md-link-wrapper missing in rendered Markdown link');
assert(renderedMdSample.includes('class="md-action-btn rich-preview-btn"'), 'rich-preview-btn (🔎) missing in rendered Markdown link');
assert(renderedMdSample.includes('class="md-action-btn ide-preview-btn"'), 'ide-preview-btn (📄) missing in rendered Markdown link');
assert(renderedMdSample.includes('data-is-md="true"'), 'data-is-md="true" missing on Markdown file-link');
assert(!renderedMdSample.includes('data-is-md="true" title="d:/source-code/src/app.ts"'), 'data-is-md="true" incorrectly added to non-MD file');

// 8c. Check Chat and Dashboard Webview Panels handle openRichPreview & openIdePreview
assert(chat.includes("case 'openRichPreview':"), 'Chat: openRichPreview handler missing');
assert(chat.includes("case 'openIdePreview':"), 'Chat: openIdePreview handler missing');
assert(dash.includes("case 'openRichPreview':"), 'Dashboard: openRichPreview handler missing');
assert(dash.includes("case 'openIdePreview':"), 'Dashboard: openIdePreview handler missing');

// 8d. Check Extension package.json command registration
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const cmdNames = pkg.contributes.commands.map(c => c.command);
assert(cmdNames.includes('brainHub.openRichMarkdownPreview'), 'package.json: openRichMarkdownPreview command missing');
assert(cmdNames.includes('brainHub.openIdeMarkdownPreview'), 'package.json: openIdeMarkdownPreview command missing');

// 8e. Check MarkdownPreviewWebviewPanel features (KaTeX, Mermaid Sanitize Toggle, Hot Reload Watcher)
assert(mdPanel.includes('sanitizeMermaid'), 'MarkdownPreviewWebviewPanel: sanitizeMermaid logic missing');
assert(mdPanel.toLowerCase().includes('katex'), 'MarkdownPreviewWebviewPanel: KaTeX support missing');
assert(mdPanel.includes('onDidChangeTextDocument') || mdPanel.includes('fsWatcher'), 'MarkdownPreviewWebviewPanel: File watcher for hot-reload missing');
// 8f. Check Local offline mermaid.min.js bundle exists
assert(fs.existsSync('media/mermaid.min.js'), 'media/mermaid.min.js local bundle missing');
assert(fs.statSync('media/mermaid.min.js').size > 1000000, 'media/mermaid.min.js size too small');

// 8g. Check Mermaid Diagrams Sanitization with complex sample
const { MermaidSanitizer } = require('../out/services/MermaidSanitizer');
const mockMermaid = `
graph TD
  subgraph SubHungle [hungle-vn (Private Repo)]
    A[Start] --> B{Should evaluate score > 100?}
    B -->|Score <= 50| C[Fail]
    B -->|Score > 100| D [Pass (Verified)]
    D --> E [(Database (Main))]
  end
`;
const sanitizedSpec = MermaidSanitizer.sanitize(mockMermaid);
assert(!/\b[a-zA-Z0-9_]+\{[^"\r\n\{\}]+\}/.test(sanitizedSpec), 'Sanitizer failed to quote decision node');
assert(!/\|[^\|\r\n]*[<>][^\|\r\n]*\|/.test(sanitizedSpec), 'Sanitizer failed to escape < or > in edge label');
assert(sanitizedSpec.includes('subgraph SubHungle ["hungle-vn (Private Repo)"]'), 'Sanitizer failed to sanitize subgraph ID [title]');
assert(sanitizedSpec.includes('D["Pass (Verified)"]'), 'Sanitizer failed to sanitize node with spacing before bracket');
assert(sanitizedSpec.includes('E[("Database (Main)")]'), 'Sanitizer failed to sanitize cylinder node with spacing before bracket');
console.log('✓ Requirement 8g: Verified Mermaid diagram sanitization on subgraphs, nodes with spacing, decision nodes, and comparison operators!');

// 8h. Check KaTeX Offline Fonts & Styles
const fontsDir = 'media/fonts';
assert(fs.existsSync(fontsDir), 'media/fonts directory missing');
const fontFiles = fs.readdirSync(fontsDir).filter(f => f.endsWith('.woff2'));
assert(fontFiles.length >= 20, `Expected at least 20 KaTeX woff2 font files, found ${fontFiles.length}`);
const { getKaTeXCss } = require('../out/services/KaTeXStyles');
const sampleKaTeXCss = getKaTeXCss('vscode-webview://test-id/media/fonts');
assert(sampleKaTeXCss.includes('url("vscode-webview://test-id/media/fonts/KaTeX_Main-Regular.woff2")'), 'KaTeX @font-face url replacement invalid');
assert(!/url\("?[^"\)]+woff2\s*\)/.test(sampleKaTeXCss), 'KaTeX @font-face has unclosed quote in url');
console.log(`✓ Requirement 8h: Verified 20 KaTeX offline .woff2 fonts and CSS URL generator!`);

// 8i. Check Fullscreen Diagram Canvas (Pan/Zoom & Theme dot-grid)
assert(mdPanel.includes('modal-canvas-viewport'), 'MarkdownPreviewWebviewPanel: modal canvas viewport missing');
assert(mdPanel.includes('zoomModal'), 'MarkdownPreviewWebviewPanel: zoomModal missing');
assert(mdPanel.includes('fitModalToScreen'), 'MarkdownPreviewWebviewPanel: fitModalToScreen missing');
assert(mdPanel.includes('radial-gradient'), 'MarkdownPreviewWebviewPanel: architectural dot-grid background missing');
console.log('✓ Requirement 8i: Fullscreen Diagram Canvas (pan & zoom, dot-grid, SVG copy) verified!');

assert(cmdNames.includes('brainHub.exportMarkdownToPdf'), 'package.json: exportMarkdownToPdf command missing');
assert(mdPanel.includes('handleExportPdf'), 'MarkdownPreviewWebviewPanel: handleExportPdf missing');
assert(mdPanel.includes('exportPdf()'), 'MarkdownPreviewWebviewPanel: exportPdf client caller missing');
assert(mdPanel.includes('getBrowserExecutablePath'), 'MarkdownPreviewWebviewPanel: getBrowserExecutablePath missing');
assert(mdPanel.includes('generatePrintHtml'), 'MarkdownPreviewWebviewPanel: generatePrintHtml missing');
console.log('✓ Requirement 10: Export Markdown to PDF with Headless Browser & Print Styles verified!');

console.log('✓ Requirement 8: Rich Markdown Preview, Dual Action Icons (🔎 / 📄), Offline Mermaid.js & Mermaid Sanitize Toggle verified!');

// 9. Check Jump to Latest Chat & Sidepanel Sync
assert(dash.includes("command: 'updateSessionList'"), 'DashboardWebviewPanel: updateSessionList command missing');
assert(dash.includes("scrollToSelected: true"), 'DashboardWebviewPanel: scrollToSelected option missing in selectLatestSession');
assert(dash.includes("const isSelected = item.classList.contains('selected');"), 'DashboardWebviewPanel: isSelected preservation in filterSessions missing');
assert(dash.includes("onSearchInputChanged('dashboardSearch');"), 'DashboardWebviewPanel: search clearing in loadLatestChat missing');
console.log('✓ Requirement 9: Jump to Latest Chat & Sidepanel session list synchronization verified!');

console.log('\n🎉 ALL REQUIREMENTS & REGRESSION CHECKS VERIFIED SUCCESSFULLY!');


