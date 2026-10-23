const assert = require('assert');
const path = require('path');
const katex = require('katex');

// Dynamically resolve KaTeXSanitizer from out/ (compiled) or require ts-node if needed
let KaTeXSanitizer;
try {
  KaTeXSanitizer = require('../out/services/KaTeXSanitizer').KaTeXSanitizer;
} catch (e) {
  // Expected to fail before compilation / implementation (TDD RED)
}

function runTests() {
  console.log('--- Testing KaTeXSanitizer ---');
  if (!KaTeXSanitizer) {
    throw new Error('KaTeXSanitizer not found. (TDD RED phase)');
  }

  // 1. Test unescaped '&' inside \text{...}
  const rawAmpersand = '\\text{QC (Mode 2: Test & Edge)}';
  const sanitizedAmp = KaTeXSanitizer.sanitize(rawAmpersand);
  console.log('1. Sanitized Ampersand:', sanitizedAmp);
  assert.ok(sanitizedAmp.includes('\\&'), 'Unescaped & should be escaped to \\&');
  assert.doesNotThrow(() => {
    katex.renderToString(sanitizedAmp, { throwOnError: true });
  }, 'Sanitized ampersand should render in KaTeX without throwing ParseError');

  // 2. Test already escaped '\&' inside \text{...}
  const alreadyEscapedAmp = '\\text{A \\& B}';
  const sanitizedAlreadyEscaped = KaTeXSanitizer.sanitize(alreadyEscapedAmp);
  assert.strictEqual(sanitizedAlreadyEscaped, '\\text{A \\& B}', 'Already escaped \\& must not be double escaped');

  // 3. Test unescaped '_' inside \text{...}
  const rawUnderscore = '\\text{user_id_test}';
  const sanitizedUnderscore = KaTeXSanitizer.sanitize(rawUnderscore);
  console.log('2. Sanitized Underscore:', sanitizedUnderscore);
  assert.ok(sanitizedUnderscore.includes('\\_'), 'Unescaped _ should be escaped to \\_');
  assert.doesNotThrow(() => {
    katex.renderToString(sanitizedUnderscore, { throwOnError: true });
  }, 'Sanitized underscore should render in KaTeX without throwing ParseError');

  // 4. Test unescaped '%' in math expression
  const rawPercent = '100% + x';
  const sanitizedPercent = KaTeXSanitizer.sanitize(rawPercent);
  console.log('3. Sanitized Percent:', sanitizedPercent);
  assert.ok(sanitizedPercent.includes('\\%'), 'Unescaped % should be escaped to \\%');

  // 5. Test step #78 exact error case
  const step78 = '\\text{implement} \\xrightarrow{\\text{auto}} \\text{QC (Mode 2: Test & Edge)} \\xrightarrow{\\text{auto}} \\text{Architect Review (Mode B DoD)}';
  const sanitizedStep78 = KaTeXSanitizer.sanitize(step78);
  console.log('4. Sanitized Step #78:', sanitizedStep78);
  assert.doesNotThrow(() => {
    const rendered = katex.renderToString(sanitizedStep78, { throwOnError: true });
    assert.ok(rendered.includes('katex'), 'KaTeX output should contain valid math HTML');
  }, 'Step #78 string must render cleanly after sanitization');

  // 6. Test stripToCleanText
  const cleanText = KaTeXSanitizer.stripToCleanText(step78);
  console.log('5. Stripped Clean Text:', cleanText);
  assert.ok(cleanText.includes('implement'), 'Clean text should include implement');
  assert.ok(cleanText.includes('──(auto)──>'), 'Clean text should convert xrightarrow to readable arrow');
  assert.ok(cleanText.includes('QC (Mode 2: Test & Edge)'), 'Clean text should preserve inner text cleanly');

  // 7. Test renderMathSafely with corrupted syntax
  const corrupted = '\\invalidMacro{unclosed{bracket';
  const safeOutput = KaTeXSanitizer.renderMathSafely(corrupted, false);
  console.log('6. Corrupted Fallback Output:', safeOutput);
  assert.ok(safeOutput.includes('katex-fallback'), 'Corrupted math must return katex-fallback');
  assert.ok(!safeOutput.includes('color:#cc0000'), 'Must not contain raw red error style');

  console.log('✅ All KaTeXSanitizer unit tests PASSED!');
}

try {
  runTests();
} catch (err) {
  console.error('❌ Test failed:', err.message);
  process.exit(1);
}
