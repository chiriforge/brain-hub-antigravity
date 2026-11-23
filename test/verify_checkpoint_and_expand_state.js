const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

// Mock vscode module before requiring compiled panels/services
const Module = require('module');
const origRequire = Module.prototype.require;
Module.prototype.require = function (request) {
  if (request === 'vscode') {
    return {
      workspace: {
        getConfiguration: () => ({ get: (k, d) => d }),
        workspaceFolders: [{ uri: { fsPath: path.resolve(__dirname, '..') }, name: 'brain-hub-antigravity' }]
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

const { MarkdownRenderer } = require('../out/services/MarkdownRenderer');
const { DashboardWebviewPanel } = require('../out/views/DashboardWebviewPanel');
const { ChatWebviewPanel } = require('../out/views/ChatWebviewPanel');

/**
 * Minimal lightweight DOM tree parser/simulator sufficient to run webview update scripts
 * and assert classList, attributes, details.open, and querySelectorAll behavior.
 */
class SimClassList {
  constructor(el) {
    this.el = el;
  }
  _getSet() {
    const raw = this.el.getAttribute('class') || '';
    return new Set(raw.split(/\s+/).filter(Boolean));
  }
  _saveSet(set) {
    this.el.setAttribute('class', Array.from(set).join(' '));
  }
  add(...names) {
    const s = this._getSet();
    names.forEach(n => s.add(n));
    this._saveSet(s);
  }
  remove(...names) {
    const s = this._getSet();
    names.forEach(n => s.delete(n));
    this._saveSet(s);
  }
  toggle(name, force) {
    const s = this._getSet();
    const shouldAdd = force !== undefined ? !!force : !s.has(name);
    if (shouldAdd) s.add(name);
    else s.delete(name);
    this._saveSet(s);
    return shouldAdd;
  }
  contains(name) {
    return this._getSet().has(name);
  }
}

class SimElement {
  constructor(tagName, attrs = {}) {
    this.tagName = tagName.toUpperCase();
    this.nodeType = 1;
    this.attrs = { ...attrs };
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this.value = '';
    this.scrollTop = 0;
    this.scrollHeight = 100;
    this.clientHeight = 100;
    this.dataset = {};
    this.classList = new SimClassList(this);
  }
  get id() { return this.attrs.id || ''; }
  set id(v) { this.attrs.id = String(v); }
  get open() { return Object.prototype.hasOwnProperty.call(this.attrs, 'open'); }
  set open(v) {
    if (v) this.attrs.open = '';
    else delete this.attrs.open;
  }
  get title() { return this.attrs.title || ''; }
  set title(v) { this.attrs.title = String(v); }
  getAttribute(name) {
    if (name === 'open') return this.open ? '' : null;
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
  }
  setAttribute(name, val) {
    this.attrs[name] = String(val);
    if (name.startsWith('data-')) {
      const camel = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      this.dataset[camel] = String(val);
    }
  }
  removeAttribute(name) {
    delete this.attrs[name];
  }
  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  _serializeAttrs() {
    return Object.entries(this.attrs)
      .map(([k, v]) => (v === '' && k === 'open') ? 'open' : `${k}="${v.replace(/"/g, '&quot;')}"`)
      .join(' ');
  }
  get innerHTML() {
    if (this._rawInnerHtml !== undefined) return this._rawInnerHtml;
    return this.children.map(ch => {
      const a = ch._serializeAttrs();
      const openTag = a ? `<${ch.tagName.toLowerCase()} ${a}>` : `<${ch.tagName.toLowerCase()}>`;
      return `${openTag}${ch.innerHTML}</${ch.tagName.toLowerCase()}>`;
    }).join('');
  }
  set innerHTML(html) {
    this._rawInnerHtml = undefined;
    this.children = [];
    const parsed = parseHtmlFragment(html);
    parsed.forEach(ch => this.appendChild(ch));
  }
  get outerHTML() {
    return this._rawOuterHtml || '';
  }
  set outerHTML(html) {
    this._rawOuterHtml = html;
  }
  contains(node) {
    if (!node) return false;
    let cur = node;
    while (cur) {
      if (cur === this) return true;
      cur = cur.parentNode;
    }
    return false;
  }
  closest(sel) {
    let cur = this;
    while (cur) {
      if (matchesSimpleSelector(cur, sel)) return cur;
      cur = cur.parentNode;
    }
    return null;
  }
  querySelectorAll(selector) {
    const parts = selector.split(',').map(s => s.trim()).filter(Boolean);
    const out = [];
    const walk = (node) => {
      for (const ch of node.children) {
        if (parts.some(p => matchesSelectorChain(ch, p, this))) {
          out.push(ch);
        }
        walk(ch);
      }
    };
    walk(this);
    return out;
  }
  querySelector(selector) {
    const res = this.querySelectorAll(selector);
    return res.length > 0 ? res[0] : null;
  }
  addEventListener() {}
  removeEventListener() {}
  scrollIntoView() {}
  scrollTo() {}
  focus() {}
  select() {}
}

function matchesSimpleSelector(el, sel) {
  if (!el || el.nodeType !== 1) return false;
  let rem = sel.trim();
  if (!rem) return false;

  const hasOpenAttr = rem.includes('[open]');
  rem = rem.replace(/\[open\]/g, '');
  const hasNotOpen = rem.includes(':not([open])');
  rem = rem.replace(/:not\(\[open\]\)/g, '');

  if (hasOpenAttr && !el.open) return false;
  if (hasNotOpen && el.open) return false;

  const idMatch = rem.match(/#([a-zA-Z0-9_-]+)/);
  if (idMatch) {
    if (el.id !== idMatch[1]) return false;
    rem = rem.replace(idMatch[0], '');
  }

  const classMatches = [...rem.matchAll(/\.([a-zA-Z0-9_-]+)/g)].map(m => m[1]);
  rem = rem.replace(/\.[a-zA-Z0-9_-]+/g, '');
  for (const cls of classMatches) {
    if (!el.classList.contains(cls)) return false;
  }

  const tag = rem.trim();
  if (tag && el.tagName.toLowerCase() !== tag.toLowerCase()) {
    return false;
  }
  return true;
}

function matchesSelectorChain(el, chain, scopeRoot) {
  const tokens = chain.trim().split(/\s+/);
  if (tokens.length === 1) {
    return matchesSimpleSelector(el, tokens[0]);
  }
  if (!matchesSimpleSelector(el, tokens[tokens.length - 1])) {
    return false;
  }
  let idx = tokens.length - 2;
  let cur = el.parentNode;
  while (cur && idx >= 0) {
    if (matchesSimpleSelector(cur, tokens[idx])) {
      idx--;
    }
    if (cur === scopeRoot) break;
    cur = cur.parentNode;
  }
  return idx < 0;
}

function parseAttributes(attrStr) {
  const attrs = {};
  const re = /([a-zA-Z0-9_-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m;
  while ((m = re.exec(attrStr)) !== null) {
    attrs[m[1]] = m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : (m[4] !== undefined ? m[4] : ''));
  }
  return attrs;
}

function parseHtmlFragment(html) {
  const root = new SimElement('root');
  const stack = [root];
  const voidTags = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'path', 'svg']);
  const tagRe = /<\/?([a-zA-Z0-9-]+)([^>]*)>/g;
  let m;
  while ((m = tagRe.exec(html)) !== null) {
    const full = m[0];
    const tag = m[1].toLowerCase();
    const isClosing = full.startsWith('</');
    const isSelfClosing = full.endsWith('/>') || voidTags.has(tag);

    if (isClosing) {
      for (let i = stack.length - 1; i >= 1; i--) {
        if (stack[i].tagName.toLowerCase() === tag) {
          stack.length = i;
          break;
        }
      }
    } else {
      const attrs = parseAttributes(m[2] || '');
      const el = new SimElement(tag, attrs);
      stack[stack.length - 1].appendChild(el);
      if (!isSelfClosing) {
        stack.push(el);
      }
    }
  }
  return root.children;
}

function createInteractiveSimContext(initialBodyHtml) {
  const body = new SimElement('body');
  body.innerHTML = initialBodyHtml;

  const listeners = { window: {}, document: {} };

  const doc = {
    body,
    documentElement: { scrollTop: 0, scrollHeight: 100 },
    addEventListener: (type, fn) => {
      listeners.document[type] = listeners.document[type] || [];
      listeners.document[type].push(fn);
    },
    removeEventListener: () => {},
    getElementById: (id) => {
      const walk = (node) => {
        for (const ch of node.children) {
          if (ch.id === id) return ch;
          const found = walk(ch);
          if (found) return found;
        }
        return null;
      };
      return walk(body);
    },
    querySelector: (sel) => body.querySelector(sel),
    querySelectorAll: (sel) => body.querySelectorAll(sel),
    createElement: (tag) => new SimElement(tag)
  };

  function stripTagBlock(html, tagName) {
    const openPrefix = `<${tagName}`;
    const closeTag = `</${tagName}`;
    let out = String(html || '');
    let searchFrom = 0;
    while (true) {
      const lower = out.toLowerCase();
      const start = lower.indexOf(openPrefix, searchFrom);
      if (start === -1) break;
      const nextCh = lower[start + openPrefix.length];
      if (nextCh && nextCh !== '>' && !/\s/.test(nextCh)) {
        searchFrom = start + openPrefix.length;
        continue;
      }
      const closeStart = lower.indexOf(closeTag, start);
      if (closeStart === -1) {
        out = out.slice(0, start);
        break;
      }
      const closeEnd = lower.indexOf('>', closeStart);
      if (closeEnd === -1) {
        out = out.slice(0, start);
        break;
      }
      out = out.slice(0, start) + out.slice(closeEnd + 1);
      searchFrom = 0;
    }
    return out;
  }

  class SimDOMParser {
    parseFromString(htmlStr) {
      const sanitizedHtml = stripTagBlock(stripTagBlock(htmlStr || '', 'script'), 'style');
      const parsedDocRoot = new SimElement('html');
      parsedDocRoot.innerHTML = sanitizedHtml;
      return {
        getElementById: (id) => {
          const walk = (node) => {
            for (const ch of node.children) {
              if (ch.id === id) return ch;
              const found = walk(ch);
              if (found) return found;
            }
            return null;
          };
          return walk(parsedDocRoot);
        },
        querySelector: (sel) => parsedDocRoot.querySelector(sel),
        querySelectorAll: (sel) => parsedDocRoot.querySelectorAll(sel)
      };
    }
  }

  const sandbox = {
    console,
    setTimeout: () => {},
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
    DOMParser: SimDOMParser,
    acquireVsCodeApi: () => ({ postMessage: () => {}, getState: () => ({}), setState: () => {} }),
    window: {
      scrollY: 0,
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
    document: doc,
    navigator: { clipboard: { writeText: async () => {}, write: async () => {} } },
    IntersectionObserver: class { observe() {} disconnect() {} },
    Image: class { constructor() { this.width = 100; this.height = 100; } }
  };
  sandbox.window.document = doc;
  sandbox.window.window = sandbox.window;
  return { context: vm.createContext(sandbox), listeners, doc };
}

function extractScriptBlocks(html) {
  const blocks = [];
  const src = String(html || '');
  const lower = src.toLowerCase();
  let pos = 0;
  while (pos < src.length) {
    const start = lower.indexOf('<script', pos);
    if (start === -1) break;
    const nextCh = lower[start + 7];
    if (nextCh && nextCh !== '>' && !/\s/.test(nextCh)) {
      pos = start + 7;
      continue;
    }
    const openEnd = src.indexOf('>', start);
    if (openEnd === -1) break;
    const closeStart = lower.indexOf('</script', openEnd + 1);
    if (closeStart === -1) break;
    const closeEnd = src.indexOf('>', closeStart);
    if (closeEnd === -1) break;
    blocks.push(src.slice(openEnd + 1, closeStart));
    pos = closeEnd + 1;
  }
  return blocks;
}

function runScriptsInSim(fullHtml, bodyHtml) {
  const { context, listeners, doc } = createInteractiveSimContext(bodyHtml);
  for (const code of extractScriptBlocks(fullHtml)) {
    if (!code.trim()) continue;
    const script = new vm.Script(code);
    script.runInContext(context);
  }
  if (listeners.document.DOMContentLoaded) {
    listeners.document.DOMContentLoaded.forEach(fn => fn());
  }
  return { context, listeners, doc };
}

function testCheckpointMarkdownAndCss() {
  console.log('--- 1. Testing Checkpoint <summary> sanitization & CSS child combinators ---');

  const checkpointMarkdown = [
    '# Resuming from a compaction',
    '',
    'You are continuing work on the task described above:',
    '',
    '# User Requests',
    '1. /compact',
    '',
    '<summary>',
    'RESUMING MY OWN TASK IN PROGRESS.',
    '',
    '## 1. Task Overview',
    '- **Goal:** Fix UI rendering bug',
    '',
    '## 8. Next Steps',
    '1. Verify tests pass.',
    '</summary>',
    '',
    '# Conversation Logs',
    'Start with the compact transcript.'
  ].join('\n');

  const renderedCheckpoint = MarkdownRenderer.render(checkpointMarkdown);
  assert(!/<summary\b/i.test(renderedCheckpoint), 'Unpaired <summary> must NOT appear as raw <summary> tag in rendered checkpoint HTML');
  assert(!/<\/summary>/i.test(renderedCheckpoint), 'Unpaired </summary> must NOT appear as raw </summary> tag in rendered checkpoint HTML');
  assert(renderedCheckpoint.includes('class="markdown-summary-block"'), 'Unpaired <summary> must be wrapped in .markdown-summary-block');
  assert(renderedCheckpoint.includes('<h2 id="1-task-overview">1. Task Overview</h2>'), 'Inner headings inside compaction summary must render as <h2>');
  assert(renderedCheckpoint.includes('<h2 id="8-next-steps">8. Next Steps</h2>'), 'Trailing headings inside compaction summary must render as <h2>');
  assert(renderedCheckpoint.includes('RESUMING MY OWN TASK IN PROGRESS.'), 'First line inside <summary> must remain visible');

  // Valid <details><summary>...</summary>...</details> must stay intact
  const validDetailsMd = '<details>\n<summary>Click to expand</summary>\n\nInner markdown **bold**\n\n</details>';
  const renderedDetails = MarkdownRenderer.render(validDetailsMd);
  assert(/<details\b/i.test(renderedDetails) && /<summary>Click to expand<\/summary>/i.test(renderedDetails), 'Explicit <details><summary>...</summary></details> must remain intact');

  // Inline code and fenced code blocks containing <summary> must NOT be transformed
  const codeSummaryMd = 'Inline `<summary>` tag.\n\n```html\n<summary>\nTest\n</summary>\n```';
  const renderedCode = MarkdownRenderer.render(codeSummaryMd);
  assert(!renderedCode.includes('markdown-summary-block'), 'Code examples with <summary> must NOT be converted to .markdown-summary-block');

  // CSS child combinators check in both panels
  const dashSrc = fs.readFileSync(path.resolve(__dirname, '../src/views/DashboardWebviewPanel.ts'), 'utf8');
  const chatSrc = fs.readFileSync(path.resolve(__dirname, '../src/views/ChatWebviewPanel.ts'), 'utf8');

  assert(dashSrc.includes('details.autonomous-group-details > summary'), 'Dashboard CSS must use > summary for autonomous-group-details');
  assert(dashSrc.includes('details.internal-step-details > summary'), 'Dashboard CSS must use > summary for internal-step-details');
  assert(dashSrc.includes('details.chat-details > summary'), 'Dashboard CSS must use > summary for chat-details');
  assert(!/details\.autonomous-group-details(?:\[open\])?\s+summary\s*\{/.test(dashSrc), 'Dashboard CSS must NOT use descendant selector on autonomous-group-details summary');
  assert(!/details\.internal-step-details(?:\[open\])?\s+summary\s*\{/.test(dashSrc), 'Dashboard CSS must NOT use descendant selector on internal-step-details summary');

  assert(chatSrc.includes('details.autonomous-group-details > summary'), 'Chat CSS must use > summary for autonomous-group-details');
  assert(chatSrc.includes('details.chat-details > summary'), 'Chat CSS must use > summary for chat-details');
  assert(!/details\.autonomous-group-details(?:\[open\])?\s+summary\s*\{/.test(chatSrc), 'Chat CSS must NOT use descendant selector on autonomous-group-details summary');

  // End-to-end Checkpoint #122 render through DashboardWebviewPanel & ChatWebviewPanel
  const checkpointMsg = {
    index: 122,
    type: 'CHECKPOINT',
    source: 'SYSTEM',
    content: checkpointMarkdown,
    createdAt: new Date()
  };
  const dashCheckpointHtml = DashboardWebviewPanel.prototype.renderMessageItem.call(
    DashboardWebviewPanel.prototype,
    { type: 'autonomous_group', group: [checkpointMsg] },
    false,
    true
  );
  const dashCheckpointBody = dashCheckpointHtml.slice(dashCheckpointHtml.indexOf('class="checkpoint-body"'));
  assert(!/<summary\b/i.test(dashCheckpointBody), 'Rendered Checkpoint body in Dashboard must contain zero raw <summary> tags');
  assert(dashCheckpointBody.includes('class="markdown-summary-block"'), 'Rendered Checkpoint body in Dashboard must contain .markdown-summary-block');
  assert(dashCheckpointBody.includes('1. Task Overview'), 'Rendered Checkpoint body in Dashboard must expose inner headings');

  const chatCheckpointHtml = ChatWebviewPanel.prototype.renderMessageItem.call(
    ChatWebviewPanel.prototype,
    { type: 'autonomous_group', group: [checkpointMsg] },
    false,
    true
  );
  const chatCheckpointBody = chatCheckpointHtml.slice(chatCheckpointHtml.indexOf('class="checkpoint-body"'));
  assert(!/<summary\b/i.test(chatCheckpointBody), 'Rendered Checkpoint body in Chat must contain zero raw <summary> tags');
  assert(chatCheckpointBody.includes('class="markdown-summary-block"'), 'Rendered Checkpoint body in Chat must contain .markdown-summary-block');

  console.log('✓ Checkpoint <summary> sanitization and CSS child combinators verified');
}

function buildSampleMessages(lastIndex) {
  const msgs = [
    { index: 1, userIndex: 1, type: 'USER_INPUT', source: 'USER_EXPLICIT', content: 'Start task', cleanContent: 'Start task', createdAt: new Date() }
  ];
  for (let i = 120; i <= lastIndex; i++) {
    msgs.push({
      index: i,
      type: 'PLANNER_RESPONSE',
      source: 'MODEL',
      content: '',
      cleanContent: '',
      thinking: `Thinking for step ${i}`,
      toolCalls: [{ name: 'run_command', args: { cmd: `echo ${i}` }, output: `ok ${i}`, status: 'DONE', exitCode: 0 }],
      createdAt: new Date()
    });
  }
  return msgs;
}

function testDashboardAndChatExpandPersistence() {
  console.log('--- 2. Testing Expand AI Steps, Expand Tools & growing group persistence ---');

  const sampleSession = {
    id: 'session-live-1',
    title: 'Live Session',
    path: path.resolve(__dirname, '..'),
    createdAt: new Date(),
    lastModified: new Date(),
    messageCount: 1,
    userPromptCount: 1
  };
  const secondSession = {
    ...sampleSession,
    id: 'session-other-2',
    title: 'Other Session'
  };

  // --- Dashboard Webview Simulation ---
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

  const msgsInitial = buildSampleMessages(122);
  const fullDashHtml = dashProto.generateDashboardHtml.call(dummyDash, [sampleSession, secondSession], sampleSession, msgsInitial, [sampleSession], undefined, true);
  const readerHtmlInitial = dashProto.generateReaderHtml.call(dummyDash, sampleSession, msgsInitial, [sampleSession], undefined, false);

  assert(readerHtmlInitial.includes('data-group-start="120"'), 'Dashboard group must emit data-group-start="120"');
  assert(readerHtmlInitial.includes('data-detail-key="step-120-thinking"'), 'Dashboard thinking detail must emit stable data-detail-key');
  assert(readerHtmlInitial.includes('data-detail-key="step-120-tool-0"'), 'Dashboard tool detail must emit stable data-detail-key');

  const bodyMatch = fullDashHtml.match(/<body[^>]*>([\s\S]*?)<script/i);
  assert(bodyMatch, 'Dashboard HTML must contain body before script');
  const { context: dashCtx, listeners: dashListeners, doc: dashDoc } = runScriptsInSim(fullDashHtml, bodyMatch[1]);

  // Case A: Toggle Expand AI Steps -> live update arrives with extra step 123 and second group 130..131
  dashCtx.toggleInternalSteps();
  assert(dashDoc.getElementById('internalToggleBtn').classList.contains('active'), 'internalToggleBtn must be active after click');

  const msgsUpdated = [
    ...buildSampleMessages(123),
    { index: 129, userIndex: 2, type: 'USER_INPUT', source: 'USER_EXPLICIT', content: 'Next prompt', cleanContent: 'Next prompt', createdAt: new Date() },
    { index: 130, type: 'PLANNER_RESPONSE', source: 'MODEL', content: '', cleanContent: '', thinking: 'Step 130 thinking', createdAt: new Date() }
  ];
  const readerHtmlUpdated = dashProto.generateReaderHtml.call(dummyDash, sampleSession, msgsUpdated, [sampleSession], undefined, false);

  dashListeners.window.message.forEach(fn => fn({
    data: {
      command: 'updateReader',
      sessionId: sampleSession.id,
      chatHtml: readerHtmlUpdated,
      isLiveUpdate: true,
      messageOrder: 'newestFirst'
    }
  }));

  assert(dashDoc.getElementById('internalToggleBtn').classList.contains('active'), 'internalToggleBtn must REMAIN active after live update');
  const groupsAfterUpdate = dashDoc.querySelectorAll('details.autonomous-group-details');
  assert(groupsAfterUpdate.length === 2, 'Expected 2 autonomous groups after update');
  assert(groupsAfterUpdate.every(g => g.open === true), 'All autonomous groups (existing + new) must remain expanded when aiStepsExpanded is true');
  const innerStepsAfterUpdate = dashDoc.querySelectorAll('details.internal-step-details');
  assert(innerStepsAfterUpdate.length > 0 && innerStepsAfterUpdate.every(s => s.open === true), 'All internal-step-details must remain expanded when aiStepsExpanded is true');

  // Case B: While aiStepsExpanded is true, user manually closes group 130 -> live update must keep group 130 closed while group 120 stays open
  const group130 = groupsAfterUpdate.find(g => g.getAttribute('data-group-start') === '130');
  assert(group130, 'Group 130 must exist');
  group130.open = false;

  const msgsUpdated2 = [
    ...msgsUpdated,
    { index: 131, type: 'PLANNER_RESPONSE', source: 'MODEL', content: '', cleanContent: '', thinking: 'Step 131 thinking', createdAt: new Date() }
  ];
  const readerHtmlUpdated2 = dashProto.generateReaderHtml.call(dummyDash, sampleSession, msgsUpdated2, [sampleSession], undefined, false);
  dashListeners.window.message.forEach(fn => fn({
    data: {
      command: 'updateReader',
      sessionId: sampleSession.id,
      chatHtml: readerHtmlUpdated2,
      isLiveUpdate: true,
      messageOrder: 'newestFirst'
    }
  }));

  const group130After = dashDoc.querySelectorAll('details.autonomous-group-details').find(g => g.getAttribute('data-group-start') === '130');
  const group120After = dashDoc.querySelectorAll('details.autonomous-group-details').find(g => g.getAttribute('data-group-start') === '120');
  assert(group130After && group130After.open === false, 'Manually collapsed group 130 must stay collapsed across live update');
  assert(group120After && group120After.open === true, 'Group 120 must remain expanded across live update');

  // Case C: Toggle Expand AI Steps OFF, then manually open group 120 (120-123) and step-120-thinking, then grow group to 120-124
  dashCtx.toggleInternalSteps();
  assert(!dashDoc.getElementById('internalToggleBtn').classList.contains('active'), 'internalToggleBtn must be inactive when toggled off');
  const grp120Manual = dashDoc.querySelectorAll('details.autonomous-group-details').find(g => g.getAttribute('data-group-start') === '120');
  grp120Manual.open = true;
  const thinking120Manual = dashDoc.querySelectorAll('details.chat-details').find(d => d.getAttribute('data-detail-key') === 'step-120-thinking');
  assert(thinking120Manual, 'step-120-thinking detail must exist');
  thinking120Manual.open = true;

  const msgsGrown = [
    ...buildSampleMessages(124),
    { index: 129, userIndex: 2, type: 'USER_INPUT', source: 'USER_EXPLICIT', content: 'Next prompt', cleanContent: 'Next prompt', createdAt: new Date() },
    { index: 130, type: 'PLANNER_RESPONSE', source: 'MODEL', content: '', cleanContent: '', thinking: 'Step 130 thinking', createdAt: new Date() }
  ];
  const readerHtmlGrown = dashProto.generateReaderHtml.call(dummyDash, sampleSession, msgsGrown, [sampleSession], undefined, false);
  dashListeners.window.message.forEach(fn => fn({
    data: {
      command: 'updateReader',
      sessionId: sampleSession.id,
      chatHtml: readerHtmlGrown,
      isLiveUpdate: true,
      messageOrder: 'newestFirst'
    }
  }));

  const grp120Grown = dashDoc.querySelectorAll('details.autonomous-group-details').find(g => g.getAttribute('data-group-start') === '120');
  const thinking120Grown = dashDoc.querySelectorAll('details.chat-details').find(d => d.getAttribute('data-detail-key') === 'step-120-thinking');
  assert(grp120Grown.getAttribute('data-step') === '120-124', 'Group range must have grown to 120-124');
  assert(grp120Grown.open === true, 'Individually opened group 120 must stay open even after data-step grows from 120-123 to 120-124');
  assert(thinking120Grown.open === true, 'Individually opened chat-details must stay open via data-detail-key');

  // Case D: Toggle Expand Tools ON -> live update keeps toolsToggleBtn active and chat-details open
  dashCtx.toggleAllTools();
  assert(dashDoc.getElementById('toolsToggleBtn').classList.contains('active'), 'toolsToggleBtn must be active after click');
  dashListeners.window.message.forEach(fn => fn({
    data: {
      command: 'updateReader',
      sessionId: sampleSession.id,
      chatHtml: readerHtmlGrown,
      isLiveUpdate: true,
      messageOrder: 'newestFirst'
    }
  }));
  assert(dashDoc.getElementById('toolsToggleBtn').classList.contains('active'), 'toolsToggleBtn must remain active after live update');
  const allChatDetails = dashDoc.querySelectorAll('#chatTimeline details.chat-details');
  assert(allChatDetails.length > 0 && allChatDetails.every(d => d.open === true), 'All chat-details must stay open when toolsExpanded is true');

  // Case E: Switching to a different session resets toggle buttons to the new session's default state
  const otherSessionReader = dashProto.generateReaderHtml.call(dummyDash, secondSession, msgsInitial, [secondSession], undefined, false);
  dashListeners.window.message.forEach(fn => fn({
    data: {
      command: 'updateReader',
      sessionId: secondSession.id,
      chatHtml: otherSessionReader,
      isLiveUpdate: false,
      messageOrder: 'newestFirst'
    }
  }));
  assert(!dashDoc.getElementById('internalToggleBtn').classList.contains('active'), 'Switching sessions must reset internalToggleBtn to server default');
  assert(!dashDoc.getElementById('toolsToggleBtn').classList.contains('active'), 'Switching sessions must reset toolsToggleBtn to server default');

  // --- ChatWebviewPanel Simulation ---
  const chatProto = ChatWebviewPanel.prototype;
  const dummyChat = {
    currentSession: sampleSession,
    isShowingCombinedThread: false,
    groupMessages: chatProto.groupMessages,
    renderMessageItem: chatProto.renderMessageItem,
    renderSingleAutonomousStep: chatProto.renderSingleAutonomousStep,
    renderMessage: chatProto.renderMessage,
    renderUserMessage: chatProto.renderUserMessage,
    renderAiMessage: chatProto.renderAiMessage,
    renderToolCall: chatProto.renderToolCall,
    extensionUri: { fsPath: path.resolve(__dirname, '..') },
    panel: { webview: { asWebviewUri: (u) => u } }
  };

  const fullChatHtml = chatProto.generateHtml.call(dummyChat, sampleSession, msgsInitial, [sampleSession], true);
  assert(fullChatHtml.includes('data-group-start="120"'), 'Chat HTML must emit data-group-start="120"');
  assert(fullChatHtml.includes('data-detail-key="step-120-thinking"'), 'Chat HTML must emit data-detail-key="step-120-thinking"');

  const chatBodyMatch = fullChatHtml.match(/<body[^>]*>([\s\S]*?)<script/i);
  assert(chatBodyMatch, 'Chat HTML must contain body before script');
  const { context: chatCtx, listeners: chatListeners, doc: chatDoc } = runScriptsInSim(fullChatHtml, chatBodyMatch[1]);

  chatCtx.toggleInternalSteps();
  assert(chatDoc.getElementById('internalToggleBtn').classList.contains('active'), 'Chat internalToggleBtn must be active');

  const updatedChatHtml = chatProto.generateHtml.call(dummyChat, sampleSession, msgsUpdated, [sampleSession], true);
  chatListeners.window.message.forEach(fn => fn({
    data: {
      command: 'updateChatContent',
      html: updatedChatHtml,
      isLiveUpdate: true,
      messageOrder: 'newestFirst'
    }
  }));

  const chatGroupsAfter = chatDoc.querySelectorAll('details.autonomous-group-details');
  assert(chatGroupsAfter.length === 2 && chatGroupsAfter.every(g => g.open === true), 'Chat autonomous groups must stay expanded after live update when aiStepsExpanded is true');

  console.log('✓ Expand AI Steps, Expand Tools & growing group persistence verified');
}

testCheckpointMarkdownAndCss();
testDashboardAndChatExpandPersistence();
console.log('\n🎉 ALL CHECKPOINT & EXPAND-STATE TESTS PASSED!');
