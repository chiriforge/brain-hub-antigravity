const assert = require('assert');
const { MarkdownRenderer } = require('../out/services/MarkdownRenderer');

console.log('=== Verifying Antigravity Sliding-Window Math Disambiguation ===\n');

// 1. Hình 1 from Session d5275d1b-d803-4efd-9e94-45f197de2467:
// "$3 \times 11$ Linear" and "$3 \times 11$"
console.log('1. Testing Hình 1: "$3 \\times 11$ Linear" and "$3 \\times 11$"...');
const hinh1Md = [
  '- **Giai đoạn 1 (Lv 1–100)**: Tăng trưởng theo ma trận **$3 \\times 11$ Linear**.',
  '- **Cấu trúc bảng**: Ma trận $3 \\times 11$ gồm 3 nhánh.'
].join('\n');
const hinh1Html = MarkdownRenderer.render(hinh1Md);
assert(!hinh1Html.includes('$3 \\times 11$'), 'Hình 1 FAILED: Raw "$3 \\times 11$" leaked into HTML');
assert(!hinh1Html.includes('3 \\times 11$'), 'Hình 1 FAILED: Unrendered "\\times 11$" leaked into HTML');
const hinh1KatexCount = (hinh1Html.match(/class="katex"/g) || []).length;
assert.strictEqual(hinh1KatexCount, 2, `Hình 1 FAILED: Expected 2 .katex elements, got ${hinh1KatexCount}`);
console.log('✓ Hình 1 passed!');

// 2. Hình 2 from Session d5275d1b-d803-4efd-9e94-45f197de2467:
// "$1.000 \times P_{\text{natural}}$" and "$2.500 \times P_{\text{natural}}$"
console.log('2. Testing Hình 2: "$1.000 \\times P_{\\text{natural}}$" and "$2.500 \\times P_{\\text{natural}}$"...');
const hinh2Md = [
  '- **Chuẩn F2P**: Sức mạnh đạt **$1.000 \\times P_{\\text{natural}}$**.',
  '- **Trần (Hard Cap)**: Đạt tối đa **$2.500 \\times P_{\\text{natural}}$** khi full đồ.'
].join('\n');
const hinh2Html = MarkdownRenderer.render(hinh2Md);
assert(!hinh2Html.includes('$1.000'), 'Hình 2 FAILED: Raw "$1.000" leaked into HTML');
assert(!hinh2Html.includes('$2.500'), 'Hình 2 FAILED: Raw "$2.500" leaked into HTML');
assert(!hinh2Html.includes('P_{\\text{natural}}$'), 'Hình 2 FAILED: Raw closing "P_{\\text{natural}}$" leaked into HTML');
const hinh2KatexCount = (hinh2Html.match(/class="katex"/g) || []).length;
assert.strictEqual(hinh2KatexCount, 2, `Hình 2 FAILED: Expected 2 .katex elements, got ${hinh2KatexCount}`);
console.log('✓ Hình 2 passed!');

// 3. Hình 3 from Session d5275d1b-d803-4efd-9e94-45f197de2467:
// "Khớp $1:1$ với người chơi đã gom đủ $100\%$ ngân sách ($2.50 \times P_{\text{natural}}$)."
console.log('3. Testing Hình 3: Ratio "$1:1$" + "$100\\%$" + "($2.50 \\times P_{\\text{natural}}$)" on same line...');
const hinh3Md = 'Khớp $1:1$ với người chơi đã gom đủ $100\\%$ ngân sách ($2.50 \\times P_{\\text{natural}}$).';
const hinh3Html = MarkdownRenderer.render(hinh3Md);
assert(!hinh3Html.includes('$1:1$'), 'Hình 3 FAILED: Raw "$1:1$" leaked into HTML');
assert(!hinh3Html.includes('$100\\%$'), 'Hình 3 FAILED: Raw "$100\\%$" leaked into HTML');
assert(!hinh3Html.includes('$2.50'), 'Hình 3 FAILED: Raw "$2.50" leaked into HTML');
// Ensure Vietnamese prose is NOT swallowed inside katex
assert(
  hinh3Html.includes('</span> với người chơi đã gom đủ <span class="katex">'),
  'Hình 3 FAILED: Vietnamese prose "với người chơi đã gom đủ" was swallowed inside KaTeX!'
);
const hinh3KatexCount = (hinh3Html.match(/class="katex"/g) || []).length;
assert.strictEqual(hinh3KatexCount, 3, `Hình 3 FAILED: Expected 3 .katex elements ($1:1$, $100\\%$, $2.50 \\times P$), got ${hinh3KatexCount}`);
console.log('✓ Hình 3 passed!');

// 4. Sliding-Window Currency & Shell Variable Disambiguation (xGb boundary traps)
console.log('4. Testing Currency & Shell Variable Disambiguation (xGb rules)...');
const mixedCurrencyMathMd = [
  'Chi phí từ $100 đến $200 cho mỗi server.',
  'Gói $100 chạy giải thuật có độ phức tạp $O(N \\log N)$ trên máy chủ.',
  'Biến môi trường $HOME và ${PATH} cùng với $USER_ID_1 được cấu hình cho hàm $f(x) = x^2 + 1$.',
  'Ký tự đã escape \\$500 không mở công thức với $a + b = c$.'
].join('\n\n');
const mixedHtml = MarkdownRenderer.render(mixedCurrencyMathMd);
assert(mixedHtml.includes('$100 đến $200'), 'Consecutive currencies "$100 đến $200" should remain literal');
assert(mixedHtml.includes('Gói $100 chạy giải thuật'), 'Single currency before math "$100" should remain literal');
assert(mixedHtml.includes('$HOME') && mixedHtml.includes('${PATH}') && mixedHtml.includes('$USER_ID_1'), 'Shell variables should remain literal');
assert(mixedHtml.includes('$500'), 'Escaped \\$500 should render as literal $500');
const mixedKatexCount = (mixedHtml.match(/class="katex"/g) || []).length;
assert.strictEqual(mixedKatexCount, 3, `Expected exactly 3 math formulas ($O(N \\log N)$, $f(x)=x^2+1$, $a+b=c$), got ${mixedKatexCount}`);
assert(!mixedHtml.includes('\uE0D0') && !mixedHtml.includes('\uE0D1'), 'PUA sentinels \\uE0D0 / \\uE0D1 must NEVER leak into final HTML');
console.log('✓ Currency & Shell Variable Disambiguation passed!');

// 5. Blockquote Display Math Normalization (sGb / rGb)
console.log('5. Testing Blockquote Display Math Normalization (sGb / rGb)...');
const blockquoteMathMd = '> Công thức tổng quát:\n> $$ E = mc^2 $$';
const blockquoteHtml = MarkdownRenderer.render(blockquoteMathMd);
assert(blockquoteHtml.includes('class="katex-display"') || blockquoteHtml.includes('class="katex"'), 'Blockquote $$ math should render via KaTeX');
assert(!blockquoteHtml.includes('$$'), 'Raw $$ delimiters should not remain in blockquote');
console.log('✓ Blockquote Display Math Normalization passed!');

// 6. Antigravity Mermaid Preprocessor (zyc)
console.log('6. Testing Antigravity Mermaid Preprocessor (zyc)...');
const { MermaidSanitizer } = require('../out/services/MermaidSanitizer');
assert.strictEqual(typeof MermaidSanitizer.preprocessAntigravitySyntax, 'function', 'preprocessAntigravitySyntax must be a function');
const zycSample = [
  '---',
  'title: System Architecture',
  '---',
  '%%{init: {"theme": "dark"}}%%',
  'flowchart LR',
  '  DB@{ shape: cyl, label: "User &rarr; DB" } --> API["`Service &le; 10ms`"]'
].join('\n');
const zycOut = MermaidSanitizer.preprocessAntigravitySyntax(zycSample);
assert(!zycOut.includes('---'), 'YAML frontmatter should be stripped');
assert(!zycOut.includes('%%{init'), 'Mermaid directive should be stripped');
assert(zycOut.includes('DB[("User → DB")]'), `Expected v10 shape conversion and entity decode, got: ${zycOut}`);
assert(zycOut.includes('API["Service ≤ 10ms"]'), `Expected inner backtick removal and &le; decode, got: ${zycOut}`);
console.log('✓ Antigravity Mermaid Preprocessor (zyc) passed!');

// 7. beautiful-mermaid Orthogonal SVG Rendering (Screenshot 1 Diagram)
console.log('7. Testing beautiful-mermaid Orthogonal SVG Rendering...');
assert.strictEqual(typeof MermaidSanitizer.renderBeautifulMermaid, 'function', 'renderBeautifulMermaid must be a function');
const unlimitedGrindingMermaid = [
  '```mermaid',
  'graph TD',
  '    Root["Bài toán Unlimited Grinding (Level & Mod -> ∞)"] --> Axis1["Trục 1: Tương quan Sinh tồn vs Sát thương (HP, DEF, Mana vs Damage)"]',
  '    Root --> Axis2["Trục 2: Tương quan Chỉ số Tuyến tính vs Chỉ số Xác suất/Nhịp độ (Speed, Crit, Leech)"]',
  '    Root --> Axis3["Trục 3: Quy luật Nhân Tier (1x..5x) & Cơ chế Quái vật bám đuổi sau Lv 100"]',
  '```'
].join('\n');
const renderedMermaidHtml = MarkdownRenderer.render(unlimitedGrindingMermaid);
assert(renderedMermaidHtml.includes('data-beautiful-svg="'), 'Mermaid container should include pre-rendered data-beautiful-svg attribute');
const svgMatch = renderedMermaidHtml.match(/data-beautiful-svg="([^"]+)"/);
assert(svgMatch && svgMatch[1], 'data-beautiful-svg attribute must be non-empty');
const decodedSvg = decodeURIComponent(svgMatch[1]);
assert(decodedSvg.includes('<svg ') && decodedSvg.includes('<polyline class="edge"'), 'SVG must use beautiful-mermaid orthogonal <polyline class="edge">');
assert(!decodedSvg.includes('@import url('), 'External Google Fonts @import must be stripped for offline CSP');
console.log('✓ beautiful-mermaid Orthogonal SVG Rendering passed!');

// 8. Smart Auto Word-Wrap for Wide Diagrams (Preventing Tiny Text)
console.log('8. Testing Smart Auto Word-Wrap on Wide Flowchart TD...');
const wideFlowchart = [
  'flowchart TD',
  '    RawLine["Chuỗi Markdown gốc có chứa công thức $...$"] --> Regex452["Regex dòng 452: (?=\\\\d+(?:[.,]\\\\d+)*(?:\\\\s|[.,;:?!)]|$))"]',
  '    Regex452 -->|"Trường hợp 1: Số + khoảng trắng ($3 \\\\times 11$)"| Bug1["Hình 1: Khớp \\\\d+ (\'3\') + \\\\s (\' \') -> Escape nhầm thành \\\\$3 \\\\times 11$"]',
  '    Regex452 -->|"Trường hợp 2: Số thập phân ($1.000, $2.500)"| Bug2["Hình 2: Khớp \\\\s hoặc Backtrack vào dấu \'.\' -> Escape nhầm thành \\\\$1.000...$"]',
  '    Regex452 -->|"Trường hợp 3: Tỷ lệ $1:1$ + Số thập phân ($2.50\\\\times)"| Bug3["Hình 3: Khớp \':\' trong $1:1$ và Backtrack \'.\' trong $2.50 -> Lệch pha chẵn/lẻ toàn bộ dấu $ trên dòng"]'
].join('\n');
const wideSvg = MermaidSanitizer.renderBeautifulMermaid(wideFlowchart);
assert(wideSvg && wideSvg.includes('<svg '), 'Wide flowchart must render valid SVG');
const viewBoxMatch = wideSvg.match(/viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/);
assert(viewBoxMatch, 'SVG must have viewBox');
const svgWidth = parseFloat(viewBoxMatch[1]);
assert(svgWidth < 1150, `Expected Smart Word-Wrap to keep SVG width < 1150px (down from ~2000px), got ${svgWidth}px`);
assert(wideSvg.includes('<tspan '), 'Multi-line wrapped labels must render <tspan> lines inside SVG');
console.log(`✓ Smart Auto Word-Wrap passed! (Compact SVG width: ${svgWidth}px)`);

// 9. Graceful Fallback for Unsupported Diagram Types (e.g. mindmap / gantt)
console.log('9. Testing Graceful Fallback for Unsupported Diagram Types...');
const mindmapSvg = MermaidSanitizer.renderBeautifulMermaid('mindmap\n  root((Brain Hub))\n    Mermaid\n    KaTeX');
assert.strictEqual(mindmapSvg, null, 'Unsupported mindmap should return null for mermaid.min.js fallback');
console.log('✓ Graceful Fallback passed!');

// 10. Webview Theme Variables & Click-to-Fullscreen Integration Across All 3 Panels
console.log('10. Testing Webview Theme Tokens & Click-to-Fullscreen in Chat, Dashboard & Preview...');
const fs = require('fs');
for (const panelFile of [
  'src/views/ChatWebviewPanel.ts',
  'src/views/DashboardWebviewPanel.ts',
  'src/views/MarkdownPreviewWebviewPanel.ts'
]) {
  const src = fs.readFileSync(panelFile, 'utf8');
  assert(src.includes('--mermaid-bg: #18181B;'), `${panelFile}: missing dark --mermaid-bg`);
  assert(src.includes('--mermaid-bg: #FFFFFF;'), `${panelFile}: missing light --mermaid-bg`);
  assert(src.includes('body.vscode-high-contrast'), `${panelFile}: missing high-contrast theme block`);
  assert(src.includes("getAttribute('data-beautiful-svg')"), `${panelFile}: missing data-beautiful-svg synchronous mount`);
  assert(src.includes('onclick="openFullscreen(this)"'), `${panelFile}: missing click-to-fullscreen binding on .mermaid-body`);
  assert(src.includes('id="diagramModal"'), `${panelFile}: missing #diagramModal fullscreen canvas container`);
  assert(src.includes('applySvgNaturalDimensions'), `${panelFile}: missing applySvgNaturalDimensions helper`);
  assert(!src.includes("data:image/svg+xml;charset=utf-8"), `${panelFile}: must not use data:image/svg+xml in <img> for SVG modal`);
}
console.log('✓ Webview Theme Tokens & Click-to-Fullscreen passed!');

// 11. Verify esbuild Bundles beautiful-mermaid Inline (No External require("beautiful-mermaid"))
if (fs.existsSync('dist/extension.js')) {
  console.log('11. Testing dist/extension.js static bundling of beautiful-mermaid...');
  const distCode = fs.readFileSync('dist/extension.js', 'utf8');
  assert(!distCode.includes('require("beautiful-mermaid")') && !distCode.includes("require('beautiful-mermaid')"), 'dist/extension.js must bundle beautiful-mermaid inline, not leave external require("beautiful-mermaid")');
  console.log('✓ dist/extension.js static bundling of beautiful-mermaid passed!');
}

console.log('\nALL ANTIGRAVITY MATH & BEAUTIFUL-MERMAID TESTS PASSED!');
