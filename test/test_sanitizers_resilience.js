const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Target services to test
const { MermaidSanitizer } = require('../out/services/MermaidSanitizer');
const { KaTeXSanitizer } = require('../out/services/KaTeXSanitizer');
const { MarkdownRenderer } = require('../out/services/MarkdownRenderer');

console.log('=====================================================');
console.log('RUNNING ADVERSARIAL SANITIZERS RESILIENCE TEST SUITE');
console.log('=====================================================\n');

// ----------------------------------------------------
// Suite 1: Mermaid Nested Quotes & Labels with Colons/Parens
// ----------------------------------------------------
console.log('Suite 1: Testing Mermaid nested quotes and inner parens/colons protection...');
const suite1Input = `
flowchart TD
    Issue([Phát hiện lỗi nhỏ / Hotfix]) --> Quickfix["conductor-quickfix"]
    Quickfix --> Edit["Áp dụng minimal edit trực tiếp"]
    Edit --> TestRun["Chạy test suite đơn lẻ / linter"]
    TestRun -->|Thành công| Commit["Atomic Commit: fix(quickfix): ..."]
    Commit --> Ledger["Ghi nhận vào sổ cái: conductor/tracks.md\\n(Mục Hotfixes & Quick Patches)"]
    Ledger --> Finish([Xong tức thì - Không overhead])
`;
const suite1Output = MermaidSanitizer.sanitize(suite1Input);
assert(!suite1Output.includes('fix("quickfix")'), 'FAIL: Injected nested quotes into Commit label!');
assert(suite1Output.includes('Commit["Atomic Commit: fix(quickfix): ..."]'), 'FAIL: Commit node label was corrupted!');
console.log('✓ Suite 1 passed: Nested quotes prevented in double-quoted nodes.');

// ----------------------------------------------------
// Suite 2: Mermaid Compound Delimiters
// ----------------------------------------------------
console.log('Suite 2: Testing Mermaid compound delimiters (Stadium, Subroutine, Double Circle, Cylinder)...');
const suite2Input = `
flowchart TD
    S1([Stadium Node Label]) --> Sub1[[Subroutine Task Box]]
    Sub1 --> DC1(((Double Circle Final State)))
    DC1 --> Cyl1[(Cylinder Database Storage)]
`;
const suite2Output = MermaidSanitizer.sanitize(suite2Input);
assert(suite2Output.includes('S1(["Stadium Node Label"])'), `FAIL: Stadium node not properly formatted: ${suite2Output}`);
assert(suite2Output.includes('Sub1[["Subroutine Task Box"]]'), `FAIL: Subroutine node not properly formatted: ${suite2Output}`);
assert(suite2Output.includes('DC1((("Double Circle Final State")))'), `FAIL: Double Circle node not properly formatted: ${suite2Output}`);
assert(suite2Output.includes('Cyl1[("Cylinder Database Storage")]'), `FAIL: Cylinder node not properly formatted: ${suite2Output}`);
console.log('✓ Suite 2 passed: All compound delimiters preserved and formatted correctly.');

// ----------------------------------------------------
// Suite 3: KaTeX Odd/Even Backslash Parity & Deep Nesting
// ----------------------------------------------------
console.log('Suite 3: Testing KaTeX Odd/Even Backslash Parity & Deep Nesting...');
// Even backslashes before % (e.g. \\ % or \\% where \\ is newline) must escape %
const evenBackslashFormula = 'x = 10 \\\\ % formula comment or discount';
const evenSanitized = KaTeXSanitizer.sanitize(evenBackslashFormula);
assert(evenSanitized.includes('\\%'), `FAIL: Even backslash newline \\\\ % did not escape % properly: ${evenSanitized}`);

const evenDirectFormula = 'x = 10\\\\% formula';
const evenDirectSanitized = KaTeXSanitizer.sanitize(evenDirectFormula);
assert(evenDirectSanitized.includes('\\\\\\%'), `FAIL: Even backslash \\\\% did not escape % properly: ${evenDirectSanitized}`);

// Odd backslash before % (e.g. 50\%) must NOT double-escape
const oddBackslashFormula = 'Discount: 50\\%';
const oddSanitized = KaTeXSanitizer.sanitize(oddBackslashFormula);
assert(oddSanitized === 'Discount: 50\\%', `FAIL: Odd backslash \\% was unnecessarily double-escaped: ${oddSanitized}`);

// Text macro with ampersand and underscore
const textMacro = '\\text{Total Revenue & Growth_Rate}';
const textSanitized = KaTeXSanitizer.sanitize(textMacro);
assert(textSanitized.includes('\\&') && textSanitized.includes('\\_'), `FAIL: Text macro did not escape & and _: ${textSanitized}`);
console.log('✓ Suite 3 passed: Backslash parity and LaTeX text macros verified.');

// ----------------------------------------------------
// Suite 4: MarkdownRenderer Context Isolation (Inline Code & Links)
// ----------------------------------------------------
console.log('Suite 4: Testing MarkdownRenderer inline code and link context isolation...');
const inlineCodeMathInput = 'Set variables `$var1` and `$var2` in config.';
const inlineCodeMathOutput = MarkdownRenderer.preprocessMath(inlineCodeMathInput);
assert(!inlineCodeMathOutput.includes('$var1` and `$var2$'), `FAIL: Inline code variables collapsed into inline math: ${inlineCodeMathOutput}`);
assert(inlineCodeMathOutput.includes('`$var1`') && inlineCodeMathOutput.includes('`$var2`'), `FAIL: Inline code delimiters were corrupted: ${inlineCodeMathOutput}`);

const markdownLinkWithFile = '[file:///d:/repo/README.md](file:///d:/repo/README.md)';
const markdownLinkOutput = MarkdownRenderer.preprocessFileUrls(markdownLinkWithFile);
assert(!markdownLinkOutput.startsWith('[<span class="md-link-wrapper">'), `FAIL: Injected HTML wrapper into markdown link brackets: ${markdownLinkOutput}`);
console.log('✓ Suite 4 passed: Inline code and markdown links protected from regex collision.');

// ----------------------------------------------------
// Suite 5: All 5 Mermaid blocks from playbook.md
// ----------------------------------------------------
console.log('Suite 5: Testing all 5 Mermaid diagrams from conductor/playbook.md...');
const playbookPath = 'C:/Users/minhh/.gemini/config/plugins/conductor/conductor/playbook.md';
if (fs.existsSync(playbookPath)) {
  const playbookContent = fs.readFileSync(playbookPath, 'utf8');
  const blocks = playbookContent.match(/```mermaid[\s\S]*?```/g) || [];
  assert(blocks.length >= 5, `Expected at least 5 Mermaid blocks in playbook.md, found ${blocks.length}`);
  blocks.forEach((block, idx) => {
    const raw = block.replace(/```mermaid\r?\n/, '').replace(/\r?\n```/, '');
    const clean = MermaidSanitizer.sanitize(raw);
    assert(!clean.includes('fix("quickfix")'), `Block ${idx} contains nested quotes in fix(quickfix)!`);
    assert(!clean.includes('qc("Mode 1")'), `Block ${idx} contains nested quotes in qc(Mode 1)!`);
    assert(!clean.includes('Audit("Điểm'), `Block ${idx} contains nested quotes in Audit!`);
    assert(!clean.includes('Cycle("Red'), `Block ${idx} contains nested quotes in Cycle!`);
    assert(!clean.includes('Issue("[Phát hiện'), `Block ${idx} corrupted stadium Issue node!`);
    assert(!clean.includes('Finish("[Xong tức'), `Block ${idx} corrupted stadium Finish node!`);
  });
  console.log(`✓ Suite 5 passed: All ${blocks.length} diagrams from playbook.md sanitized flawlessly.`);
}

// ----------------------------------------------------
// Suite 6: Mermaid Inner Escaped Quotes (\" ) to #quot; Entity Conversion
// ----------------------------------------------------
console.log('Suite 6: Testing Mermaid inner escaped quotes (\\") conversion to #quot; entity...');
const userDiagram = `flowchart TD
    RawInput["Văn bản đầu vào thô"] --> TokenMasking["1. Token Masking Layer\\nBóc tách chuỗi nháy kép [\\"...\\"], inline code \`...\`, markdown links [...](...)\\nthành các token an toàn ___TOKEN_X___"]
    TokenMasking --> CompoundDelimiters["2. Phân cấp Compound Delimiters (Dài -> Ngắn)\\n(((...))) -> ([...]) -> [[...]] -> [(...)] -> {{...}} -> (...)"]`;

const out6 = MermaidSanitizer.sanitize(userDiagram);
assert(!out6.includes('\\"'), `FAIL: Escaped quotes \\" were not converted to #quot;: ${out6}`);
assert(out6.includes('#quot;...#quot;'), `FAIL: Expected #quot;...#quot; in output: ${out6}`);
assert(!out6.includes('links["..."]'), `FAIL: Markdown links [...](...) was corrupted: ${out6}`);
assert(out6.includes('RawInput["Văn bản đầu vào thô"]'), `FAIL: RawInput was corrupted: ${out6}`);
assert(out6.includes('CompoundDelimiters["2. Phân cấp Compound Delimiters'), `FAIL: CompoundDelimiters was corrupted: ${out6}`);
console.log('✓ Suite 6 passed: Inner escaped quotes successfully converted to #quot; and complex labels preserved.');

console.log('\n=====================================================');
console.log('ALL ADVERSARIAL SANITIZERS RESILIENCE TESTS PASSED!');
console.log('=====================================================\n');

