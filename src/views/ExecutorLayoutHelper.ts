import {
  ChatMessage,
  ChatSession,
  ExecutorLiveStatus,
  ModelPricingConfig,
  SwarmSessionData,
  ToolCallInfo
} from '../models/types';
import { MarkdownRenderer } from '../services/MarkdownRenderer';
import { SessionScanner } from '../services/SessionScanner';
import { TokenUsageMonitor } from '../services/TokenUsageMonitor';

/**
 * Shared static HTML/CSS builders for the 3-layer multi-executor progress viewer
 * (Orchestrator, /boost, /teamwork, /swarm, invoke_subagent).
 * Static methods ensure compatibility with prototype-mock unit tests.
 */
export class ExecutorLayoutHelper {
  public static getStatusDisplay(status?: ExecutorLiveStatus | string): {
    icon: string;
    label: string;
    cssClass: string;
  } {
    const s = (status || 'done').toLowerCase();
    if (s === 'running' || s === 'working') {
      return { icon: '●', label: 'running', cssClass: 'exec-status-running' };
    }
    if (s === 'waiting' || s === 'idle') {
      return { icon: '⏸', label: 'waiting', cssClass: 'exec-status-waiting' };
    }
    if (s === 'error' || s === 'failed') {
      return { icon: '✕', label: 'error', cssClass: 'exec-status-error' };
    }
    if (s === 'killed') {
      return { icon: '⛔', label: 'killed', cssClass: 'exec-status-killed' };
    }
    return { icon: '✓', label: 'done', cssClass: 'exec-status-done' };
  }

  public static getSharedExecutorCss(): string {
    return `
      .executor-tree-badge {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 1px 6px;
        border-radius: 10px;
        font-size: 11px;
        font-weight: 600;
        background: rgba(86, 156, 214, 0.16);
        color: var(--vscode-textLink-foreground, #4fc1ff);
        border: 1px solid rgba(86, 156, 214, 0.35);
      }
      .executor-tree-badge.is-live {
        background: rgba(78, 201, 176, 0.16);
        color: var(--vscode-testing-iconPassed, #4ec9b0);
        border-color: rgba(78, 201, 176, 0.45);
      }
      .executor-subtree-details {
        margin: 2px 0 4px 12px;
        border-left: 1px dashed var(--vscode-panel-border, rgba(128, 128, 128, 0.35));
        padding-left: 8px;
      }
      .executor-subtree-summary {
        cursor: pointer;
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        padding: 2px 4px;
        user-select: none;
        list-style: none;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .executor-subtree-summary::-webkit-details-marker {
        display: none;
      }
      .executor-subnav-item {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 5px 8px;
        margin: 2px 0;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
        border: 1px solid transparent;
        background: var(--vscode-sideBar-background, rgba(128, 128, 128, 0.04));
      }
      .executor-subnav-item:hover {
        background: var(--vscode-list-hoverBackground, rgba(128, 128, 128, 0.12));
      }
      .executor-subnav-item.selected {
        background: var(--vscode-list-activeSelectionBackground, rgba(14, 99, 156, 0.35));
        border-color: var(--vscode-focusBorder, #007fd4);
      }
      .exec-status-pill {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        font-size: 11px;
        font-weight: 600;
        white-space: nowrap;
      }
      .exec-status-running { color: var(--vscode-testing-iconPassed, #4ec9b0); }
      .exec-status-waiting { color: var(--vscode-editorWarning-foreground, #cca700); }
      .exec-status-done { color: var(--vscode-descriptionForeground, #888); }
      .exec-status-error { color: var(--vscode-editorError-foreground, #f14c4c); }
      .exec-status-killed { color: var(--vscode-descriptionForeground, #888); opacity: 0.75; }

      .executor-switcher-bar {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px;
        padding: 6px 10px;
        margin: 6px 0;
        border-radius: 6px;
        background: var(--vscode-editorWidget-background, rgba(128, 128, 128, 0.08));
        border: 1px solid var(--vscode-panel-border, rgba(128, 128, 128, 0.25));
      }
      .executor-tab-btn {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 3px 8px;
        border-radius: 4px;
        font-size: 12px;
        cursor: pointer;
        border: 1px solid var(--vscode-panel-border, rgba(128, 128, 128, 0.28));
        background: transparent;
        color: var(--vscode-foreground);
      }
      .executor-tab-btn:hover {
        background: var(--vscode-list-hoverBackground, rgba(128, 128, 128, 0.14));
      }
      .executor-tab-btn.active {
        background: var(--vscode-button-background, #0e639c);
        color: var(--vscode-button-foreground, #ffffff);
        border-color: transparent;
      }
      .executor-panel-card {
        margin: 8px 0 12px 0;
        padding: 10px 12px;
        border-radius: 6px;
        border: 1px solid var(--vscode-panel-border, rgba(128, 128, 128, 0.25));
        background: var(--vscode-editorWidget-background, rgba(128, 128, 128, 0.06));
      }
      .executor-matrix-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 12px;
        margin-top: 6px;
      }
      .executor-matrix-table th,
      .executor-matrix-table td {
        padding: 5px 8px;
        border-bottom: 1px solid var(--vscode-panel-border, rgba(128, 128, 128, 0.2));
        text-align: left;
      }
      .inline-subagent-card,
      .inter-agent-card {
        margin: 8px 0;
        padding: 10px 12px;
        border-radius: 6px;
        border: 1px solid var(--vscode-panel-border, rgba(128, 128, 128, 0.3));
        border-left: 3px solid var(--vscode-textLink-foreground, #3794ff);
        background: var(--vscode-editorWidget-background, rgba(128, 128, 128, 0.06));
      }
      .inter-agent-card.kind-report {
        border-left-color: var(--vscode-testing-iconPassed, #4ec9b0);
      }
      .inter-agent-card.kind-notice {
        border-left-color: var(--vscode-editorWarning-foreground, #cca700);
        padding: 6px 10px;
        font-size: 12px;
      }
      .inline-subagent-header,
      .inter-agent-header {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        margin-bottom: 6px;
        font-size: 12px;
      }
      .inspect-transcript-btn {
        margin-left: auto;
        padding: 2px 8px;
        font-size: 11px;
        border-radius: 4px;
        cursor: pointer;
        border: 1px solid var(--vscode-button-background, #0e639c);
        background: transparent;
        color: var(--vscode-textLink-foreground, #4fc1ff);
      }
      .inspect-transcript-btn:hover {
        background: var(--vscode-button-background, #0e639c);
        color: var(--vscode-button-foreground, #ffffff);
      }
      .conversation-link {
        color: var(--vscode-textLink-foreground, #4fc1ff);
        text-decoration: underline;
        cursor: pointer;
      }
      .swarm-board-section {
        margin-top: 8px;
      }
      .swarm-board-msg {
        padding: 6px 8px;
        margin: 4px 0;
        border-radius: 4px;
        background: var(--vscode-editor-background);
        border: 1px solid var(--vscode-panel-border, rgba(128, 128, 128, 0.2));
        font-size: 12px;
      }
      .swarm-board-control {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        font-style: italic;
        padding: 3px 6px;
      }
    `;
  }

  public static collectExecutorDescendants(
    rootSession: ChatSession,
    allSessions: ChatSession[]
  ): ChatSession[] {
    const rootIdLower = rootSession.id.toLowerCase();
    const byId = new Map<string, ChatSession>();
    for (const s of allSessions) {
      byId.set(s.id.toLowerCase(), s);
    }

    const result: ChatSession[] = [];
    const seen = new Set<string>([rootIdLower]);
    const queue: ChatSession[] = [rootSession];

    while (queue.length > 0) {
      const curr = queue.shift()!;
      const currIdLower = curr.id.toLowerCase();

      // Match via executorRefs first (preserves spawn order)
      for (const ref of curr.executorRefs || []) {
        const cid = ref.conversationId.toLowerCase();
        if (seen.has(cid)) continue;
        const child = byId.get(cid);
        if (child && (!child.executorParentId || child.executorParentId.toLowerCase() === currIdLower)) {
          seen.add(cid);
          result.push(child);
          queue.push(child);
        }
      }

      // Also match any session whose executorParentId === curr.id
      for (const s of allSessions) {
        const sid = s.id.toLowerCase();
        if (seen.has(sid)) continue;
        if (s.executorParentId && s.executorParentId.toLowerCase() === currIdLower) {
          seen.add(sid);
          result.push(s);
          queue.push(s);
        }
      }
    }

    return result;
  }

  public static buildExecutorTreeSummaryBadge(
    coordinator: ChatSession,
    allSessions: ChatSession[]
  ): { badgeText: string; badgeHtml: string; hasActive: boolean } {
    const descendants = ExecutorLayoutHelper.collectExecutorDescendants(coordinator, allSessions);
    const totalRefs = Math.max(descendants.length, (coordinator.executorRefs || []).length);
    if (!coordinator.swarmSummary && totalRefs === 0) {
      return { badgeText: '', badgeHtml: '', hasActive: false };
    }

    if (coordinator.swarmSummary) {
      const sw = coordinator.swarmSummary;
      const workerTotal = sw.memberCount || totalRefs;
      const workingCount =
        sw.workingMemberCount ||
        descendants.filter((d) => d.executorStatus === 'running').length;
      const hasActive = workingCount > 0;
      const text = workingCount > 0
        ? `🐝 ${workerTotal} workers · ${workingCount} working`
        : `🐝 ${workerTotal} workers`;
      const html = `<span class="executor-tree-badge ${hasActive ? 'is-live' : ''}" title="${MarkdownRenderer.escapeHtml(sw.headline || sw.title || 'Swarm Execution')}">${text}</span>`;
      return { badgeText: text, badgeHtml: html, hasActive };
    }

    const runningCount =
      descendants.filter((d) => d.executorStatus === 'running').length ||
      (coordinator.executorRefs || []).filter((r) => r.status === 'running').length;
    const hasActive = runningCount > 0;
    const text = runningCount > 0
      ? `🤖 ${runningCount}/${totalRefs} running`
      : `🤖 ${totalRefs} subagent${totalRefs === 1 ? '' : 's'}`;
    const html = `<span class="executor-tree-badge ${hasActive ? 'is-live' : ''}" title="Multi-executor subagent tree">${text}</span>`;
    return { badgeText: text, badgeHtml: html, hasActive };
  }

  public static renderNavSubTreeHtml(
    coordinator: ChatSession,
    allSessions: ChatSession[],
    selectedSessionId?: string
  ): string {
    const descendants = ExecutorLayoutHelper.collectExecutorDescendants(coordinator, allSessions);
    if (descendants.length === 0) {
      return '';
    }

    const isSelectedInside = descendants.some((d) => d.id === selectedSessionId);
    const hasRunning = descendants.some((d) => d.executorStatus === 'running');
    const isOpen = isSelectedInside || hasRunning;
    const summaryLabel = `${descendants.length} executor${descendants.length === 1 ? '' : 's'}`;

    const rowsHtml = descendants
      .map((child) => {
        const depth = Math.max(1, child.executorDepth ?? 1);
        const indentPx = (depth - 1) * 12;
        const st = ExecutorLayoutHelper.getStatusDisplay(child.executorStatus);
        const roleLabel = child.executorRole || child.executorTypeName || child.title;
        const steps = child.stepCount ?? child.messageCount ?? 0;
        const actionStr = child.latestAction ? ` · ${child.latestAction}` : '';
        const isSel = child.id === selectedSessionId;
        const subSearchText = `${child.id} ${child.title} ${roleLabel} ${child.searchKeywords || ''} ${(child.allPrompts || []).join(' ')}`.toLowerCase();
        return `
          <div class="executor-subnav-item ${isSel ? 'selected' : ''}"
               data-id="${child.id}"
               data-text="${MarkdownRenderer.escapeHtml(subSearchText)}"
               data-rollup-exclude="true"
               style="margin-left:${indentPx}px;"
               onclick="event.stopPropagation(); selectSession('${child.id}')"
               title="${MarkdownRenderer.escapeHtml(`${roleLabel} (${st.label}, ${steps} steps${actionStr})`)}">
            <span class="exec-status-pill ${st.cssClass}">${st.icon}</span>
            <span class="executor-subnav-role" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${MarkdownRenderer.escapeHtml(roleLabel)}</span>
            <span style="font-size:10.5px;color:var(--vscode-descriptionForeground);white-space:nowrap;">${steps} steps${MarkdownRenderer.escapeHtml(actionStr)}</span>
          </div>
        `;
      })
      .join('\n');

    return `
      <details class="executor-subtree-details" ${isOpen ? 'open' : ''} data-coordinator-id="${coordinator.id}">
        <summary class="executor-subtree-summary" title="Expand/collapse child executors">
          <span>↳</span>
          <span>${summaryLabel}</span>
        </summary>
        ${rowsHtml}
      </details>
    `;
  }

  public static renderExecutorSwitcherHtml(
    activeSession: ChatSession,
    allSessions: ChatSession[],
    selectedId: string,
    activeTab: 'transcript' | 'progress' | 'swarm' = 'transcript',
    swarmData?: SwarmSessionData | null,
    isChatViewMode: boolean = false
  ): string {
    const rootId = activeSession.executorRootId || activeSession.id;
    const rootSession = allSessions.find((s) => s.id === rootId) || activeSession;
    const descendants = ExecutorLayoutHelper.collectExecutorDescendants(rootSession, allSessions);
    if (descendants.length === 0 && !rootSession.swarmSummary && !swarmData) {
      return '';
    }

    const selectFn = isChatViewMode ? 'openSessionById' : 'selectSession';
    const rootSelected = selectedId === rootSession.id && activeTab === 'transcript';
    const rootSteps = rootSession.stepCount ?? rootSession.messageCount ?? 0;
    const rootBtn = `
      <button class="executor-tab-btn ${rootSelected ? 'active' : ''}"
              onclick="${selectFn}('${rootSession.id}')"
              title="Coordinator (${rootSteps} steps)">
        <span>👑</span>
        <span>Coordinator</span>
        <span style="opacity:0.75;">(${rootSteps})</span>
      </button>
    `;

    const childBtns = descendants
      .map((child) => {
        const depth = Math.max(1, child.executorDepth ?? 1);
        const prefix = depth > 1 ? '↳ ' : '';
        const st = ExecutorLayoutHelper.getStatusDisplay(child.executorStatus);
        const label = child.executorRole || child.executorTypeName || child.title.substring(0, 22);
        const steps = child.stepCount ?? child.messageCount ?? 0;
        const isSel = selectedId === child.id && activeTab === 'transcript';
        return `
          <button class="executor-tab-btn ${isSel ? 'active' : ''}"
                  onclick="${selectFn}('${child.id}')"
                  title="${MarkdownRenderer.escapeHtml(`${child.title} (${st.label}, ${steps} steps)`)}">
            <span>${prefix}</span>
            <span class="exec-status-pill ${st.cssClass}">${st.icon}</span>
            <span>${MarkdownRenderer.escapeHtml(label)}</span>
            <span style="opacity:0.75;">(${steps} steps)</span>
          </button>
        `;
      })
      .join('');

    const progressBtn = `
      <button class="executor-tab-btn ${activeTab === 'progress' ? 'active' : ''}"
              onclick="toggleExecutorTab('progress')"
              title="Toggle Execution Progress Matrix">
        <span>📊 Progress</span>
      </button>
    `;

    const hasSwarm = Boolean(rootSession.swarmSummary || swarmData);
    const swarmBtn = hasSwarm
      ? `
        <button class="executor-tab-btn ${activeTab === 'swarm' ? 'active' : ''}"
                onclick="toggleExecutorTab('swarm')"
                title="View Swarm Board & Workstreams">
          <span>🐝 Swarm Board</span>
        </button>
      `
      : '';

    return `
      <div class="executor-switcher-bar" id="executorSwitcherBar">
        ${rootBtn}
        ${childBtns}
        <span style="margin-left:auto;display:inline-flex;gap:6px;">
          ${progressBtn}
          ${swarmBtn}
        </span>
      </div>
    `;
  }

  public static renderProgressMatrixHtml(
    rootSession: ChatSession,
    allSessions: ChatSession[],
    swarmData?: SwarmSessionData | null,
    pricingConfig?: Partial<ModelPricingConfig>,
    isChatViewMode: boolean = false
  ): string {
    const descendants = ExecutorLayoutHelper.collectExecutorDescendants(rootSession, allSessions);
    const executors = [rootSession, ...descendants];
    const selectFn = isChatViewMode ? 'openSessionById' : 'selectSession';

    const tasksMap = swarmData?.overview?.tasksMap || {};
    const workstreams = swarmData?.overview?.workstreams || [];
    const memberByConvId = new Map<string, { name: string; role?: string }>();
    for (const m of swarmData?.members || []) {
      if (m.conversationId) {
        memberByConvId.set(m.conversationId.toLowerCase(), { name: m.name, role: m.role });
      }
    }

    const resolveSwarmLookup = (convId: string, isRoot: boolean, roleLabel: string) => {
      const member = memberByConvId.get(convId.toLowerCase());
      const keys = Array.from(
        new Set(
          [member?.name, member?.role, isRoot ? 'coordinator' : undefined, roleLabel].filter(
            (k): k is string => Boolean(k)
          )
        )
      );
      let taskDesc: string | undefined;
      for (const k of keys) {
        if (tasksMap[k]) {
          taskDesc = tasksMap[k];
          break;
        }
      }
      const matchingWs = workstreams.find((w) =>
        keys.some((k) => w.owners?.includes(k) || w.name === k)
      );
      return { member, taskDesc, matchingWs };
    };

    const materializedIds = new Set<string>(executors.map((e) => e.id.toLowerCase()));
    const unmaterializedEntries: Array<{
      ref: NonNullable<ChatSession['executorRefs']>[number];
      depth: number;
    }> = [];
    const seenUnmaterialized = new Set<string>();
    for (let i = 0; i < executors.length; i++) {
      const parent = executors[i];
      const parentDepth = i === 0 ? 0 : Math.max(1, parent.executorDepth ?? 1);
      for (const ref of parent.executorRefs || []) {
        const cid = ref.conversationId.toLowerCase();
        if (materializedIds.has(cid) || seenUnmaterialized.has(cid)) continue;
        seenUnmaterialized.add(cid);
        unmaterializedEntries.push({ ref, depth: parentDepth + 1 });
      }
    }

    const materializedRowsHtml = executors
      .map((exec, idx) => {
        const isRoot = idx === 0;
        const depth = isRoot ? 0 : Math.max(1, exec.executorDepth ?? 1);
        const indent = depth > 0 ? `${'↳'.repeat(depth)} ` : '👑 ';
        const { member, taskDesc, matchingWs } = resolveSwarmLookup(
          exec.id,
          isRoot,
          exec.executorRole || exec.executorTypeName || exec.title
        );
        const roleLabel = isRoot
          ? 'Coordinator'
          : (exec.executorRole || member?.name || exec.executorTypeName || exec.title);
        const st = ExecutorLayoutHelper.getStatusDisplay(exec.executorStatus);
        const steps = exec.stepCount ?? exec.messageCount ?? 0;
        const cumTok = exec.tokenUsage?.cumulativeTokens || 0;
        const costStr = exec.tokenUsage
          ? TokenUsageMonitor.formatUsdCost(TokenUsageMonitor.calculateTokenCost(exec.tokenUsage, pricingConfig).totalCost)
          : '$0.00';
        const tokCell = cumTok > 0
          ? `${SessionScanner.formatCompactTokens(cumTok)} (${costStr})`
          : '—';
        const activity = exec.latestAction || taskDesc || exec.title || '—';
        const wsNote = matchingWs?.progress ? ` · ${matchingWs.progress}` : '';

        return `
          <tr>
            <td>${indent}<b>${MarkdownRenderer.escapeHtml(roleLabel)}</b></td>
            <td><span class="exec-status-pill ${st.cssClass}">${st.icon} ${st.label}</span></td>
            <td>${steps} steps${MarkdownRenderer.escapeHtml(wsNote)}</td>
            <td>${tokCell}</td>
            <td>${MarkdownRenderer.escapeHtml(String(activity).substring(0, 80))}</td>
            <td><button class="inspect-transcript-btn" onclick="${selectFn}('${exec.id}')">Open</button></td>
          </tr>
        `;
      })
      .join('');

    const unmaterializedRowsHtml = unmaterializedEntries
      .map(({ ref, depth }) => {
        const indent = `${'↳'.repeat(Math.max(1, depth))} `;
        const { member, taskDesc, matchingWs } = resolveSwarmLookup(
          ref.conversationId,
          false,
          ref.role || ref.typeName || ref.title || ref.conversationId.substring(0, 8)
        );
        const roleLabel =
          ref.role || member?.name || ref.typeName || ref.title || ref.conversationId.substring(0, 8);
        const statusLabel = ref.status ? `Pending / Remote (${ref.status})` : 'Pending / Remote';
        const stepsText = ref.stepCount !== undefined ? `${ref.stepCount} steps` : '—';
        const wsNote = matchingWs?.progress ? ` · ${matchingWs.progress}` : '';
        const activity = ref.latestAction || taskDesc || 'Pending / Remote (not yet materialized)';

        return `
          <tr class="executor-row-unmaterialized" data-conversation-id="${MarkdownRenderer.escapeHtml(ref.conversationId)}">
            <td>${indent}<b>${MarkdownRenderer.escapeHtml(roleLabel)}</b></td>
            <td><span class="exec-status-pill exec-status-waiting">⏳ ${MarkdownRenderer.escapeHtml(statusLabel)}</span></td>
            <td>${MarkdownRenderer.escapeHtml(stepsText + wsNote)}</td>
            <td>—</td>
            <td>${MarkdownRenderer.escapeHtml(String(activity).substring(0, 80))}</td>
            <td><button class="inspect-transcript-btn" disabled title="Transcript not materialized locally yet" style="opacity:0.45;cursor:not-allowed;">Pending</button></td>
          </tr>
        `;
      })
      .join('');

    const totalExecutorCount = executors.length + unmaterializedEntries.length;

    return `
      <div class="executor-panel-card" id="executorProgressMatrix">
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <b>📊 Execution Progress Matrix (${totalExecutorCount} executor${totalExecutorCount === 1 ? '' : 's'})</b>
          <button class="executor-tab-btn" onclick="toggleExecutorTab('transcript')">← Back to Transcript</button>
        </div>
        <table class="executor-matrix-table">
          <thead>
            <tr>
              <th>Executor</th>
              <th>Status</th>
              <th>Progress</th>
              <th>Tokens / Cost</th>
              <th>Latest Activity</th>
              <th>Transcript</th>
            </tr>
          </thead>
          <tbody>${materializedRowsHtml}${unmaterializedRowsHtml}</tbody>
        </table>
      </div>
    `;
  }

  public static renderSwarmBoardHtml(
    swarmData: SwarmSessionData,
    rootSession: ChatSession,
    allSessions: ChatSession[],
    isChatViewMode: boolean = false
  ): string {
    const ov = swarmData.overview;
    const selectFn = isChatViewMode ? 'openSessionById' : 'selectSession';
    const byId = new Map(allSessions.map((s) => [s.id.toLowerCase(), s]));

    if (swarmData.isRemoteOnly) {
      return `
        <div class="executor-panel-card" id="swarmBoardPanel">
          <div style="display:flex;align-items:center;justify-content:space-between;">
            <b>🐝 Swarm Board (Remote-Only Metadata)</b>
            <button class="executor-tab-btn" onclick="toggleExecutorTab('transcript')">← Back to Transcript</button>
          </div>
          <p style="margin-top:6px;font-size:12px;color:var(--vscode-descriptionForeground);">
            Only remote <code>swarm.json</code> metadata is present locally; member transcripts and board logs have not been synced.
          </p>
        </div>
      `;
    }

    const headerHtml = ov
      ? `
        <div class="swarm-board-section">
          ${ov.headline ? `<div style="font-size:14px;font-weight:600;">${MarkdownRenderer.escapeHtml(ov.headline)}</div>` : ''}
          ${ov.goal ? `<div style="font-size:12px;margin-top:3px;"><b>Goal:</b> ${MarkdownRenderer.escapeHtml(ov.goal)}</div>` : ''}
          ${ov.phase ? `<div style="font-size:12px;"><b>Phase:</b> ${MarkdownRenderer.escapeHtml(ov.phase)}</div>` : ''}
          ${ov.runningSummary ? `<div style="font-size:12px;margin-top:4px;color:var(--vscode-descriptionForeground);">${MarkdownRenderer.escapeHtml(ov.runningSummary)}</div>` : ''}
        </div>
      `
      : '';

    const workstreamsHtml =
      ov && ov.workstreams.length > 0
        ? `
          <div class="swarm-board-section">
            <b>Workstreams (${ov.workstreams.length})</b>
            <table class="executor-matrix-table">
              <thead><tr><th>Workstream</th><th>Owners</th><th>State</th><th>Progress / Note</th></tr></thead>
              <tbody>
                ${ov.workstreams
                  .map(
                    (ws) => `
                  <tr>
                    <td><b>${MarkdownRenderer.escapeHtml(ws.name)}</b></td>
                    <td>${MarkdownRenderer.escapeHtml((ws.owners || []).join(', ') || '—')}</td>
                    <td>${MarkdownRenderer.escapeHtml(ws.state || '—')}</td>
                    <td>${MarkdownRenderer.escapeHtml([ws.progress, ws.note].filter(Boolean).join(' — ') || '—')}</td>
                  </tr>`
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
        `
        : '';

    const membersHtml =
      swarmData.members.length > 0
        ? `
          <div class="swarm-board-section">
            <b>Swarm Roster (${swarmData.members.length})</b>
            <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;">
              ${swarmData.members
                .map((m) => {
                  const st = ExecutorLayoutHelper.getStatusDisplay(m.killed ? 'killed' : m.status);
                  const linked = m.conversationId ? byId.get(m.conversationId.toLowerCase()) : undefined;
                  const clickAttr = linked ? `onclick="${selectFn}('${linked.id}')"` : '';
                  return `<button class="executor-tab-btn" ${clickAttr} title="${MarkdownRenderer.escapeHtml(m.model || '')}">
                    <span class="exec-status-pill ${st.cssClass}">${st.icon}</span>
                    <span>${MarkdownRenderer.escapeHtml(m.name)}</span>
                    ${m.role && m.role !== m.name ? `<span style="opacity:0.75;">(${MarkdownRenderer.escapeHtml(m.role)})</span>` : ''}
                  </button>`;
                })
                .join('')}
            </div>
          </div>
        `
        : '';

    const boardHtml =
      swarmData.boardMessages.length > 0
        ? `
          <div class="swarm-board-section">
            <b>Shared Message Board (${swarmData.boardMessages.length})</b>
            <div style="max-height:320px;overflow-y:auto;margin-top:6px;">
              ${swarmData.boardMessages
                .map((bm) => {
                  if (bm.control) {
                    return `<div class="swarm-board-control">⚙️ Control: ${MarkdownRenderer.escapeHtml(JSON.stringify(bm.control))}</div>`;
                  }
                  return `
                    <div class="swarm-board-msg">
                      <div style="font-size:11px;color:var(--vscode-descriptionForeground);margin-bottom:2px;">
                        <b>@${MarkdownRenderer.escapeHtml(bm.agent || 'agent')}</b>
                        ${bm.seq !== undefined ? `<span>#${bm.seq}</span>` : ''}
                        ${bm.channel ? `<span>[${MarkdownRenderer.escapeHtml(bm.channel)}]</span>` : ''}
                      </div>
                      <div class="markdown-content">${MarkdownRenderer.render(bm.text || '')}</div>
                    </div>
                  `;
                })
                .join('')}
            </div>
          </div>
        `
        : '';

    return `
      <div class="executor-panel-card" id="swarmBoardPanel">
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <b>🐝 Swarm Board: ${MarkdownRenderer.escapeHtml(swarmData.title || rootSession.title)}</b>
          <button class="executor-tab-btn" onclick="toggleExecutorTab('transcript')">← Back to Transcript</button>
        </div>
        ${headerHtml}
        ${workstreamsHtml}
        ${membersHtml}
        ${boardHtml}
      </div>
    `;
  }

  public static renderInlineSubagentCardHtml(
    info: { role?: string; typeName?: string; conversationId?: string; status?: string },
    linkedChild?: ChatSession,
    isChatViewMode: boolean = false
  ): string {
    const convId = info.conversationId || linkedChild?.id || '';
    const role = info.role || linkedChild?.executorRole || info.typeName || linkedChild?.executorTypeName || 'Subagent';
    const st = ExecutorLayoutHelper.getStatusDisplay(linkedChild?.executorStatus || info.status || 'done');
    const steps = linkedChild ? (linkedChild.stepCount ?? linkedChild.messageCount ?? 0) : 0;
    const lastAct = linkedChild?.latestAction ? ` · last: ${linkedChild.latestAction}` : '';
    const selectFn = isChatViewMode ? 'openSessionById' : 'selectSession';
    const inspectBtn = convId
      ? `<button class="inspect-transcript-btn" onclick="${selectFn}('${convId}')">Inspect Transcript</button>`
      : '';

    return `
      <div class="inline-subagent-card" data-conversation-id="${MarkdownRenderer.escapeHtml(convId)}">
        <div class="inline-subagent-header">
          <span>🤖</span>
          <b>${MarkdownRenderer.escapeHtml(role)}</b>
          ${info.typeName ? `<span style="opacity:0.75;">(${MarkdownRenderer.escapeHtml(info.typeName)})</span>` : ''}
          <span class="exec-status-pill ${st.cssClass}">${st.icon} ${st.label}${linkedChild ? ` · ${steps} steps${MarkdownRenderer.escapeHtml(lastAct)}` : ''}</span>
          ${inspectBtn}
        </div>
      </div>
    `;
  }

  public static renderSendMessageCardHtml(
    tc: ToolCallInfo,
    isChatViewMode: boolean = false
  ): string {
    const argsObj: Record<string, any> =
      typeof tc.args === 'string'
        ? (() => { try { return JSON.parse(tc.args); } catch { return {}; } })()
        : (tc.args || {});
    const recipient = SessionScanner.unquoteToolArg(argsObj.Recipient || argsObj.recipient || '');
    const msgTitle = SessionScanner.unquoteToolArg(argsObj.MessageTitle || tc.description || '');
    const body = SessionScanner.unquoteToolArg(argsObj.Message || argsObj.message || '');
    const selectFn = isChatViewMode ? 'openSessionById' : 'selectSession';
    const recipientLink = /^[0-9a-f-]{36}$/i.test(recipient)
      ? `<a href="javascript:void(0)" class="conversation-link" data-conversation-id="${recipient}" onclick="${selectFn}('${recipient}')">${recipient.substring(0, 8)}</a>`
      : MarkdownRenderer.escapeHtml(recipient);

    return `
      <div class="inter-agent-card kind-report">
        <div class="inter-agent-header">
          <span>📨</span>
          <b>Agent Message${msgTitle ? `: ${MarkdownRenderer.escapeHtml(msgTitle)}` : ''}</b>
          ${recipient ? `<span style="color:var(--vscode-descriptionForeground);">→ ${recipientLink}</span>` : ''}
        </div>
        <div class="markdown-content">${MarkdownRenderer.render(body)}</div>
      </div>
    `;
  }

  public static renderInterAgentMessageHtml(
    msg: ChatMessage,
    allSessions: ChatSession[] = [],
    isChatViewMode: boolean = false
  ): string {
    const meta = msg.interAgentMeta;
    if (!meta) return '';

    if (meta.kind === 'system_sdk') {
      return `
        <details class="system-sdk-details is-internal-step" data-step="${msg.index}" style="margin:6px 0;border:1px dashed var(--border-color);border-radius:6px;background:var(--bg-secondary);">
          <summary style="padding:6px 12px;cursor:pointer;font-size:12px;color:var(--text-secondary);">
            <span>🧩</span> <b>System SDK Reminder #${msg.index}</b>
          </summary>
          <div style="padding:10px 14px;" class="markdown-content">
            ${MarkdownRenderer.render(msg.cleanContent || msg.content || '')}
          </div>
        </details>
      `;
    }

    if (meta.kind === 'status_notice') {
      return `
        <div class="inter-agent-card kind-notice" data-step="${msg.index}">
          <span>ℹ️</span>
          <b>${MarkdownRenderer.escapeHtml(meta.senderLabel || 'System')}:</b>
          <span>${MarkdownRenderer.escapeHtml(msg.cleanContent || msg.content || '')}</span>
        </div>
      `;
    }

    const senderSess = meta.senderId
      ? allSessions.find((s) => s.id.toLowerCase() === meta.senderId!.toLowerCase())
      : undefined;
    const senderName = senderSess?.executorRole || senderSess?.title || (meta.senderId ? meta.senderId.substring(0, 8) : 'Agent');
    const selectFn = isChatViewMode ? 'openSessionById' : 'selectSession';
    const senderBadge = meta.senderId
      ? `<a href="javascript:void(0)" class="conversation-link" data-conversation-id="${meta.senderId}" onclick="${selectFn}('${meta.senderId}')">${MarkdownRenderer.escapeHtml(senderName)}</a>`
      : MarkdownRenderer.escapeHtml(senderName);

    const isTask = meta.kind === 'task_assignment';
    const icon = isTask ? '📋' : '📬';
    const heading = isTask ? 'Task Assignment' : 'Executor Report';

    return `
      <div class="inter-agent-card ${isTask ? 'kind-task' : 'kind-report'}" data-step="${msg.index}">
        <div class="inter-agent-header">
          <span>${icon}</span>
          <b>${heading}</b>
          <span style="color:var(--vscode-descriptionForeground);">from ${senderBadge}</span>
          <span style="margin-left:auto;font-size:11px;color:var(--text-muted);">Step #${msg.index}</span>
        </div>
        <div class="markdown-content">
          ${MarkdownRenderer.render(msg.cleanContent || msg.content || '')}
        </div>
      </div>
    `;
  }
}
