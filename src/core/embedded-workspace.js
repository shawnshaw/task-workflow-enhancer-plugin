const { setIcon } = require('obsidian');
const { escapeRegExp, normalizeSpace } = require('../utils');

class EmbeddedWorkspaceRenderer {
  constructor(plugin) {
    this.plugin = plugin;
  }

  async render(container) {
    const host = container.createDiv({ cls: 'twe-embedded-host' });
    const state = {
      timeScope: 'today',
      folderScope: 'all',
      selectedTaskKey: '',
    };

    const rerender = async () => {
      host.empty();
      host.addClass('twe-today-view');

      const header = host.createDiv({ cls: 'twe-today-header twe-today-header--minimal' });

      const refreshButton = header.createEl('button', {
        cls: 'clickable-icon',
        attr: { 'aria-label': '重载任务插件' },
      });
      setIcon(refreshButton, 'refresh-cw');
      refreshButton.addEventListener('click', async () => this.plugin.reloadSelf());

      const allTasks = await this.plugin.getInboxTasks(true);
      const activeTasks = allTasks.filter((task) => !task.archived);
      const scopedTasks = activeTasks.filter((task) => this.plugin.taskMatchesTimeScope(task, state.timeScope));
      const folderCounts = this.plugin.buildTodayFolderCounts(scopedTasks);
      folderCounts.done = activeTasks.filter((task) => this.plugin.taskMatchesFolderScope(task, 'done')).length;
      folderCounts.archived = allTasks.filter((task) => this.plugin.taskMatchesFolderScope(task, 'archived')).length;
      folderCounts.archive_knowledge = allTasks.filter((task) => this.plugin.taskMatchesFolderScope(task, 'archive_knowledge')).length;
      folderCounts.archive_evidence = allTasks.filter((task) => this.plugin.taskMatchesFolderScope(task, 'archive_evidence')).length;
      const visibleSourceTasks = ['done', 'archived', 'archive_knowledge', 'archive_evidence'].includes(state.folderScope) ? allTasks : scopedTasks;
      const visibleTasks = visibleSourceTasks.filter((task) => this.plugin.taskMatchesFolderScope(task, state.folderScope));

      if (!visibleTasks.find((task) => this.getTaskKey(task) === state.selectedTaskKey)) {
        state.selectedTaskKey = visibleTasks[0] ? this.getTaskKey(visibleTasks[0]) : '';
      }
      const selectedTask = visibleTasks.find((task) => this.getTaskKey(task) === state.selectedTaskKey) || null;

      const shell = host.createDiv({ cls: 'twe-today-shell' });
      this.renderSidebar(shell, state, folderCounts, rerender);
      this.renderTaskList(shell, state, visibleTasks, rerender);
      this.renderDetail(shell, state, selectedTask, rerender);
    };

    await rerender();
  }

  getTaskKey(task) {
    return `${task.path}:${task.line}`;
  }

  renderSidebar(container, state, folderCounts, rerender) {
    const sidebar = container.createDiv({ cls: 'twe-today-sidebar' });

    const section = sidebar.createDiv({ cls: 'twe-sidebar-section' });
    section.createEl('div', { cls: 'twe-sidebar-title', text: '时间范围' });
    const ranges = [
      { key: 'today', label: '今天' },
      { key: 'week', label: '本周' },
      { key: 'month', label: '本月' },
      { key: 'all', label: '全部' },
      { key: 'overdue', label: '已过期' },
    ];
    const chips = section.createDiv({ cls: 'twe-filter-chips' });
    ranges.forEach((range) => {
      const chip = chips.createEl('button', {
        text: range.label,
        cls: `twe-filter-chip${state.timeScope === range.key ? ' is-active' : ''}`,
      });
      chip.addEventListener('click', async () => {
        state.timeScope = range.key;
        await rerender();
      });
    });

    const folders = sidebar.createDiv({ cls: 'twe-sidebar-section' });
    folders.createEl('div', { cls: 'twe-sidebar-title', text: '分类' });
    const items = [
      ['all', '全部'],
      ['inbox', '收件箱'],
      ['today', '待办'],
      ['blocked', '阻塞'],
      ['waiting', '等待'],
      ['done', '已完成'],
      ['archived', '已归档'],
      ['archive_knowledge', '知识归档'],
      ['archive_evidence', '留痕归档'],
    ];
    const list = folders.createDiv({ cls: 'twe-folder-list' });
    items.forEach(([key, label]) => {
      const item = list.createEl('button', {
        cls: `twe-folder-item is-${key}${state.folderScope === key ? ' is-active' : ''}`,
      });
      item.createSpan({ text: label });
      item.createSpan({ cls: 'twe-folder-count', text: String(folderCounts[key] || 0) });
      item.addEventListener('click', async () => {
        state.folderScope = key;
        await rerender();
      });
    });
  }

  renderTaskList(container, state, tasks, rerender) {
    const panel = container.createDiv({ cls: 'twe-today-panel twe-today-list-panel' });
    const header = panel.createDiv({ cls: 'twe-list-header' });
    header.createEl('h3', { text: `列表 · ${tasks.length}` });

    if (!tasks.length) {
      panel.createDiv({ cls: 'twe-today-empty', text: '当前筛选下没有任务。' });
      return;
    }

    const summary = this.plugin.buildTaskStatusSummary(tasks);
    const summaryWrap = panel.createDiv({ cls: 'twe-status-summary' });
    [
      ['未完成', summary.open, 'open'],
      ['等待确认', summary.waiting, 'waiting'],
      ['明确阻塞', summary.blocked, 'blocked'],
      ['已完成', summary.done, 'done'],
      ['已归档', summary.archived, 'archived'],
    ].forEach(([label, count, key]) => {
      const card = summaryWrap.createDiv({ cls: `twe-status-card is-${key}` });
      card.createDiv({ cls: 'twe-status-card-value', text: String(count) });
      card.createDiv({ cls: 'twe-status-card-label', text: label });
    });

    const list = panel.createDiv({ cls: 'twe-today-list' });
    this.plugin.buildTaskDisplaySections(tasks, state.folderScope).forEach((section) => {
      const block = list.createDiv({ cls: 'twe-task-section' });
      block.createDiv({ cls: 'twe-task-section-title', text: `${section.title} · ${section.tasks.length}` });
      section.tasks.forEach((task) => {
        const active = this.getTaskKey(task) === state.selectedTaskKey;
        const visualState = this.plugin.getTaskVisualState(task);
        const card = block.createDiv({ cls: `twe-today-card${active ? ' is-active' : ''}${visualState ? ` is-${visualState}` : ''}` });
        card.addEventListener('click', async () => {
          state.selectedTaskKey = this.getTaskKey(task);
          await rerender();
        });

        const top = card.createDiv({ cls: 'twe-today-card-top' });
        top.createDiv({ cls: 'twe-today-card-title', text: task.title });

        if (task.done) {
          const doneChip = top.createDiv({ cls: 'twe-chip', text: '已完成' });
          doneChip.addClass('is-success');
        } else if (task.workflowTags.includes('#WAIT')) {
          top.createDiv({ cls: 'twe-chip is-waiting', text: '等待确认' });
        } else if (task.workflowTags.includes('#BLOCKED')) {
          top.createDiv({ cls: 'twe-chip is-blocked', text: '明确阻塞' });
        }

        const meta = card.createDiv({ cls: 'twe-today-card-meta' });
        if (task.timeRange) meta.createDiv({ cls: 'twe-chip', text: task.timeRange });
        if (task.scheduled) meta.createDiv({ cls: 'twe-chip', text: `⏳ ${task.scheduled}` });
        if (task.due) meta.createDiv({ cls: 'twe-chip', text: `📅 ${task.due}` });
        if (task.completed) meta.createDiv({ cls: 'twe-chip', text: `✅ ${task.completed}` });
        if (task.project) meta.createDiv({ cls: 'twe-chip', text: `#P/${task.project}` });
        task.workflowTags.forEach((tag) => meta.createDiv({ cls: 'twe-chip', text: tag }));
      });
    });
  }

  renderDetail(container, state, task, rerender) {
    const panel = container.createDiv({ cls: 'twe-today-panel twe-today-detail-panel' });
    const header = panel.createDiv({ cls: 'twe-list-header' });
    header.createEl('h3', { text: '详情' });

    if (!task) {
      const emptyWrap = panel.createDiv({ cls: 'twe-today-empty' });
      emptyWrap.createDiv({ text: '选中一条任务查看详情和操作。' });
      return;
    }

    panel.createEl('div', { cls: 'twe-detail-title', text: task.title });

    const actions = panel.createDiv({ cls: 'twe-detail-actions' });
    this.createDetailActionButton(actions, 'check', '完成任务', async () => {
      state.folderScope = 'done';
      state.selectedTaskKey = this.getTaskKey(task);
      await this.plugin.completeTask(task);
    }, rerender);
    if (task.archived) {
      this.createDetailActionButton(actions, 'archive-restore', '撤回归档', async () => this.plugin.unarchiveTask(task), rerender);
    } else {
      this.createDetailActionButton(actions, 'archive', '归档任务', async () => this.plugin.openArchiveTaskModal(task), rerender);
    }
    this.createDetailActionButton(actions, 'list-checks', '分拣任务', async () => this.plugin.openTaskTriageModal(task), rerender);
    this.createDetailActionButton(actions, 'clock-3', '设置时间段', async () => this.plugin.openTaskTimeModal(task), rerender);
    this.createDetailActionButton(actions, 'calendar-days', '设置日期', async () => this.plugin.openTaskDateModal(task), rerender);
    this.createDetailActionButton(actions, 'folder-tree', '设置项目标签', async () => this.plugin.openTaskProjectTagModal(task), rerender);
    this.createDetailActionButton(actions, 'arrow-up-right', '打开来源', async () => this.plugin.openTaskLocation(task), rerender);

    const facts = panel.createDiv({ cls: 'twe-detail-facts' });
    if (task.timeRange) facts.createDiv({ cls: 'twe-chip', text: task.timeRange });
    if (task.scheduled) facts.createDiv({ cls: 'twe-chip', text: `⏳ ${task.scheduled}` });
    if (task.due) facts.createDiv({ cls: 'twe-chip', text: `📅 ${task.due}` });
    if (task.completed) facts.createDiv({ cls: 'twe-chip', text: `✅ ${task.completed}` });
    if (task.project) facts.createDiv({ cls: 'twe-chip', text: `#P/${task.project}` });
    task.workflowTags.forEach((tag) => facts.createDiv({ cls: 'twe-chip', text: tag }));

    const raw = panel.createDiv({ cls: 'twe-detail-block' });
    raw.createEl('div', { cls: 'twe-detail-label', text: '原始记录' });
    raw.createEl('div', { cls: 'twe-detail-value twe-detail-raw', text: task.raw });
  }

  createDetailActionButton(container, icon, label, handler, rerender) {
    const button = container.createEl('button', {
      cls: 'twe-detail-button',
      attr: { 'aria-label': label },
    });
    setIcon(button, icon);
    button.createSpan({ text: label });
    button.addEventListener('click', async () => {
      await handler();
      if (rerender) await rerender();
    });
  }
}

module.exports = { EmbeddedWorkspaceRenderer };
