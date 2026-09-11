const assert = require('assert');
const { MarkdownRenderer } = require('../out/services/MarkdownRenderer');

console.log('Testing MarkdownRenderer new features...');

// 1. Test formatCodeLines
console.log('1. Testing formatCodeLines...');
const sampleHighlight = '<span class="hljs-comment">/* line 1\n * line 2 */</span>\nconst a = 1;';
const formatted = MarkdownRenderer.formatCodeLines(sampleHighlight);
assert(formatted.includes('<div class="code-line"><span class="line-num" aria-hidden="true">1</span>'), 'Line 1 missing');
assert(formatted.includes('<div class="code-line"><span class="line-num" aria-hidden="true">2</span>'), 'Line 2 missing');
assert(formatted.includes('<div class="code-line"><span class="line-num" aria-hidden="true">3</span>'), 'Line 3 missing');
// Check that line 1 has closed </span> and line 2 has opened <span class="hljs-comment">
assert(formatted.includes('/* line 1</span>'), 'Line 1 comment unclosed');
assert(formatted.includes('<span class="hljs-comment"> * line 2 */</span>'), 'Line 2 comment not reopened');
console.log('✓ formatCodeLines passed!');

// 2. Test renderColorChipsInText
console.log('2. Testing renderColorChipsInText...');
const sampleText = '<p>Trắng Bạc Kim Loại Chiseled (#F8FAFC) và nền tối #0D0F12</p><pre><code>const c = "#F8FAFC";</code></pre>';
const chipResult = MarkdownRenderer.renderColorChipsInText(sampleText);
assert(chipResult.includes('data-color="#F8FAFC"'), 'Color chip #F8FAFC missing');
assert(chipResult.includes('data-color="#0D0F12"'), 'Color chip #0D0F12 missing');
assert(chipResult.includes('<span class="color-swatch" style="background-color: #F8FAFC;"></span>'), 'Swatch missing');
// Verify code block is untouched
assert(chipResult.includes('<pre><code>const c = "#F8FAFC";</code></pre>'), 'Code block was corrupted');
console.log('✓ renderColorChipsInText passed!');

// 3. Test preprocessUserDirectives
console.log('3. Testing preprocessUserDirectives...');
const userPrompt = `/discuss
. hiệu ứng thở vi mô -> không thấy?
hãy đọc file @[specs/51-ink-stylized-ui-design-system-and-style-guide.md] và prototype @[conversation:"Art Direction Ink Style Proposal"]
ví dụ /discuss, @<file/folder name> và @ui_prototype.html hoặc @specs/
thị giác /discuss `;

const processed = MarkdownRenderer.preprocessUserDirectives(userPrompt);
assert(processed.includes('<span class="user-directive-pill slash-cmd"><span class="pill-icon">⚡</span>/discuss</span>'), '/discuss directive missing');
assert(processed.includes('class="user-directive-pill mention-file"'), 'File mention directive missing');
assert(processed.includes('51-ink-stylized-ui-design-system-and-style-guide.md'), 'File name missing');
assert(processed.includes('class="user-directive-pill mention-chat"'), 'Chat mention directive missing');
assert(processed.includes('Art Direction Ink Style Proposal'), 'Chat title missing');
assert(processed.includes('&lt;file/folder name&gt;'), '@<file/folder name> angle bracket mention missing');
assert(processed.includes('title="specs/"'), '@specs/ folder mention missing');
assert(processed.includes('title="ui_prototype.html"'), '@ui_prototype.html file title missing');
console.log('✓ preprocessUserDirectives passed!');

// 4. Test render full markdown with links and inline color codes
console.log('4. Testing MarkdownRenderer.render...');
const md = 'Màu `#38BDF8` và link [spec](file:///d:/source-code/specs/51.md) và relative [readme](README.md)';
const fullRender = MarkdownRenderer.render(md);
assert(fullRender.includes('color-chip-badge'), 'Inline code color chip missing');
assert(fullRender.includes('data-color="#38BDF8"'), 'Color code missing in chip');
assert(fullRender.includes('file-link'), 'file-link class missing on file URL');
assert(fullRender.includes('href="javascript:void(0)"'), 'File link should use href="javascript:void(0)" to prevent webview interception');
assert(fullRender.includes('data-file-url="file%3A%2F%2F%2Fd%3A%2Fsource-code%2Fspecs%2F51.md"'), 'data-file-url missing');
assert(fullRender.includes('data-filepath="README.md"'), 'Relative file link data-filepath missing');
// 5. Test MermaidSanitizer
console.log('5. Testing MermaidSanitizer...');
const { MermaidSanitizer } = require('../out/services/MermaidSanitizer');

const rawMermaidSample = `
graph TD
    D --> E{SELECT_ACTOR: Chọn Unit Chưa Hành Động}
    E -->|Hết Queue Trong Round| A2[Tăng Round Number -> Chuyển Sang ROUND_START]
    F --> G{Kiểm Tra Unit Còn Sống Sau DoT & Không Bị Stun?}
    N -->|availableAP >= 1 & Còn Quái| O{Actor Là Ai?}
    N -->|availableAP < 1 Hoặc Hết Hành Động| P[TURN_END: Đánh Dấu hasActedThisRound = true]
    D{Emergency HP Check: HP < lowHpTrigger?}
    R -->|availableAP < 1| S[END_TURN: Bấm radial-sec-endturn]
`;

const sanitized = MermaidSanitizer.sanitize(rawMermaidSample);
assert(sanitized.includes('E{"SELECT_ACTOR: Chọn Unit Chưa Hành Động"}'), 'Rhombus with colon was not quoted');
assert(sanitized.includes('A2["Tăng Round Number -> Chuyển Sang ROUND_START"]'), 'Rectangle with arrow was not quoted');
assert(sanitized.includes('G{"Kiểm Tra Unit Còn Sống Sau DoT & Không Bị Stun?"}'), 'Rhombus with question/amp was not quoted');
assert(sanitized.includes('|availableAP &gt;= 1 &amp; Còn Quái|'), 'Edge label with >= and & was not sanitized');
assert(sanitized.includes('|availableAP &lt; 1 Hoặc Hết Hành Động|'), 'Edge label with < was not sanitized');
assert(sanitized.includes('D{"Emergency HP Check: HP < lowHpTrigger?"}'), 'Rhombus with < was not quoted');
assert(sanitized.includes('|availableAP &lt; 1|'), 'Edge label with < was not sanitized');
console.log('✓ MermaidSanitizer passed!');

console.log('\nALL UNIT TESTS PASSED SUCCESSFULLY! (5/5)');
