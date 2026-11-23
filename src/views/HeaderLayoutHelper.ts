import { TokenUsageSummary } from '../models/types';
import { MarkdownRenderer } from '../services/MarkdownRenderer';
import { TokenThresholdConfig, TokenUsageMonitor } from '../services/TokenUsageMonitor';

export interface HeaderMetaRenderParams {
  isLive: boolean;
  isThread: boolean;
  userPromptTotal: number;
  maxStepIndex: number;
  totalArtifacts: number;
  hasArtifacts: boolean;
  shortTimeStr: string;
  fullTimeStr: string;
  workspaceName?: string;
  workspacePath?: string;
  machineName?: string;
  sessionId: string;
  planPath?: string;
  walkthroughPath?: string;
}

export interface CollapsedStripRenderParams {
  isLive: boolean;
  isThread?: boolean;
  userPromptTotal?: number;
  totalArtifacts: number;
  hasArtifacts: boolean;
  lastModified?: Date;
  maxStepIndex: number;
  tokenUsage?: TokenUsageSummary;
  thresholds?: Partial<TokenThresholdConfig>;
}

/**
 * Shared compact header layout, naked VS Code styling, >> overflow popover,
 * and persistent collapse/expand helpers for Dashboard and Chat webviews.
 */
export class HeaderLayoutHelper {
  public static formatShortLastMessageTime(lastModified?: Date): string {
    if (!lastModified || Number.isNaN(lastModified.getTime())) {
      return '';
    }
    const now = new Date();
    const isToday =
      lastModified.getFullYear() === now.getFullYear() &&
      lastModified.getMonth() === now.getMonth() &&
      lastModified.getDate() === now.getDate();
    const timeStr = lastModified.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    if (isToday) {
      return timeStr;
    }
    const dateStr = lastModified.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric'
    });
    return `${dateStr} ${timeStr}`;
  }

  public static getSharedHeaderCss(): string {
    return `
      .reader-title-row,
      .session-title-row {
        display: flex;
        align-items: center;
        gap: 6px;
        width: 100%;
        min-width: 0;
      }

      .reader-title,
      .session-title {
        flex: 1 1 auto;
        min-width: 0;
        font-size: var(--vscode-font-size, 13px) !important;
        font-weight: 600;
        line-height: 1.35;
        white-space: nowrap !important;
        overflow: hidden;
        text-overflow: ellipsis;
        display: block !important;
        margin: 0;
      }

      .naked-btn,
      .reader-combined-toolbar .action-btn,
      .header-combined-toolbar .action-btn,
      .dashboard-top-actions .action-btn,
      .header-left-section .action-btn {
        background: transparent;
        border: none;
        box-shadow: none;
        padding: 2px 5px;
        border-radius: 3px;
        font-size: var(--vscode-font-size, 13px);
        line-height: 1.2;
      }

      .naked-btn:hover,
      .reader-combined-toolbar .action-btn:hover,
      .header-combined-toolbar .action-btn:hover,
      .dashboard-top-actions .action-btn:hover,
      .header-left-section .action-btn:hover {
        background: var(--btn-hover);
      }

      .reader-combined-toolbar .action-btn.primary,
      .header-combined-toolbar .action-btn.primary,
      .dashboard-top-actions .action-btn.primary {
        background: transparent;
        color: var(--accent-blue, #3794ff);
      }

      .reader-combined-toolbar .action-btn.primary:hover,
      .header-combined-toolbar .action-btn.primary:hover,
      .dashboard-top-actions .action-btn.primary:hover {
        background: var(--btn-hover);
      }

      .reader-combined-toolbar .action-btn.active,
      .header-combined-toolbar .action-btn.active {
        background: var(--btn-hover);
        outline: 1px solid var(--border-color);
      }

      .header-left-section .action-btn.active {
        background: transparent;
        outline: none;
        color: var(--text-secondary);
      }

      .header-left-section .action-btn.active:hover {
        background: var(--btn-hover);
        color: var(--text-primary);
      }

      .header-collapse-toggle {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        color: var(--text-secondary);
        padding: 2px 4px;
      }

      .header-meta {
        display: flex !important;
        align-items: center;
        gap: 8px;
        flex-wrap: nowrap !important;
        overflow: hidden;
        font-size: var(--vscode-font-size, 13px) !important;
        min-height: 20px;
        max-height: 26px !important;
        margin-top: 0 !important;
      }

      .header-meta .meta-badge,
      .naked-meta-btn {
        background: transparent !important;
        border: none !important;
        padding: 0 !important;
        border-radius: 0 !important;
        gap: 0 !important;
        font-size: var(--vscode-font-size, 13px) !important;
        font-family: var(--vscode-font-family, inherit) !important;
        white-space: nowrap;
        flex-shrink: 0;
        display: inline-flex;
        align-items: center;
        color: var(--text-secondary);
      }

      .naked-meta-btn {
        cursor: pointer;
      }

      .naked-meta-btn:hover,
      .header-meta .meta-badge[onclick]:hover {
        color: var(--text-primary);
        text-decoration: underline;
      }

      .header-meta .live-badge {
        background: transparent !important;
        border: none !important;
        padding: 0 !important;
      }

      .overflow-hidden-item {
        display: none !important;
      }

      .overflow-more-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        margin-left: auto;
        color: var(--text-secondary);
        padding: 2px 4px;
      }

      .header-overflow-popover {
        position: fixed;
        z-index: 9999;
        background: var(--bg-secondary, #252526);
        border: 1px solid var(--border-color, #454545);
        border-radius: 4px;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
        padding: 4px;
        display: none;
        flex-direction: column;
        gap: 2px;
        min-width: 150px;
        max-width: 320px;
        font-size: var(--vscode-font-size, 13px);
      }

      .header-overflow-popover.open {
        display: flex;
      }

      .header-overflow-popover-item {
        display: flex;
        align-items: center;
        gap: 6px;
        width: 100%;
        text-align: left;
        background: transparent;
        border: none;
        color: var(--text-primary);
        padding: 4px 8px;
        border-radius: 3px;
        font-size: var(--vscode-font-size, 13px);
        cursor: pointer;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .header-overflow-popover-item:hover {
        background: var(--btn-hover, rgba(255, 255, 255, 0.08));
      }

      .header-overflow-popover-item.static-info {
        cursor: default;
        color: var(--text-secondary);
      }

      .header-overflow-popover-item.static-info:hover {
        background: transparent;
      }

      .header-collapsed-strip {
        display: none;
        align-items: center;
        gap: 6px;
        width: 100%;
        min-width: 0;
        font-size: var(--vscode-font-size, 13px);
        line-height: 1.3;
      }

      .header-collapsed-scroll {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
        flex: 1 1 auto;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .collapsed-meta-item {
        display: inline-flex;
        align-items: center;
        white-space: nowrap;
        flex-shrink: 0;
        color: var(--text-secondary);
      }

      .collapsed-meta-clickable {
        cursor: pointer;
      }

      .collapsed-meta-clickable:hover {
        color: var(--text-primary);
      }

      .collapsed-token-trigger {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        cursor: pointer;
        color: var(--text-primary);
      }

      .collapsed-token-trigger:hover {
        text-decoration: underline;
      }

      .collapsed-tok-item {
        white-space: nowrap;
        flex-shrink: 0;
      }

      .reader-header.header-collapsed .header-meta,
      .header-container.header-collapsed .header-meta,
      .reader-header.header-scroll-collapsed .header-meta,
      .header-container.header-scroll-collapsed .header-meta,
      .reader-header.header-collapsed .reader-combined-toolbar,
      .header-container.header-collapsed .reader-combined-toolbar,
      .reader-header.header-scroll-collapsed .reader-combined-toolbar,
      .header-container.header-scroll-collapsed .reader-combined-toolbar,
      .reader-header.header-collapsed .header-combined-toolbar,
      .header-container.header-collapsed .header-combined-toolbar,
      .reader-header.header-scroll-collapsed .header-combined-toolbar,
      .header-container.header-scroll-collapsed .header-combined-toolbar,
      .reader-header.header-collapsed .token-telemetry-summary,
      .header-container.header-collapsed .token-telemetry-summary,
      .reader-header.header-scroll-collapsed .token-telemetry-summary,
      .header-container.header-scroll-collapsed .token-telemetry-summary {
        display: none !important;
      }

      .reader-header.header-collapsed .header-collapsed-strip,
      .header-container.header-collapsed .header-collapsed-strip,
      .reader-header.header-scroll-collapsed .header-collapsed-strip,
      .header-container.header-scroll-collapsed .header-collapsed-strip {
        display: flex !important;
      }

      .reader-header.header-collapsed,
      .header-container.header-collapsed,
      .reader-header.header-scroll-collapsed,
      .header-container.header-scroll-collapsed {
        padding: 5px 12px !important;
      }

      .reader-header.header-collapsed .token-telemetry-banner,
      .header-container.header-collapsed .token-telemetry-banner,
      .reader-header.header-scroll-collapsed .token-telemetry-banner,
      .header-container.header-scroll-collapsed .token-telemetry-banner {
        margin: 0 !important;
      }
    `;
  }

  public static renderOverflowEllipsisSvg(): string {
    return `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M4 8a1.25 1.25 0 1 1-2.5 0A1.25 1.25 0 0 1 4 8Zm5.25 0a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0Zm5.25 0a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0Z"/></svg>`;
  }

  public static renderCollapseToggleIconSvg(collapsed: boolean): string {
    if (collapsed) {
      return `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z"/></svg>`;
    }
    return `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M12.78 5.22a.749.749 0 0 1 0 1.06l-4.25 4.25a.749.749 0 0 1-1.06 0L3.22 6.28a.749.749 0 1 1 1.06-1.06L8 8.939l3.72-3.719a.749.749 0 0 1 1.06 0Z"/></svg>`;
  }

  public static renderHeaderMetaHtml(p: HeaderMetaRenderParams): string {
    const formattedId = p.sessionId.length > 8
      ? `${p.sessionId.substring(0, 4)}...${p.sessionId.substring(p.sessionId.length - 4)}`
      : p.sessionId;

    const liveDotHtml = p.isLive
      ? `<span class="meta-badge green live-badge" data-overflow-label="Live Auto-Reload Active" title="Live Auto-Reload Active: Automatically syncs when new AI steps arrive"><span class="live-dot"></span></span>`
      : '';

    const chatTypeCountHtml = p.isThread
      ? `<span class="meta-badge green" title="Connected Conversation Thread (Multi-Session Chain) · ${p.userPromptTotal} user chat messages">🧵${p.userPromptTotal}</span>`
      : `<span class="meta-badge blue" title="Single Standalone Conversation · ${p.userPromptTotal} user chat messages">💬${p.userPromptTotal}</span>`;

    const aiStepsHtml = `<span class="meta-badge purple" title="Total AI Execution Steps: ${p.maxStepIndex}">🤖${p.maxStepIndex}</span>`;

    const artifactsBadgeHtml = p.hasArtifacts
      ? `<span class="meta-badge purple" onclick="openArtifactsModal()" style="cursor:pointer;" title="View all ${p.totalArtifacts} artifacts generated in this session (Click to open)">📦${p.totalArtifacts}</span>`
      : `<span class="meta-badge" style="opacity:0.55;" title="No artifacts generated in this session">📦0</span>`;

    const timeBadgeHtml = p.shortTimeStr
      ? `<span class="meta-badge blue" title="Timeline: ${MarkdownRenderer.escapeHtml(p.fullTimeStr)}">${MarkdownRenderer.escapeHtml(p.shortTimeStr)}</span>`
      : '';

    const wsHtml = p.workspaceName
      ? `<span class="meta-badge ws" title="Project Folder: ${MarkdownRenderer.escapeHtml(p.workspacePath || p.workspaceName)}">📁${MarkdownRenderer.escapeHtml(p.workspaceName)}</span>`
      : '';

    const pcHtml = p.machineName
      ? `<span class="meta-badge pc" title="Computer: ${MarkdownRenderer.escapeHtml(p.machineName)}">💻${MarkdownRenderer.escapeHtml(p.machineName)}</span>`
      : '';

    const idHtml = `<span class="meta-badge purple" title="Full Session ID: ${MarkdownRenderer.escapeHtml(p.sessionId)}">🆔${MarkdownRenderer.escapeHtml(formattedId)}</span>`;

    const planShortcutHtml = p.planPath
      ? `<button class="meta-badge naked-meta-btn" data-path="${MarkdownRenderer.escapeHtml(p.planPath)}" onclick="previewArtifactDoc(this)" title="Open implementation_plan.md in Antigravity Rich Preview">📋Plan</button>`
      : '';

    const walkthroughShortcutHtml = p.walkthroughPath
      ? `<button class="meta-badge naked-meta-btn" data-path="${MarkdownRenderer.escapeHtml(p.walkthroughPath)}" onclick="previewArtifactDoc(this)" title="Open walkthrough.md in Antigravity Rich Preview">✅Walkthrough</button>`
      : '';

    return [
      `<div class="header-meta" id="headerMeta" data-overflow-container="headerMeta">`,
      liveDotHtml,
      chatTypeCountHtml,
      aiStepsHtml,
      artifactsBadgeHtml,
      timeBadgeHtml,
      wsHtml,
      pcHtml,
      idHtml,
      planShortcutHtml,
      walkthroughShortcutHtml,
      `<button class="action-btn naked-btn overflow-more-btn" id="headerMetaOverflowBtn" onclick="toggleOverflowMenu('headerMeta', 'headerMetaOverflowBtn', event)" title="Show more session metadata" style="display:none;">${HeaderLayoutHelper.renderOverflowEllipsisSvg()}</button>`,
      `</div>`
    ].filter(Boolean).join('');
  }

  public static renderCollapsedSummaryStripHtml(p: CollapsedStripRenderParams): string {
    const liveHtml = p.isLive
      ? `<span class="collapsed-meta-item live-badge" title="Live Auto-Reload Active"><span class="live-dot"></span></span>`
      : '';
    const { statusDotHtml, tokenTextHtml } = TokenUsageMonitor.renderCollapsedTokenSummary(
      p.tokenUsage,
      p.thresholds
    );
    const chatTypeCountHtml = typeof p.userPromptTotal === 'number'
      ? (p.isThread
        ? `<span class="collapsed-meta-item" title="Connected Conversation Thread (Multi-Session Chain) · ${p.userPromptTotal} user chat messages">🧵${p.userPromptTotal}</span>`
        : `<span class="collapsed-meta-item" title="Single Standalone Conversation · ${p.userPromptTotal} user chat messages">💬${p.userPromptTotal}</span>`)
      : '';
    const artifactsHtml = p.hasArtifacts
      ? `<span class="collapsed-meta-item collapsed-meta-clickable" onclick="openArtifactsModal()" title="View ${p.totalArtifacts} session artifacts">📦${p.totalArtifacts}</span>`
      : `<span class="collapsed-meta-item" style="opacity:0.55;" title="No artifacts">📦0</span>`;
    const shortTime = HeaderLayoutHelper.formatShortLastMessageTime(p.lastModified);
    const timeHtml = shortTime
      ? `<span class="collapsed-meta-item" title="Last message time: ${p.lastModified?.toLocaleString() || shortTime}">${MarkdownRenderer.escapeHtml(shortTime)}</span>`
      : '';
    const aiStepsHtml = `<span class="collapsed-meta-item" title="Total AI Execution Steps: ${p.maxStepIndex}">🤖${p.maxStepIndex}</span>`;
    const tokenHtml = tokenTextHtml
      ? `<span class="collapsed-token-trigger" onclick="toggleCollapsedTokenChart()" title="Click to toggle Token Chart & Step Table">${tokenTextHtml}</span>`
      : '';

    return [
      `<div class="header-collapsed-strip" id="headerCollapsedStrip">`,
      `<div class="header-collapsed-scroll">`,
      liveHtml,
      statusDotHtml,
      chatTypeCountHtml,
      artifactsHtml,
      timeHtml,
      aiStepsHtml,
      tokenHtml,
      `</div>`,
      `</div>`
    ].filter(Boolean).join('');
  }

  public static getSharedClientHeaderScript(headerContainerId: string, initialCollapsed: boolean): string {
    const collapsedIconSvg = HeaderLayoutHelper.renderCollapseToggleIconSvg(true);
    const expandedIconSvg = HeaderLayoutHelper.renderCollapseToggleIconSvg(false);
    return `
      let headerCollapsedState = ${initialCollapsed ? 'true' : 'false'};
      let headerScrollCollapsed = false;
      let scrollAutoCollapseSuppressed = false;
      const HEADER_COLLAPSED_SVG = ${JSON.stringify(collapsedIconSvg)};
      const HEADER_EXPANDED_SVG = ${JSON.stringify(expandedIconSvg)};

      function syncHeaderCollapseUi() {
        const headerEl = document.getElementById('${headerContainerId}');
        const effectiveCollapsed = Boolean(headerCollapsedState || headerScrollCollapsed);
        if (headerEl) {
          headerEl.classList.toggle('header-collapsed', !!headerCollapsedState);
          headerEl.classList.toggle('header-scroll-collapsed', !headerCollapsedState && !!headerScrollCollapsed);
        }
        const toggleBtn = document.getElementById('headerCollapseToggleBtn');
        if (toggleBtn) {
          toggleBtn.innerHTML = effectiveCollapsed ? HEADER_COLLAPSED_SVG : HEADER_EXPANDED_SVG;
          toggleBtn.title = effectiveCollapsed
            ? 'Expand header (show pills, toolbar, and full token bar)'
            : 'Collapse header to compact 1-line summary';
        }
        const cfgSelect = document.getElementById('cfgDefaultHeaderState');
        if (cfgSelect) {
          cfgSelect.value = headerCollapsedState ? 'collapsed' : 'expanded';
        }
      }

      function toggleHeaderCollapse() {
        if (!headerCollapsedState && headerScrollCollapsed) {
          headerScrollCollapsed = false;
          scrollAutoCollapseSuppressed = true;
          syncHeaderCollapseUi();
          if (typeof closeOverflowPopover === 'function') {
            closeOverflowPopover();
          }
          if (typeof layoutAllOverflowRows === 'function') {
            setTimeout(layoutAllOverflowRows, 0);
          }
          return;
        }
        const headerEl = document.getElementById('${headerContainerId}');
        headerCollapsedState = headerEl ? !headerEl.classList.contains('header-collapsed') : !headerCollapsedState;
        headerScrollCollapsed = false;
        scrollAutoCollapseSuppressed = false;
        syncHeaderCollapseUi();
        if (typeof closeOverflowPopover === 'function') {
          closeOverflowPopover();
        }
        if (!headerCollapsedState && typeof layoutAllOverflowRows === 'function') {
          setTimeout(layoutAllOverflowRows, 0);
        }
        vscode.postMessage({ command: 'setHeaderCollapsed', collapsed: headerCollapsedState });
      }

      function updateHeaderScrollCollapse(scrollTop, scrollHeight, clientHeight) {
        if (scrollTop <= 12) {
          scrollAutoCollapseSuppressed = false;
        }
        if (headerCollapsedState) {
          if (headerScrollCollapsed) {
            headerScrollCollapsed = false;
            syncHeaderCollapseUi();
          }
          return;
        }
        let nextScrollCollapsed = headerScrollCollapsed;
        if (!headerScrollCollapsed && !scrollAutoCollapseSuppressed && scrollTop > 90 && (scrollHeight - clientHeight) > 140) {
          nextScrollCollapsed = true;
        } else if (headerScrollCollapsed && scrollTop <= 12) {
          nextScrollCollapsed = false;
        }
        if (nextScrollCollapsed !== headerScrollCollapsed) {
          headerScrollCollapsed = nextScrollCollapsed;
          syncHeaderCollapseUi();
          if (typeof closeOverflowPopover === 'function') {
            closeOverflowPopover();
          }
          if (!headerScrollCollapsed && typeof layoutAllOverflowRows === 'function') {
            setTimeout(layoutAllOverflowRows, 0);
          }
        }
      }

      function resetHeaderScrollCollapse() {
        headerScrollCollapsed = false;
        scrollAutoCollapseSuppressed = false;
        syncHeaderCollapseUi();
      }

      function toggleCollapsedTokenChart() {
        const drawer = document.getElementById('tokenTelemetryDrawer');
        if (drawer) {
          drawer.open = !drawer.open;
        }
      }

      window.syncHeaderCollapseUi = syncHeaderCollapseUi;
      window.toggleHeaderCollapse = toggleHeaderCollapse;
      window.updateHeaderScrollCollapse = updateHeaderScrollCollapse;
      window.resetHeaderScrollCollapse = resetHeaderScrollCollapse;
      window.toggleCollapsedTokenChart = toggleCollapsedTokenChart;

      function ensureOverflowPopover() {
        let pop = document.getElementById('headerOverflowPopover');
        if (!pop) {
          pop = document.createElement('div');
          pop.id = 'headerOverflowPopover';
          pop.className = 'header-overflow-popover';
          document.body.appendChild(pop);
        }
        return pop;
      }

      function closeOverflowPopover() {
        const pop = document.getElementById('headerOverflowPopover');
        if (pop) {
          pop.classList.remove('open');
          pop.innerHTML = '';
        }
      }

      function layoutOverflowRow(containerId, btnId) {
        const container = document.getElementById(containerId);
        const btn = document.getElementById(btnId);
        if (!container || !btn || typeof container.getBoundingClientRect !== 'function') return;
        const items = Array.from(container.children || []).filter(el => el !== btn);
        items.forEach(el => {
          if (el && el.classList) el.classList.remove('overflow-hidden-item');
        });
        if (btn.style) btn.style.display = 'none';

        if (!container.clientWidth || container.clientWidth <= 0) return;
        const style = typeof window !== 'undefined' && typeof window.getComputedStyle === 'function'
          ? window.getComputedStyle(container)
          : null;
        const gap = style ? (parseFloat(style.columnGap || style.gap || '0') || 0) : 0;
        const widths = items.map(el => (el && typeof el.getBoundingClientRect === 'function') ? el.getBoundingClientRect().width : 0);

        let totalWidth = 0;
        let visibleCount = 0;
        for (let i = 0; i < widths.length; i++) {
          if (widths[i] <= 0) continue;
          totalWidth += widths[i] + (visibleCount > 0 ? gap : 0);
          visibleCount++;
        }
        if (totalWidth <= container.clientWidth + 1) {
          return;
        }

        const btnReserve = 26;
        const availableWidth = Math.max(0, container.clientWidth - btnReserve);
        let usedWidth = 0;
        let usedCount = 0;
        let overflowed = false;

        for (let i = 0; i < items.length; i++) {
          const w = widths[i];
          if (w <= 0) continue;
          const nextWidth = usedWidth + (usedCount > 0 ? gap : 0) + w;
          if (nextWidth > availableWidth) {
            for (let j = i; j < items.length; j++) {
              if (items[j] && items[j].classList) items[j].classList.add('overflow-hidden-item');
            }
            overflowed = true;
            break;
          }
          usedWidth = nextWidth;
          usedCount++;
        }
        if (btn.style) btn.style.display = overflowed ? 'inline-flex' : 'none';
      }

      function layoutAllOverflowRows() {
        layoutOverflowRow('dashboardTopActions', 'dashboardTopActionsOverflowBtn');
        layoutOverflowRow('headerMeta', 'headerMetaOverflowBtn');
      }

      function toggleOverflowMenu(containerId, btnId, event) {
        if (event) event.stopPropagation();
        const container = document.getElementById(containerId);
        const btn = document.getElementById(btnId);
        if (!container || !btn) return;
        const pop = ensureOverflowPopover();
        if (pop.classList.contains('open') && pop.getAttribute('data-source') === containerId) {
          closeOverflowPopover();
          return;
        }
        pop.innerHTML = '';
        pop.setAttribute('data-source', containerId);
        const hiddenItems = Array.from(container.children || []).filter(
          el => el !== btn && el && el.classList && el.classList.contains('overflow-hidden-item')
        );
        if (hiddenItems.length === 0) {
          closeOverflowPopover();
          return;
        }

        hiddenItems.forEach(orig => {
          const isClickable = orig.tagName === 'BUTTON' || orig.hasAttribute('onclick');
          const rowBtn = document.createElement(isClickable ? 'button' : 'div');
          rowBtn.className = 'header-overflow-popover-item' + (isClickable ? '' : ' static-info');
          const textVal = (orig.textContent || '').trim();
          const labelAttr = orig.getAttribute('data-overflow-label');
          const titleVal = orig.getAttribute('title') || '';
          rowBtn.textContent = labelAttr || textVal || titleVal;
          if (!textVal && !labelAttr && orig.querySelector('.codicon')) {
            rowBtn.textContent = titleVal;
          } else if (orig.querySelector('.codicon') && titleVal) {
            const iconClone = orig.querySelector('.codicon').cloneNode(true);
            rowBtn.textContent = '';
            rowBtn.appendChild(iconClone);
            const span = document.createElement('span');
            span.textContent = titleVal;
            rowBtn.appendChild(span);
          }
          if (titleVal) rowBtn.title = titleVal;
          if (isClickable) {
            rowBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              closeOverflowPopover();
              orig.click();
            });
          }
          pop.appendChild(rowBtn);
        });

        const btnRect = btn.getBoundingClientRect();
        pop.classList.add('open');
        const popWidth = pop.offsetWidth || 180;
        const leftPos = Math.max(8, Math.min(window.innerWidth - popWidth - 8, btnRect.right - popWidth));
        const topPos = Math.min(window.innerHeight - pop.offsetHeight - 8, btnRect.bottom + 4);
        pop.style.left = leftPos + 'px';
        pop.style.top = topPos + 'px';
      }

      window.closeOverflowPopover = closeOverflowPopover;
      window.layoutAllOverflowRows = layoutAllOverflowRows;
      window.toggleOverflowMenu = toggleOverflowMenu;

      let headerResizeObserver = null;
      function initHeaderOverflowObserver() {
        if (headerResizeObserver) {
          headerResizeObserver.disconnect();
          headerResizeObserver = null;
        }
        if (typeof ResizeObserver === 'function') {
          headerResizeObserver = new ResizeObserver(() => {
            layoutAllOverflowRows();
          });
          ['dashboardTopActions', 'headerMeta', '${headerContainerId}'].forEach(id => {
            const el = document.getElementById(id);
            if (el) headerResizeObserver.observe(el);
          });
        }
        layoutAllOverflowRows();
      }
      window.initHeaderOverflowObserver = initHeaderOverflowObserver;

      if (!window.__brainHubOverflowBound) {
        window.__brainHubOverflowBound = true;
        document.addEventListener('click', () => closeOverflowPopover());
        document.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') closeOverflowPopover();
        });
      }
    `;
  }
}
