const assert = require('assert');
const path = require('path');
const Module = require('module');

// Mock vscode module for MarkdownRenderer if needed
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
      }
    };
  }
  return originalRequire.apply(this, arguments);
};

const { MarkdownRenderer } = require('../out/services/MarkdownRenderer');

function runTests() {
  console.log('--- Testing MarkdownRenderer with Resilient KaTeX & Heading Formatting ---');

  // Test 1: Step #78 exact error scenario
  const step78Markdown = `
Sau tinh giản: Khi bạn gọi implement:
$$\\text{implement} \\xrightarrow{\\text{auto}} \\text{QC (Mode 2: Test & Edge)} \\xrightarrow{\\text{auto}} \\text{Architect Review (Mode B DoD)}$$
Implement xong task cuối cùng.
  `.trim();

  const renderedStep78 = MarkdownRenderer.render(step78Markdown);
  console.log('1. Rendered Step 78 length:', renderedStep78.length);
  assert.ok(
    renderedStep78.includes('class="katex"'),
    'Step 78 math block must render valid KaTeX HTML'
  );
  assert.ok(
    !renderedStep78.includes('class="katex-error"'),
    'Step 78 math block must not trigger katex-error'
  );
  assert.ok(
    !renderedStep78.includes('#cc0000'),
    'Step 78 math block must not contain red error styling'
  );

  // Test 2: Corrupted LaTeX must degrade gracefully to katex-fallback
  const corruptedMarkdown = `
Math error case:
$$\\invalidMacro{unclosed{bracket$$
Done.
  `.trim();

  const renderedCorrupted = MarkdownRenderer.render(corruptedMarkdown);
  console.log('2. Rendered Corrupted math contains katex-fallback:', renderedCorrupted.includes('katex-fallback'));
  assert.ok(
    renderedCorrupted.includes('class="katex-fallback"'),
    'Corrupted LaTeX must be transformed into a clean katex-fallback badge'
  );
  assert.ok(
    !renderedCorrupted.includes('color:#cc0000'),
    'Corrupted LaTeX must not display raw red text'
  );

  // Test 3: Heading inline code formatting (user bug reported on playbook.md)
  const headingMarkdown = '#### 1. `conductor-setup` (Project Scaffolding)';
  const renderedHeading = MarkdownRenderer.render(headingMarkdown);
  console.log('3. Rendered Heading:', renderedHeading.trim());
  assert.ok(
    renderedHeading.includes('<code class="inline-code">conductor-setup</code>'),
    'Heading with backticks must render inline <code> badge'
  );
  assert.ok(
    !renderedHeading.includes('`conductor-setup`'),
    'Heading must not contain raw unparsed backticks'
  );
  assert.ok(
    renderedHeading.includes('id="1-conductor-setup-project-scaffolding"'),
    'Heading anchor ID must be preserved'
  );

  // Test 4: Heading with bold, italic, and links
  const richHeadingMarkdown = '### Step 2: **Review** *DoD* and [Docs](file:///test.md)';
  const renderedRichHeading = MarkdownRenderer.render(richHeadingMarkdown);
  console.log('4. Rendered Rich Heading:', renderedRichHeading.trim());
  assert.ok(renderedRichHeading.includes('<strong>Review</strong>'), 'Heading bold must render');
  assert.ok(renderedRichHeading.includes('<em>DoD</em>'), 'Heading italic must render');

  // Test 5: Currency disambiguation (e.g. $100 vs $O(N \log N)$)
  const currencyMarkdown = 'Ngân sách dự án là $100 cho giải thuật tối ưu $O(N \\log N)$ và nghiệm $x_1, x_2$.';
  const renderedCurrency = MarkdownRenderer.render(currencyMarkdown);
  console.log('5. Rendered Currency:', renderedCurrency.trim());
  assert.ok(renderedCurrency.includes('$100 cho giải thuật tối ưu'), 'Currency $100 must not be squished with words');
  assert.ok(!renderedCurrency.includes('100chogiảithuậttốiưu'), 'Must not create squished math text');
  assert.ok(renderedCurrency.includes('class="katex"'), 'Inline math formulas must render KaTeX');
  assert.ok(renderedCurrency.includes(' và nghiệm '), 'Must preserve Vietnamese words between formulas');

  console.log('✅ All MarkdownRenderer KaTeX & Heading tests PASSED!');
}

try {
  runTests();
} catch (err) {
  console.error('❌ Test failed:', err.message);
  process.exit(1);
}
