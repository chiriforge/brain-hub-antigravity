const fs = require('fs');
const assert = require('assert');
const { MarkdownRenderer } = require('../out/services/MarkdownRenderer');
const { HIGHLIGHT_CSS } = require('../out/services/HighlightStyles');

console.log('Running Markdown Table & Inline Code Layout Verification Suite (SPEC-26110815)...\n');

// ============================================================================
// Tier 1: Happy Path Functional ACs (AC-1.1, AC-2.1, AC-2.2, AC-3.1, AC-4.1)
// ============================================================================

const sampleTableMd = [
  '| Thứ tự | Track ID | Mã Roadmap | Mức ưu tiên & Effort | Phạm vi & Lý do thực hiện theo thứ tự | Ghi chú `allowed_paths` / Chạy song song |',
  '| :--- | :--- | :--- | :--- | :--- | :--- |',
  '| **Next #1** (`Track #10`) | [26110725_feat_inrun_shelter_market_mysterious_v2](file:///d:/project/conductor/tracks/26110725_feat_inrun_shelter_market_mysterious_v2/index.md) | `RM-116`, `RM-117` | `P1` · `M` | Nâng cấp chuẩn V2 cho 4 sub-scenes (`TemporaryShelterScene`, `BlackMarketScene`, `MerchantScene`, `MysteriousPlaceScene`, `SalvageStationScene.ts`) + `DialogueOverlayManager` V2. | Dùng chung `public/style.css` và `en.json` / `vi.json` với `#11`, `#12` |'
].join('\n');

const renderedTableHtml = MarkdownRenderer.render(sampleTableMd);

// AC-1.1: GFM Table Wrapped in .table-container with .markdown-table
assert(
  renderedTableHtml.includes('<div class="table-container"><table class="markdown-table">'),
  'AC-1.1 FAILED: GFM table was not wrapped in <div class="table-container"><table class="markdown-table">'
);
assert(
  renderedTableHtml.includes('</table></div>'),
  'AC-1.1 FAILED: Closing </table></div> missing for table-container'
);
console.log('✓ AC-1.1: GFM table wrapped in <div class="table-container"><table class="markdown-table"> verified.');

// AC-2.1: Short inline code (<= 20 chars) classified as inline-code-short
const shortCodes = ['allowed_paths', 'Track #10', 'RM-116', 'RM-117', 'P1', 'M', 'MerchantScene', 'MysteriousPlaceScene', 'public/style.css', 'en.json', 'vi.json', '#11', '#12'];
for (const token of shortCodes) {
  const expectedTag = `<code class="inline-code inline-code-short">${MarkdownRenderer.escapeHtml(token)}</code>`;
  assert(
    renderedTableHtml.includes(expectedTag),
    `AC-2.1 FAILED: Short inline code "${token}" (${token.length} chars) missing class "inline-code inline-code-short"`
  );
}
console.log('✓ AC-2.1: Short inline codes (<= 20 chars) classified as "inline-code inline-code-short" verified.');

// AC-2.2: Long inline code (> 20 chars) classified as inline-code-long
const longCodes = ['TemporaryShelterScene', 'SalvageStationScene.ts', 'DialogueOverlayManager'];
for (const token of longCodes) {
  const expectedTag = `<code class="inline-code inline-code-long">${MarkdownRenderer.escapeHtml(token)}</code>`;
  assert(
    renderedTableHtml.includes(expectedTag),
    `AC-2.2 FAILED: Long inline code "${token}" (${token.length} chars) missing class "inline-code inline-code-long"`
  );
}
console.log('✓ AC-2.2: Long inline codes (> 20 chars) classified as "inline-code inline-code-long" verified.');

// AC-2.1, AC-2.2 & AC-3.1: HIGHLIGHT_CSS rules for inline code & .md-link-wrapper in tables
assert(
  HIGHLIGHT_CSS.includes('box-decoration-break: clone'),
  'AC-2.2 FAILED: HIGHLIGHT_CSS missing box-decoration-break: clone on .inline-code'
);
assert(
  HIGHLIGHT_CSS.includes('.inline-code-short') && HIGHLIGHT_CSS.includes('white-space: nowrap !important'),
  'AC-2.1 FAILED: HIGHLIGHT_CSS missing white-space: nowrap !important for .inline-code-short in table cells'
);
assert(
  HIGHLIGHT_CSS.includes('.inline-code-long') && HIGHLIGHT_CSS.includes('overflow-wrap: anywhere !important'),
  'AC-2.2 FAILED: HIGHLIGHT_CSS missing overflow-wrap: anywhere !important for .inline-code-long in table cells'
);
assert(
  HIGHLIGHT_CSS.includes('td .md-link-wrapper') &&
  HIGHLIGHT_CSS.includes('th .md-link-wrapper') &&
  HIGHLIGHT_CSS.includes('td .markdown-link.file-link'),
  'AC-3.1 FAILED: HIGHLIGHT_CSS missing table-scoped .md-link-wrapper and .markdown-link.file-link rules'
);
console.log('✓ AC-3.1: HIGHLIGHT_CSS table-scoped .md-link-wrapper and .inline-code rules verified.');

// ============================================================================
// Tier 2: Negative, Boundary & Code-Block Immunity Traps (AC-1.2)
// ============================================================================

const codeBlockTableMd = [
  'Here is a code block with a table:',
  '```html',
  '<table><tr><td>Inside fenced code</td></tr></table>',
  '```',
  'And inline code `<table><tr><td>inline</td></tr></table>` plus hex color `#38bdf8` in a real table:',
  '',
  '| Col A | Col B |',
  '| --- | --- |',
  '| `12345678901234567890` | `123456789012345678901` |',
  '| `#38bdf8` | Normal text |'
].join('\n');

const renderedMixedHtml = MarkdownRenderer.render(codeBlockTableMd);

// Verify only 1 .table-container was created (for the real GFM table, NOT for the fenced code block or inline code)
const containerMatches = renderedMixedHtml.match(/<div class="table-container">/g) || [];
assert.strictEqual(
  containerMatches.length,
  1,
  `AC-1.2 FAILED: Expected exactly 1 .table-container, found ${containerMatches.length}`
);

// Boundary 20 chars vs 21 chars
assert(
  renderedMixedHtml.includes('<code class="inline-code inline-code-short">12345678901234567890</code>'),
  'Boundary FAILED: 20-char inline code should be inline-code-short'
);
assert(
  renderedMixedHtml.includes('<code class="inline-code inline-code-long">123456789012345678901</code>'),
  'Boundary FAILED: 21-char inline code should be inline-code-long'
);

// Hex color chip inside table cell
assert(
  renderedMixedHtml.includes('class="color-chip-badge" data-color="#38bdf8"'),
  'Boundary FAILED: Hex color inside table cell should render as .color-chip-badge'
);

// Null / empty safety & idempotency
assert.strictEqual(MarkdownRenderer.render(''), '', 'Empty markdown should return empty string');
assert.strictEqual(MarkdownRenderer.wrapTablesInContainer(''), '', 'Empty HTML should return empty string');
const doubleWrapped = MarkdownRenderer.wrapTablesInContainer(renderedTableHtml);
assert.strictEqual(
  (doubleWrapped.match(/<div class="table-container">/g) || []).length,
  1,
  'Idempotency FAILED: wrapTablesInContainer double-wrapped an already wrapped table'
);
console.log('✓ AC-1.2 & Tier 2 Boundary Traps (fenced/inline <table> immunity, 20/21-char boundary, hex chip, idempotency) verified.');

// ============================================================================
// Tier 4: Unified Table CSS Across All 4 Views (AC-4.1)
// ============================================================================

const dashSrc = fs.readFileSync('src/views/DashboardWebviewPanel.ts', 'utf8');
const chatSrc = fs.readFileSync('src/views/ChatWebviewPanel.ts', 'utf8');
const previewSrc = fs.readFileSync('src/views/MarkdownPreviewWebviewPanel.ts', 'utf8');

assert(!dashSrc.includes('line-height: 2.1'), 'AC-4.1 FAILED: DashboardWebviewPanel.ts still has line-height: 2.1 on table');
assert(!chatSrc.includes('line-height: 2.1'), 'AC-4.1 FAILED: ChatWebviewPanel.ts still has line-height: 2.1 on table');

for (const [name, src] of [
  ['DashboardWebviewPanel.ts', dashSrc],
  ['ChatWebviewPanel.ts', chatSrc],
  ['MarkdownPreviewWebviewPanel.ts', previewSrc]
]) {
  assert(src.includes('.table-container'), `AC-4.1 FAILED: ${name} missing .table-container CSS`);
  assert(src.includes('word-break: normal !important'), `AC-4.1 FAILED: ${name} missing word-break: normal !important on th/td`);
  assert(src.includes('overflow-wrap: normal !important'), `AC-4.1 FAILED: ${name} missing overflow-wrap: normal !important on th/td`);
}
console.log('✓ AC-4.1: Unified table CSS across DashboardWebviewPanel, ChatWebviewPanel, and MarkdownPreviewWebviewPanel verified.');

console.log('\n🎉 ALL MARKDOWN TABLE & INLINE CODE LAYOUT TESTS PASSED!');
