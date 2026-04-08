const {
  ItemView,
  Notice,
  setIcon,
} = require('obsidian');
const {
  TODAY_VIEW_TYPE,
  TRIAGE_ACTIONS,
  COMPLEXITY_OPTIONS,
  EMPTY_TAB_FOLDER_SCOPE,
} = require('../constants');

class TodayPanelView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    const savedState = this.plugin.getTodayWorkspaceState();
    const tabs = this.plugin.getWorkspaceTabs();
    this.activeTab = tabs.some((tab) => tab.id === savedState?.activeTab) ? savedState?.activeTab : (tabs[0]?.id || 'today');
    this.timeScope = ['today', 'tomorrow', 'week', 'month', 'all', 'overdue'].includes(savedState?.timeScope) ? savedState.timeScope : 'today';
    this.folderScope = ['all', 'inbox', 'today', 'blocked', 'waiting', 'done', 'archived', 'archive_knowledge', 'archive_evidence'].includes(savedState?.folderScope) ? savedState?.folderScope : 'all';
    this.topNavCollapsed = typeof savedState?.topNavCollapsed === 'boolean' ? savedState.topNavCollapsed : true;
    this.selectedTaskKey = typeof savedState?.selectedTaskKey === 'string' ? savedState.selectedTaskKey : '';
    this.selectedProject = typeof savedState?.selectedProject === 'string' ? savedState.selectedProject : '';
    this.isCreatingTask = false;
    this.sidebarWidth = Math.max(180, Math.min(420, Number(savedState?.sidebarWidth) || 220));
    this.detailWidth = Math.max(320, Math.min(860, Number(savedState?.detailWidth) || 360));
    this.expandedTaskKeys = new Set(Array.isArray(savedState?.expandedTaskKeys) ? savedState.expandedTaskKeys : []);
    this.renderVersion = 0;
  }

  getViewType() {
    return TODAY_VIEW_TYPE;
  }

  getDisplayText() {
    return '任务';
  }

  getIcon() {
    return 'calendar-check-2';
  }

  async onOpen() {
    this.contentEl.empty();
    this.contentEl.addClass('twe-today-view');
    if (!this.app.workspace.layoutReady) {
      this.contentEl.createDiv({ cls: 'twe-today-empty', text: '正在加载任务数据…' });
      return;
    }
    await this.render();
  }

  onClose() {
    this.renderVersion++;
    this.expandedTaskKeys.clear();
  }

  async render() {
    const renderVersion = ++this.renderVersion;
    const { contentEl } = this;
    contentEl.empty();

    this.renderTopNav(contentEl);
    const currentTab = this.plugin.getWorkspaceTabs().find((tab) => tab.id === this.activeTab) || this.plugin.getWorkspaceTabs()[0];
    if (currentTab?.type === 'project') {
      await this.renderProjectWorkspace(contentEl, renderVersion);
      return;
    }

    const sourcePath = currentTab?.type === 'workspace' && currentTab?.sourcePath ? currentTab.sourcePath : this.plugin.getInboxPath();
    const allTasks = await this.plugin.getTasksFromSource(sourcePath, true);
    if (renderVersion !== this.renderVersion) return;
    const activeTasks = allTasks.filter((task) => !task.archived);
    const timeScopedTasks = activeTasks.filter((task) => this.plugin.taskMatchesTimeScope(task, this.timeScope));
    const folderCounts = this.plugin.buildTodayFolderCounts(timeScopedTasks);
    folderCounts.done = activeTasks.filter((task) => this.plugin.taskMatchesFolderScope(task, 'done')).length;
    folderCounts.archived = allTasks.filter((task) => this.plugin.taskMatchesFolderScope(task, 'archived')).length;
    folderCounts.archive_knowledge = allTasks.filter((task) => this.plugin.taskMatchesFolderScope(task, 'archive_knowledge')).length;
    folderCounts.archive_evidence = allTasks.filter((task) => this.plugin.taskMatchesFolderScope(task, 'archive_evidence')).length;
    const visibleSourceTasks = ['done', 'archived', 'archive_knowledge', 'archive_evidence'].includes(this.folderScope) ? allTasks : timeScopedTasks;
    const visibleTasks = visibleSourceTasks.filter((task) => this.plugin.taskMatchesFolderScope(task, this.folderScope));

    if (!this.isCreatingTask && !visibleTasks.find((task) => this.getTaskKey(task) === this.selectedTaskKey)) {
      this.selectedTaskKey = visibleTasks[0] ? this.getTaskKey(visibleTasks[0]) : '';
    }
    const selectedTask = this.isCreatingTask
      ? null
      : visibleTasks.find((task) => this.getTaskKey(task) === this.selectedTaskKey) || null;
    this.persistViewState();

    const shell = contentEl.createDiv({ cls: 'twe-today-shell' });
    shell.style.setProperty('--twe-sidebar-width', `${this.sidebarWidth}px`);
    shell.style.setProperty('--twe-detail-width', `${this.detailWidth}px`);
    this.renderSidebar(shell, folderCounts);
    const leftResizer = shell.createDiv({ cls: 'twe-resizer', attr: { 'data-side': 'left' } });
    this.attachColumnResize(leftResizer, 'left');
    this.renderTaskList(shell, visibleTasks);
    const rightResizer = shell.createDiv({ cls: 'twe-resizer', attr: { 'data-side': 'right' } });
    this.attachColumnResize(rightResizer, 'right');
    this.renderDetail(shell, selectedTask);
  }

  renderTopNav(container) {
    const nav = container.createDiv({ cls: `twe-top-nav${this.topNavCollapsed ? ' is-collapsed' : ''}` });
    const left = nav.createDiv({ cls: 'twe-top-nav-left' });
    const tabsWrap = left.createDiv({ cls: 'twe-top-nav-tabs' });
    this.plugin.getWorkspaceTabs().forEach((tab) => {
      const button = tabsWrap.createEl('button', {
        text: tab.name,
        cls: `twe-top-nav-button${this.activeTab === tab.id ? ' is-active' : ''}`,
      });
      button.addEventListener('click', async () => {
        this.activeTab = tab.id;
        this.timeScope = tab.defaultTimeScope || this.timeScope;
        this.folderScope = tab.defaultFolderScope || 'all';
        this.persistViewState();
        await this.render();
      });
    });
    const manageTabsButton = tabsWrap.createEl('button', {
      cls: 'twe-top-nav-tab-manager',
      text: '+',
      attr: { 'aria-label': '管理 Tabs' },
    });
    manageTabsButton.addEventListener('click', async () => {
      await this.plugin.openWorkspaceTabsModal(this.activeTab);
    });

    const actions = nav.createDiv({ cls: 'twe-top-nav-actions' });
    const collapseButton = actions.createEl('button', {
      cls: 'clickable-icon twe-top-nav-collapse',
      attr: { 'aria-label': this.topNavCollapsed ? '展开工具栏' : '收起工具栏' },
    });
    setIcon(collapseButton, this.topNavCollapsed ? 'panel-top-open' : 'panel-top-close');
    collapseButton.addEventListener('click', async () => {
      this.topNavCollapsed = !this.topNavCollapsed;
      this.persistViewState();
      await this.render();
    });

    const utilityWrap = actions.createDiv({ cls: 'twe-top-nav-utility' });
    const currentTab = this.plugin.getWorkspaceTabs().find((tab) => tab.id === this.activeTab) || null;
    if (!currentTab || currentTab.type !== 'project') {
      const reportButton = utilityWrap.createEl('button', {
        cls: 'twe-top-nav-report',
        text: '周报汇总',
        attr: { 'aria-label': '生成周报汇总' },
      });
      reportButton.addEventListener('click', async () => {
        const sourcePath = currentTab && currentTab.type === 'workspace' && currentTab.sourcePath
          ? currentTab.sourcePath
          : this.plugin.getInboxPath();
        const sourceLabel = currentTab ? currentTab.name : '任务';
        await this.plugin.openWeeklyReportModal(sourcePath, sourceLabel);
      });
    }
    const refreshButton = utilityWrap.createEl('button', {
      cls: 'clickable-icon twe-top-nav-refresh',
      attr: { 'aria-label': '重载任务插件' },
    });
    setIcon(refreshButton, 'refresh-cw');
    refreshButton.addEventListener('click', async () => this.plugin.reloadSelf());
  }

  attachColumnResize(handle, side) {
    handle.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const startX = event.clientX;
      const startSidebar = this.sidebarWidth;
      const startDetail = this.detailWidth;
      handle.classList.add('is-dragging');
      handle.setPointerCapture?.(event.pointerId);

      const onMove = (moveEvent) => {
        const delta = moveEvent.clientX - startX;
        if (side === 'left') {
          this.sidebarWidth = Math.max(180, Math.min(420, startSidebar + delta));
        } else {
          this.detailWidth = Math.max(320, Math.min(860, startDetail - delta));
        }

        const shell = this.contentEl.querySelector('.twe-today-shell');
        if (shell) {
          shell.style.setProperty('--twe-sidebar-width', `${this.sidebarWidth}px`);
          shell.style.setProperty('--twe-detail-width', `${this.detailWidth}px`);
        }
      };

      const onUp = async () => {
        document.body.classList.remove('twe-is-resizing');
        handle.classList.remove('is-dragging');
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        this.persistViewState();
        await this.render();
      };

      document.body.classList.add('twe-is-resizing');
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    });
  }

  async renderProjectWorkspace(container, renderVersion = this.renderVersion) {
    const summaries = await this.plugin.collectProjectSummaries();
    if (renderVersion !== this.renderVersion) return;

    if (!this.selectedProject && summaries.length > 0) {
      this.selectedProject = summaries[0].tag;
      this.persistViewState();
    }
    if (this.selectedProject && !summaries.some((s) => s.tag === this.selectedProject)) {
      this.selectedProject = summaries[0]?.tag || '';
    }

    if (!this.selectedProject) {
      const emptyWrap = container.createDiv({ cls: 'twe-project-empty twe-project-empty-global' });
      emptyWrap.createDiv({ text: '还没有可用的项目标签。请先在 Projects/ 目录维护带 project_tag 的项目文件。' });
      return;
    }

    const [projectInfo, projectData] = await Promise.all([
      this.plugin.getProjectInfo(this.selectedProject),
      this.plugin.getProjectData(this.selectedProject),
    ]);
    if (renderVersion !== this.renderVersion) return;
    const selectedSummary = summaries.find((s) => s.tag === this.selectedProject) || summaries[0];

    const shell = container.createDiv({ cls: 'twe-project-shell twe-today-shell' });
    shell.style.setProperty('--twe-sidebar-width', `${this.sidebarWidth}px`);
    shell.style.setProperty('--twe-detail-width', `${this.detailWidth}px`);

    this.renderProjectCatalog(shell, summaries, selectedSummary);
    const leftResizer = shell.createDiv({ cls: 'twe-resizer', attr: { 'data-side': 'left' } });
    this.attachColumnResize(leftResizer, 'left');
    this.renderProjectMainPanel(shell, projectInfo, projectData);
    const rightResizer = shell.createDiv({ cls: 'twe-resizer', attr: { 'data-side': 'right' } });
    this.attachColumnResize(rightResizer, 'right');
    this.renderProjectDetailPanel(shell, projectInfo, projectData);
  }

  renderProjectCatalog(container, summaries, selectedSummary) {
    const sidebar = container.createDiv({ cls: 'twe-today-sidebar twe-project-catalog-sidebar' });
    sidebar.createEl('div', { cls: 'twe-sidebar-title', text: '项目列表' });
    const list = sidebar.createDiv({ cls: 'twe-project-catalog-list' });

    summaries.forEach((summary) => {
      const item = list.createEl('button', {
        cls: `twe-project-catalog-item${summary.tag === selectedSummary.tag ? ' is-active' : ''}`,
      });
      const top = item.createDiv({ cls: 'twe-project-catalog-item-top' });
      top.createDiv({ cls: 'twe-project-catalog-item-title', text: summary.title });
      if (summary.status) top.createDiv({ cls: 'twe-chip', text: summary.status });

      const counts = item.createDiv({ cls: 'twe-project-catalog-counts' });
      counts.createDiv({ cls: 'twe-project-catalog-count' }).setText(`进行 ${summary.openCount}`);
      counts.createDiv({ cls: 'twe-project-catalog-count is-waiting' }).setText(`等待 ${summary.waitingCount}`);
      counts.createDiv({ cls: 'twe-project-catalog-count is-blocked' }).setText(`阻塞 ${summary.blockedCount}`);

      item.addEventListener('click', async () => {
        this.selectedProject = summary.tag;
        this._projectSelectedTask = null;
        this.isCreatingTask = false;
        this.persistViewState();
        await this.render();
      });
    });
  }

  renderProjectMainPanel(container, projectInfo, data) {
    const panel = container.createDiv({ cls: 'twe-today-panel twe-today-list-panel twe-project-main-panel' });

    const header = panel.createDiv({ cls: 'twe-list-header twe-main-list-header' });
    const titleWrap = header.createDiv({ cls: 'twe-list-title-wrap' });
    const title = projectInfo?.title || this.selectedProject;
    const totalActive = data.openTasks.length + data.waitingTasks.length + data.blockedTasks.length;
    titleWrap.createEl('h3', { text: title });
    titleWrap.createDiv({ cls: 'twe-list-subtitle', text: `进行 ${data.openTasks.length} · 等待 ${data.waitingTasks.length} · 阻塞 ${data.blockedTasks.length} · 共 ${totalActive}` });

    const headerActions = header.createDiv({ cls: 'twe-project-header-actions' });
    if (projectInfo?.path) {
      const openFileBtn = headerActions.createEl('button', {
        cls: 'clickable-icon',
        attr: { 'aria-label': '打开项目文件' },
      });
      setIcon(openFileBtn, 'arrow-up-right');
      openFileBtn.addEventListener('click', async () => {
        await this.plugin.openFileByPath(projectInfo.path);
      });
    }
    const reportBtn = headerActions.createEl('button', {
      cls: 'twe-top-nav-report',
      text: '项目周报',
      attr: { 'aria-label': '生成项目周报' },
    });
    reportBtn.addEventListener('click', async () => {
      await this.plugin.openWeeklyReportModal(null, title, this.selectedProject);
    });
    const addBtn = headerActions.createEl('button', {
      cls: 'twe-list-add-button',
      text: '新建任务',
    });
    addBtn.addEventListener('click', async () => {
      this.isCreatingTask = true;
      this._projectSelectedTask = null;
      this.selectedTaskKey = '';
      this._projectCreatePreset = this.selectedProject;
      await this.render();
    });

    const summaryWrap = panel.createDiv({ cls: 'twe-status-summary' });
    this.createProjectSummaryCard(summaryWrap, '进行中', data.openTasks.length, 'open');
    this.createProjectSummaryCard(summaryWrap, '等待确认', data.waitingTasks.length, 'waiting');
    this.createProjectSummaryCard(summaryWrap, '明确阻塞', data.blockedTasks.length, 'blocked');
    this.createProjectSummaryCard(summaryWrap, '本周相关', data.thisWeekTasks.length, 'open');
    this.createProjectSummaryCard(summaryWrap, '已完成', data.doneTasks.length, 'done');

    if (projectInfo?.goal || projectInfo?.focus) {
      const notesWrap = panel.createDiv({ cls: 'twe-project-inline-notes' });
      if (projectInfo.goal) notesWrap.createDiv({ cls: 'twe-project-note', text: `目标：${projectInfo.goal}` });
      if (projectInfo.focus) notesWrap.createDiv({ cls: 'twe-project-note', text: `当前重点：${projectInfo.focus}` });
    }

    const taskList = panel.createDiv({ cls: 'twe-today-list' });
    const sections = [
      { title: '当前推进', tasks: data.openTasks },
      { title: '等待确认', tasks: data.waitingTasks },
      { title: '明确阻塞', tasks: data.blockedTasks },
      { title: '本周相关', tasks: data.thisWeekTasks },
    ].filter((s) => s.tasks.length);

    if (!sections.length) {
      panel.createDiv({ cls: 'twe-project-empty', text: '当前没有进行中的项目任务。' });
    }
    sections.forEach((s) => this.renderProjectTaskSection(taskList, s.title, s.tasks));
  }

  renderProjectDetailPanel(container, projectInfo, data) {
    const panel = container.createDiv({ cls: 'twe-today-panel twe-today-detail-panel twe-project-detail-panel' });

    if (this.isCreatingTask) {
      panel.createDiv({ cls: 'twe-list-header' }).createEl('h3', { text: '新建项目任务' });
      this.renderProjectTaskEditor(panel, null);
      return;
    }

    if (this._projectSelectedTask) {
      panel.createDiv({ cls: 'twe-list-header' }).createEl('h3', { text: '任务详情' });
      this.renderProjectTaskDetailView(panel, this._projectSelectedTask);
      return;
    }

    panel.createDiv({ cls: 'twe-list-header' }).createEl('h3', { text: '项目摘要' });

    const facts = panel.createDiv({ cls: 'twe-project-facts' });
    if (projectInfo?.status) facts.createDiv({ cls: 'twe-chip', text: projectInfo.status });
    if (projectInfo?.phase) facts.createDiv({ cls: 'twe-chip', text: `阶段：${projectInfo.phase}` });
    if (projectInfo?.owner) facts.createDiv({ cls: 'twe-chip', text: `责任人：${projectInfo.owner}` });
    if (projectInfo?.targetDate) facts.createDiv({ cls: 'twe-chip', text: `目标日期：${projectInfo.targetDate}` });
    if (projectInfo?.area) facts.createDiv({ cls: 'twe-chip', text: `领域：${projectInfo.area}` });

    const nextBlock = panel.createDiv({ cls: 'twe-project-side-block' });
    nextBlock.createDiv({ cls: 'twe-project-side-title', text: '下一步' });
    nextBlock.createDiv({
      cls: 'twe-project-note',
      text: projectInfo?.nextAction || '还没有明确的下一步。',
    });

    const riskBlock = panel.createDiv({ cls: 'twe-project-side-block twe-project-side-risk' });
    riskBlock.createDiv({ cls: 'twe-project-side-title', text: '风险与阻塞' });
    const riskItems = [...data.blockedTasks.slice(0, 3), ...data.waitingTasks.slice(0, 3)].slice(0, 4);
    if (riskItems.length || projectInfo?.risk) {
      if (projectInfo?.risk) riskBlock.createDiv({ cls: 'twe-project-note', text: projectInfo.risk });
      riskItems.forEach((task) => {
        const meta = this.plugin.extractFollowupMeta(task.note || '');
        const row = riskBlock.createDiv({ cls: 'twe-project-risk-item' });
        row.createDiv({ cls: 'twe-project-risk-title', text: task.title });
        const parts = [];
        if (meta.owner) parts.push(`责任人 ${meta.owner}`);
        if (meta.item) parts.push(meta.item);
        if (meta.confirmBy) parts.push(`确认截止 ${meta.confirmBy}`);
        if (meta.eta) parts.push(`预计完成 ${meta.eta}`);
        row.createDiv({ cls: 'twe-project-risk-meta', text: parts.length ? parts.join(' · ') : '需要继续推进' });
      });
    } else {
      riskBlock.createDiv({ cls: 'twe-project-empty', text: '当前没有显著风险或阻塞。' });
    }

    if (data.doneTasks.length) {
      const doneSection = panel.createDiv({ cls: 'twe-project-section is-compact' });
      doneSection.createEl('h3', { text: `最近完成 · ${data.doneTasks.length}` });
      const doneList = doneSection.createDiv({ cls: 'twe-project-list' });
      data.doneTasks.slice(0, 8).forEach((task) => {
        const card = doneList.createDiv({ cls: 'twe-project-card is-done' });
        card.createDiv({ cls: 'twe-project-card-title', text: task.title });
        const cardMeta = card.createDiv({ cls: 'twe-project-card-meta' });
        if (task.completed) cardMeta.createDiv({ cls: 'twe-chip', text: `✅ ${task.completed}` });
      });
    }
  }

  renderProjectTaskSection(container, title, tasks) {
    const section = container.createDiv({ cls: 'twe-task-section' });
    section.createDiv({ cls: 'twe-task-section-title', text: `${title} · ${tasks.length}` });
    tasks.forEach((task) => {
      const taskKey = `${task.path}:${task.line}`;
      const isSelected = this._projectSelectedTask
        && `${this._projectSelectedTask.path}:${this._projectSelectedTask.line}` === taskKey;
      const card = section.createDiv({ cls: `twe-today-card${isSelected ? ' is-active' : ''}` });

      card.addEventListener('click', () => {
        this._projectSelectedTask = task;
        this.isCreatingTask = false;
        this.render();
      });

      const top = card.createDiv({ cls: 'twe-today-card-top' });
      const main = top.createDiv({ cls: 'twe-task-main' });
      main.createDiv({ cls: 'twe-today-card-title', text: task.title });

      const cardActions = top.createDiv({ cls: 'twe-today-card-actions' });
      if (task.workflowTags.includes('#WAIT')) {
        cardActions.createDiv({ cls: 'twe-chip is-waiting', text: '等待' });
      } else if (task.workflowTags.includes('#BLOCKED')) {
        cardActions.createDiv({ cls: 'twe-chip is-blocked', text: '阻塞' });
      }

      const meta = card.createDiv({ cls: 'twe-today-card-meta' });
      if (task.timeRange) meta.createDiv({ cls: 'twe-chip', text: task.timeRange });
      if (task.scheduled) meta.createDiv({ cls: 'twe-chip', text: `⏳ ${task.scheduled}` });
      if (task.due) meta.createDiv({ cls: 'twe-chip', text: `📅 ${task.due}` });
    });
  }

  renderProjectTaskDetailView(panel, task) {
    const actions = panel.createDiv({ cls: 'twe-detail-actions' });
    this.createActionButton(actions, 'check', '完成任务', async () => {
      this._projectSelectedTask = null;
      await this.plugin.completeTask(task);
    });
    this.createActionButton(actions, 'list-todo', '在工作台查看', async () => {
      await this.plugin.openTaskInWorkspace(task);
    });
    this.createActionButton(actions, 'arrow-up-right', '打开来源', async () => {
      await this.plugin.openTaskLocation(task);
    });
    this.createActionButton(actions, 'archive', '归档', async () => {
      this._projectSelectedTask = null;
      await this.plugin.openArchiveTaskModal(task);
    });

    const detail = panel.createDiv({ cls: 'twe-detail-block' });
    detail.createEl('div', { cls: 'twe-detail-label', text: '任务内容' });
    detail.createEl('div', { cls: 'twe-detail-value', text: task.title });

    const metaBlock = panel.createDiv({ cls: 'twe-detail-block' });
    metaBlock.createEl('div', { cls: 'twe-detail-label', text: '元信息' });
    const metaWrap = metaBlock.createDiv({ cls: 'twe-project-facts' });
    if (task.timeRange) metaWrap.createDiv({ cls: 'twe-chip', text: task.timeRange });
    if (task.scheduled) metaWrap.createDiv({ cls: 'twe-chip', text: `⏳ ${task.scheduled}` });
    if (task.due) metaWrap.createDiv({ cls: 'twe-chip', text: `📅 ${task.due}` });
    if (task.complexityTag) metaWrap.createDiv({ cls: 'twe-chip', text: task.complexityTag });
    task.workflowTags.forEach((tag) => metaWrap.createDiv({ cls: 'twe-chip', text: tag }));
    if (task.path) metaWrap.createDiv({ cls: 'twe-chip', text: task.path });

    if (task.note) {
      const followup = this.plugin.extractFollowupMeta(task.note);
      if (followup.owner || followup.item || followup.confirmBy || followup.eta) {
        const fuBlock = panel.createDiv({ cls: 'twe-detail-block' });
        fuBlock.createEl('div', { cls: 'twe-detail-label', text: '跟进信息' });
        const fuWrap = fuBlock.createDiv({ cls: 'twe-project-facts' });
        if (followup.owner) fuWrap.createDiv({ cls: 'twe-chip', text: `责任人：${followup.owner}` });
        if (followup.item) fuWrap.createDiv({ cls: 'twe-chip', text: `事项：${followup.item}` });
        if (followup.confirmBy) fuWrap.createDiv({ cls: 'twe-chip', text: `确认截止：${followup.confirmBy}` });
        if (followup.eta) fuWrap.createDiv({ cls: 'twe-chip', text: `预计完成：${followup.eta}` });
      }
      const noteBlock = panel.createDiv({ cls: 'twe-detail-block' });
      noteBlock.createEl('div', { cls: 'twe-detail-label', text: '备注' });
      noteBlock.createEl('div', { cls: 'twe-detail-value twe-detail-raw', text: task.note });
    }

    const rawBlock = panel.createDiv({ cls: 'twe-detail-block' });
    rawBlock.createEl('div', { cls: 'twe-detail-label', text: '原始记录' });
    rawBlock.createEl('div', { cls: 'twe-detail-value twe-detail-raw', text: task.raw });
  }

  renderProjectTaskEditor(panel, task) {
    const draft = task ? this.plugin.taskToFormState(task) : this.plugin.taskToFormState(null);
    if (!task && this._projectCreatePreset) {
      draft.projectTag = this._projectCreatePreset;
    }

    const form = panel.createDiv({ cls: 'twe-editor-form' });
    const basicSection = form.createDiv({ cls: 'twe-editor-section twe-editor-section-primary' });
    const titleField = this.createField(basicSection, '任务内容');
    const titleInput = titleField.createEl('input', { type: 'text', value: draft.title });
    titleInput.placeholder = '例如：对接新版 API 接口';

    const scheduleSection = form.createDiv({ cls: 'twe-editor-section' });
    const dateRow = scheduleSection.createDiv({ cls: 'twe-editor-row' });
    const scheduledField = this.createField(dateRow, '计划处理日');
    const scheduledInput = scheduledField.createEl('input', { type: 'date', value: draft.scheduled });
    const dueField = this.createField(dateRow, '截止日');
    const dueInput = dueField.createEl('input', { type: 'date', value: draft.due });

    const timeRow = scheduleSection.createDiv({ cls: 'twe-editor-row' });
    const startField = this.createField(timeRow, '开始');
    const startInput = startField.createEl('input', { type: 'time', value: draft.startTime });
    const endField = this.createField(timeRow, '结束');
    const endInput = endField.createEl('input', { type: 'time', value: draft.endTime });

    const classifySection = form.createDiv({ cls: 'twe-editor-section' });
    const metaRow = classifySection.createDiv({ cls: 'twe-editor-row' });
    const workflowField = this.createField(metaRow, '安排到');
    const workflowSelect = workflowField.createEl('select');
    workflowSelect.createEl('option', { value: '', text: '暂不安排' });
    TRIAGE_ACTIONS.forEach((action) => workflowSelect.createEl('option', { value: action.tag, text: action.label }));
    workflowSelect.value = draft.workflowTag;

    const projectField = this.createField(metaRow, '所属项目');
    const projectSelect = projectField.createEl('select');
    projectSelect.createEl('option', { value: '', text: '无项目' });
    this.plugin.cachedProjectTags.forEach((tag) => projectSelect.createEl('option', { value: tag, text: `#${tag}` }));
    projectSelect.value = draft.projectTag;

    const detailRow = classifySection.createDiv({ cls: 'twe-editor-row' });
    const complexityField = this.createField(detailRow, '复杂度');
    const complexitySelect = complexityField.createEl('select');
    complexitySelect.createEl('option', { value: '', text: '未指定' });
    COMPLEXITY_OPTIONS.forEach((option) => {
      complexitySelect.createEl('option', { value: option.tag, text: option.label });
    });
    complexitySelect.value = draft.complexityTag;

    const notesSection = form.createDiv({ cls: 'twe-editor-section' });
    const notesField = this.createField(notesSection, '补充说明');
    const notesInput = notesField.createEl('textarea');
    notesInput.value = draft.note || '';
    notesInput.rows = 3;

    const editorActions = panel.createDiv({ cls: 'twe-detail-actions twe-editor-actions' });
    const cancel = editorActions.createEl('button', { cls: 'twe-detail-button', text: '取消' });
    cancel.addEventListener('click', async () => {
      this.isCreatingTask = false;
      this._projectCreatePreset = '';
      await this.render();
    });
    const save = editorActions.createEl('button', { cls: 'twe-detail-button mod-cta', text: '创建任务' });
    save.addEventListener('click', async () => {
      if (save.disabled) return;
      save.disabled = true;
      save.setText('创建中...');
      try {
        await this.saveTaskFromForm(null, {
          title: titleInput,
          startTime: startInput,
          endTime: endInput,
          scheduled: scheduledInput,
          due: dueInput,
          workflowTag: workflowSelect,
          projectTag: projectSelect,
          complexityTag: complexitySelect,
          owner: { value: '' },
          item: { value: '' },
          confirmBy: { value: '' },
          eta: { value: '' },
          subtasks: [],
          note: notesInput,
          done: { checked: false },
        });
        this._projectCreatePreset = '';
      } finally {
        if (save.isConnected) {
          save.disabled = false;
          save.setText('创建任务');
        }
      }
    });
  }

  createProjectSummaryCard(container, label, value, key) {
    const card = container.createDiv({ cls: `twe-status-card is-${key}` });
    card.createDiv({ cls: 'twe-status-card-value', text: String(value) });
    card.createDiv({ cls: 'twe-status-card-label', text: label });
  }


  renderSidebar(container, folderCounts) {
    const sidebar = container.createDiv({ cls: 'twe-today-sidebar' });

    const section = sidebar.createDiv({ cls: 'twe-sidebar-section' });
    section.createEl('div', { cls: 'twe-sidebar-title', text: '时间视角' });
    const ranges = [
      { key: 'today', label: '今天' },
      { key: 'week', label: '本周' },
      { key: 'month', label: '本月' },
      { key: 'overdue', label: '已过期' },
    ];
    const chips = section.createDiv({ cls: 'twe-filter-chips' });
    ranges.forEach((range) => {
      const chip = chips.createEl('button', {
        text: range.label,
        cls: `twe-filter-chip${this.timeScope === range.key ? ' is-active' : ''}`,
      });
      chip.addEventListener('click', async () => {
        this.timeScope = range.key;
        this.persistViewState();
        await this.render();
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
        cls: `twe-folder-item is-${key}${this.folderScope === key ? ' is-active' : ''}`,
      });
      item.createSpan({ text: label });
      item.createSpan({ cls: 'twe-folder-count', text: String(folderCounts[key] || 0) });
      item.addEventListener('click', async () => {
        this.folderScope = key;
        this.persistViewState();
        await this.render();
      });
    });
  }

  renderTaskList(container, tasks) {
    const panel = container.createDiv({ cls: 'twe-today-panel twe-today-list-panel' });
    const header = panel.createDiv({ cls: 'twe-list-header twe-main-list-header' });
    const titleWrap = header.createDiv({ cls: 'twe-list-title-wrap' });
    const headerMeta = this.getTaskListHeaderMeta(tasks);
    titleWrap.createEl('h3', { text: headerMeta.title });
    titleWrap.createDiv({ cls: 'twe-list-subtitle', text: headerMeta.subtitle });
    const addButton = header.createEl('button', {
      cls: 'twe-list-add-button',
      text: '新建任务',
    });
    addButton.addEventListener('click', async () => {
      this.isCreatingTask = true;
      this.selectedTaskKey = '';
      await this.render();
    });

    if (!tasks.length) {
      const emptyWrap = panel.createDiv({ cls: 'twe-today-empty' });
      if (this.folderScope === EMPTY_TAB_FOLDER_SCOPE) {
        emptyWrap.createDiv({ text: '这是一个空白 Tab。你可以后续把它配置成个人生活、某个领域，或者项目专用面板。' });
      } else {
        emptyWrap.createDiv({ text: '当前筛选下没有任务。' });
        const emptyAction = emptyWrap.createEl('button', {
          cls: 'twe-empty-action',
          text: '新建一条任务',
        });
        emptyAction.addEventListener('click', async () => {
          this.isCreatingTask = true;
          this.selectedTaskKey = '';
          await this.render();
        });
      }
      return;
    }

    this.renderTaskStatusSummary(panel, tasks);

    const list = panel.createDiv({ cls: 'twe-today-list' });
    this.getDisplaySections(tasks).forEach((section) => {
      this.renderTaskSection(list, section.title, section.tasks);
    });
  }

  getTaskListHeaderMeta(tasks) {
    if (this.timeScope === 'week') {
      const summary = this.plugin.buildTaskStatusSummary(tasks);
      return {
        title: '本周任务',
        subtitle: `本周总览 · 已完成 ${summary.done} / 总计 ${tasks.length}`,
      };
    }
    if (this.timeScope === 'tomorrow') {
      const tomorrow = window.moment().add(1, 'day').format('YYYY-MM-DD');
      const planned = tasks.filter((task) => !task.done && task.scheduled === tomorrow).length;
      const slotted = tasks.filter((task) => !task.done && task.scheduled === tomorrow && task.timeRange).length;
      const due = tasks.filter((task) => !task.done && task.due === tomorrow).length;
      return {
        title: '明日排程',
        subtitle: `已安排 ${planned} · 已排时段 ${slotted} · 明日到期 ${due}`,
      };
    }
    if (this.timeScope === 'today') {
      return {
        title: '任务',
        subtitle: `今日 · 剩余 ${tasks.length} 项`,
      };
    }
    return {
      title: '任务',
      subtitle: `${this.plugin.getFolderScopeLabel(this.folderScope)} · ${tasks.length}`,
    };
  }

  renderTaskStatusSummary(panel, tasks) {
    const summary = this.plugin.buildTaskStatusSummary(tasks);
    const wrap = panel.createDiv({ cls: 'twe-status-summary' });
    const items = this.timeScope === 'week'
      ? [
        ['本周总量', tasks.length, 'open'],
        ['本周关闭', summary.done, 'done'],
        ['本周新增', this.getWeeklyNewCount(tasks), 'open'],
        ['等待确认', summary.waiting, 'waiting'],
        ['明确阻塞', summary.blocked, 'blocked'],
      ]
      : this.timeScope === 'tomorrow'
        ? this.getTomorrowSummaryItems(tasks)
      : [
        ['未完成', summary.open, 'open'],
        ['等待确认', summary.waiting, 'waiting'],
        ['明确阻塞', summary.blocked, 'blocked'],
        ['已完成', summary.done, 'done'],
        ['已归档', summary.archived, 'archived'],
      ];
    items.forEach(([label, count, key]) => {
      const card = wrap.createDiv({ cls: `twe-status-card is-${key}` });
      card.createDiv({ cls: 'twe-status-card-value', text: String(count) });
      card.createDiv({ cls: 'twe-status-card-label', text: label });
    });

    if (this.timeScope === 'week') {
      this.renderWeeklyDigest(panel, tasks, summary);
    }
  }

  getDisplaySections(tasks) {
    if (this.timeScope === 'tomorrow' && this.folderScope === 'all') {
      const tomorrow = window.moment().add(1, 'day').format('YYYY-MM-DD');
      const slottedPlanned = tasks
        .filter((task) => !task.archived && !task.done && task.scheduled === tomorrow && task.timeRange);
      const unslottedPlanned = tasks
        .filter((task) => !task.archived && !task.done && task.scheduled === tomorrow && !task.timeRange);
      const dueTomorrow = tasks
        .filter((task) => !task.archived && !task.done && task.due === tomorrow && task.scheduled !== tomorrow);
      const rolling = tasks
        .filter((task) => !task.archived && !task.done && (
          task.workflowTags.includes('#WAIT')
          || task.workflowTags.includes('#BLOCKED')
          || task.workflowTags.includes('#weekly')
        ) && task.scheduled !== tomorrow && task.due !== tomorrow);
      const sections = [
        {
          title: '明日已排时段',
          tasks: this.sortTomorrowTasks(slottedPlanned),
        },
        {
          title: '明日待排时间',
          tasks: this.sortTomorrowTasks(unslottedPlanned),
        },
        {
          title: '明日到期事项',
          tasks: this.sortTomorrowTasks(dueTomorrow),
        },
        {
          title: '持续推进事项',
          tasks: this.sortTomorrowTasks(rolling),
        },
      ];
      return sections.filter((section) => section.tasks.length);
    }

    if (this.timeScope !== 'week' || this.folderScope !== 'all') {
      return this.plugin.buildTaskDisplaySections(tasks, this.folderScope);
    }

    const sections = [
      { title: '本周已完成', tasks: tasks.filter((task) => !task.archived && task.done) },
      { title: '本周进行中', tasks: tasks.filter((task) => !task.archived && !task.done && !task.workflowTags.includes('#WAIT') && !task.workflowTags.includes('#BLOCKED')) },
      { title: '本周等待确认', tasks: tasks.filter((task) => !task.archived && !task.done && task.workflowTags.includes('#WAIT')) },
      { title: '本周明确阻塞', tasks: tasks.filter((task) => !task.archived && !task.done && task.workflowTags.includes('#BLOCKED')) },
      { title: '已归档', tasks: tasks.filter((task) => task.archived) },
    ];
    return sections.filter((section) => section.tasks.length);
  }

  getTomorrowSummaryItems(tasks) {
    const tomorrow = window.moment().add(1, 'day').format('YYYY-MM-DD');
    const planned = tasks.filter((task) => !task.done && task.scheduled === tomorrow).length;
    const due = tasks.filter((task) => !task.done && task.due === tomorrow).length;
    const rolling = tasks.filter((task) => !task.done && (
      task.workflowTags.includes('#WAIT')
      || task.workflowTags.includes('#BLOCKED')
      || task.workflowTags.includes('#weekly')
    )).length;
    const unslotted = tasks.filter((task) => !task.done && !task.timeRange).length;
    return [
      ['明日计划', planned, 'open'],
      ['明日到期', due, 'blocked'],
      ['持续推进', rolling, 'waiting'],
      ['待排时间', unslotted, 'archived'],
    ];
  }

  getWeeklyNewCount(tasks) {
    return tasks.filter((task) => !task.archived && !task.done && (
      this.plugin.isDateInCurrentWeek(task.scheduled)
      || this.plugin.isDateInCurrentWeek(task.due)
    )).length;
  }

  renderWeeklyDigest(panel, tasks, summary) {
    const digest = panel.createDiv({ cls: 'twe-weekly-digest' });
    const newCount = this.getWeeklyNewCount(tasks);
    const closedCount = summary.done;
    const carryCount = tasks.filter((task) => !task.archived && !task.done && (
      task.workflowTags.includes('#weekly')
      || task.workflowTags.includes('#WAIT')
      || task.workflowTags.includes('#BLOCKED')
    )).length;

    const overview = digest.createDiv({ cls: 'twe-weekly-digest-block' });
    overview.createDiv({ cls: 'twe-weekly-digest-title', text: '周复盘摘要' });
    overview.createDiv({
      cls: 'twe-weekly-digest-copy',
      text: `本周纳入 ${newCount} 项，关闭 ${closedCount} 项，仍需持续推进 ${carryCount} 项。`,
    });

    const risks = digest.createDiv({ cls: 'twe-weekly-digest-block is-risk' });
    risks.createDiv({ cls: 'twe-weekly-digest-title', text: '风险与阻塞' });
    const riskList = risks.createDiv({ cls: 'twe-weekly-digest-list' });
    const riskTasks = tasks
      .filter((task) => !task.archived && !task.done && (
        task.workflowTags.includes('#WAIT') || task.workflowTags.includes('#BLOCKED')
      ))
      .slice(0, 4);

    if (!riskTasks.length) {
      riskList.createDiv({ cls: 'twe-weekly-digest-item' }).setText('本周没有待确认或阻塞事项。');
      return;
    }

    riskTasks.forEach((task) => {
      const meta = this.plugin.extractFollowupMeta(task.note || '');
      const row = riskList.createDiv({ cls: 'twe-weekly-digest-item' });
      const label = task.workflowTags.includes('#BLOCKED') ? '阻塞' : '等待';
      row.createDiv({
        cls: 'twe-weekly-digest-item-title',
        text: `${label} · ${task.title}`,
      });
      const details = [];
      if (meta.owner) details.push(`责任人 ${meta.owner}`);
      if (meta.item) details.push(meta.item);
      if (meta.confirmBy) details.push(`确认截止 ${meta.confirmBy}`);
      if (meta.eta) details.push(`预计完成 ${meta.eta}`);
      row.createDiv({
        cls: 'twe-weekly-digest-item-meta',
        text: details.length ? details.join(' · ') : '需要继续跟进',
      });
    });
  }

  sortTomorrowTasks(tasks) {
    return [...tasks].sort((a, b) => {
      const aTime = a.timeRange || '99:99';
      const bTime = b.timeRange || '99:99';
      if (aTime !== bTime) return String(aTime).localeCompare(String(bTime));

      const aDue = a.due || '9999-99-99';
      const bDue = b.due || '9999-99-99';
      if (aDue !== bDue) return String(aDue).localeCompare(String(bDue));

      return String(a.title || '').localeCompare(String(b.title || ''));
    });
  }

  renderTaskSection(container, title, tasks) {
    const tomorrow = this.timeScope === 'tomorrow'
      ? window.moment().add(1, 'day').format('YYYY-MM-DD')
      : '';
    const section = container.createDiv({ cls: 'twe-task-section' });
    section.createDiv({ cls: 'twe-task-section-title', text: `${title} · ${tasks.length}` });
    tasks.forEach((task) => {
      const taskKey = this.getTaskKey(task);
      const active = this.getTaskKey(task) === this.selectedTaskKey;
      const visualState = this.plugin.getTaskVisualState(task);
      const tomorrowCardState = this.getTomorrowCardState(task, tomorrow);
      const card = section.createDiv({ cls: `twe-today-card${active ? ' is-active' : ''}${visualState ? ` is-${visualState}` : ''}${tomorrowCardState ? ` is-${tomorrowCardState}` : ''}` });
      card.addEventListener('click', async () => {
        this.isCreatingTask = false;
        this.selectedTaskKey = taskKey;
        this.persistViewState();
        await this.render();
      });

      const top = card.createDiv({ cls: 'twe-today-card-top' });
      const main = top.createDiv({ cls: 'twe-task-main' });
      const cardActions = top.createDiv({ cls: 'twe-today-card-actions' });

      if (this.timeScope === 'tomorrow' && tomorrowCardState === 'tomorrow-unslotted') {
        cardActions.createDiv({ cls: 'twe-chip is-waiting', text: '待排时间' });
      } else if (this.timeScope === 'tomorrow' && tomorrowCardState === 'tomorrow-due') {
        cardActions.createDiv({ cls: 'twe-chip is-blocked', text: '明日到期' });
      } else if (this.timeScope === 'tomorrow' && tomorrowCardState === 'tomorrow-rolling') {
        cardActions.createDiv({ cls: 'twe-chip', text: '持续推进' });
      }

      if (task.done) {
        const doneChip = cardActions.createDiv({ cls: 'twe-chip', text: '已完成' });
        doneChip.addClass('is-success');
      } else if (task.workflowTags.includes('#WAIT')) {
        cardActions.createDiv({ cls: 'twe-chip is-waiting', text: '等待确认' });
      } else if (task.workflowTags.includes('#BLOCKED')) {
        cardActions.createDiv({ cls: 'twe-chip is-blocked', text: '明确阻塞' });
      }

      const { subtasks } = this.plugin.extractSubtasksFromNote(task.note || '');
      const canExpandSubtasks = task.complexityTag === '#C4' || subtasks.length > 0;
      if (canExpandSubtasks && this.expandedTaskKeys.has(taskKey)) {
        const addStepTop = cardActions.createEl('button', {
          cls: 'twe-card-add-step',
          text: '+',
          attr: { 'aria-label': '新增步骤' },
        });
        addStepTop.addEventListener('click', async (evt) => {
          evt.preventDefault();
          evt.stopPropagation();
          await this.plugin.openSubtaskEditModal(task, -1);
        });
      }
      if (canExpandSubtasks) {
        const expandBtn = main.createEl('button', {
          cls: 'twe-card-expand-button',
          attr: { 'aria-label': this.expandedTaskKeys.has(taskKey) ? '收起子任务' : '展开子任务' },
        });
        expandBtn.textContent = this.expandedTaskKeys.has(taskKey) ? '▾' : '▸';
        expandBtn.addEventListener('click', async (evt) => {
          evt.preventDefault();
          evt.stopPropagation();
          if (this.expandedTaskKeys.has(taskKey)) {
            this.expandedTaskKeys.delete(taskKey);
          } else {
            this.expandedTaskKeys.add(taskKey);
          }
          this.persistViewState();
          await this.render();
        });
      }
      main.createDiv({ cls: 'twe-today-card-title', text: task.title });

      const meta = card.createDiv({ cls: 'twe-today-card-meta' });
      if (task.timeRange) meta.createDiv({ cls: 'twe-chip', text: task.timeRange });
      if (task.scheduled) meta.createDiv({ cls: 'twe-chip', text: `⏳ ${task.scheduled}` });
      if (task.due) meta.createDiv({ cls: 'twe-chip', text: `📅 ${task.due}` });
      if (task.project) meta.createDiv({ cls: 'twe-chip', text: `#P/${task.project}` });
      if (task.completed) meta.createDiv({ cls: 'twe-chip', text: `✅ ${task.completed}` });
      task.workflowTags.forEach((tag) => meta.createDiv({ cls: 'twe-chip', text: tag }));

      if (canExpandSubtasks && this.expandedTaskKeys.has(taskKey)) {
        const subtaskPanel = card.createDiv({ cls: 'twe-subtask-panel' });
        const body = subtaskPanel.createDiv({ cls: 'twe-subtask-body' });
        if (!subtasks.length) {
          body.createDiv({ cls: 'twe-subtask-empty', text: '还没有拆解步骤。' });
        } else {
          subtasks.forEach((subtask, index) => {
            const item = body.createDiv({ cls: 'twe-subtask-item' });
            const row = item.createDiv({ cls: 'twe-subtask-row' });
            const mainWrap = row.createDiv({ cls: 'twe-subtask-main' });
            const actionsWrap = row.createDiv({ cls: 'twe-subtask-actions' });
            const checkbox = mainWrap.createEl('input', { type: 'checkbox' });
            checkbox.checked = subtask.done;
            checkbox.addEventListener('click', (evt) => evt.stopPropagation());
            checkbox.addEventListener('change', async (evt) => {
              evt.stopPropagation();
              await this.plugin.toggleTaskSubtask(task, index, checkbox.checked);
            });
            const title = mainWrap.createSpan({ cls: `twe-subtask-title${subtask.done ? ' is-done' : ''}`, text: subtask.title });
            title.addEventListener('click', async (evt) => {
              evt.preventDefault();
              evt.stopPropagation();
              await this.plugin.openSubtaskEditModal(task, index);
            });
            const editBtn = actionsWrap.createEl('button', {
              cls: 'twe-subtask-edit',
              attr: { 'aria-label': '编辑步骤' },
            });
            setIcon(editBtn, 'pencil');
            editBtn.addEventListener('click', async (evt) => {
              evt.preventDefault();
              evt.stopPropagation();
              await this.plugin.openSubtaskEditModal(task, index);
            });
            const deleteBtn = actionsWrap.createEl('button', {
              cls: 'twe-subtask-delete',
              attr: { 'aria-label': '删除步骤' },
            });
            setIcon(deleteBtn, 'trash-2');
            deleteBtn.addEventListener('click', async (evt) => {
              evt.preventDefault();
              evt.stopPropagation();
              await this.plugin.deleteTaskSubtask(task, index);
            });
            const meta = item.createDiv({ cls: 'twe-subtask-meta' });
            if (subtask.timeRange) meta.createDiv({ cls: 'twe-chip', text: subtask.timeRange });
            if (subtask.scheduled) meta.createDiv({ cls: 'twe-chip', text: `⏳ ${subtask.scheduled}` });
            if (subtask.due) meta.createDiv({ cls: 'twe-chip', text: `📅 ${subtask.due}` });
            subtask.workflowTags.forEach((tag) => meta.createDiv({ cls: 'twe-chip', text: tag }));
            if (subtask.complexityTag) meta.createDiv({ cls: 'twe-chip', text: subtask.complexityTag });
            if (subtask.owner) meta.createDiv({ cls: 'twe-chip', text: `责任人:${subtask.owner}` });
            if (subtask.item) meta.createDiv({ cls: 'twe-chip', text: `事项:${subtask.item}` });
          });
        }
      }
    });
  }

  renderDetail(container, task) {
    const panel = container.createDiv({ cls: 'twe-today-panel twe-today-detail-panel' });
    const header = panel.createDiv({ cls: 'twe-list-header' });
    header.createEl('h3', { text: '详情' });

    if (!task && !this.isCreatingTask) {
      const emptyWrap = panel.createDiv({ cls: 'twe-today-empty' });
      emptyWrap.createDiv({ text: '选中一条任务查看详情，或者' });
      const createAction = emptyWrap.createEl('button', {
        cls: 'twe-empty-action',
        text: '新建任务',
      });
      createAction.addEventListener('click', async () => {
        this.isCreatingTask = true;
        this.selectedTaskKey = '';
        await this.render();
      });
      return;
    }

    this.renderTaskEditor(panel, task);
  }

  async saveTaskFromForm(task, form) {
    const values = {
      title: form.title.value.trim(),
      startTime: form.startTime.value,
      endTime: form.endTime.value,
      scheduled: form.scheduled.value,
      due: form.due.value,
      workflowTag: form.workflowTag.value,
      projectTag: form.projectTag.value,
      complexityTag: form.complexityTag.value,
      owner: form.owner ? form.owner.value.trim() : '',
      item: form.item ? form.item.value.trim() : '',
      confirmBy: form.confirmBy ? form.confirmBy.value : '',
      eta: form.eta ? form.eta.value : '',
      subtasks: Array.isArray(form.subtasks) ? form.subtasks : [],
      note: form.note ? form.note.value : '',
      done: form.done ? form.done.checked : false,
    };
    const skipFollowupValidation = Boolean(task && task.archived);

    if (!values.title) {
      new Notice('任务标题不能为空');
      return;
    }

    if (!skipFollowupValidation && (values.workflowTag === '#WAIT' || values.workflowTag === '#BLOCKED')) {
      if (!values.owner || !values.item) {
        new Notice('等待/阻塞任务需要填写“责任人”和“事项”');
        return;
      }
    }
    if (!skipFollowupValidation && values.workflowTag === '#WAIT' && !values.confirmBy) {
      new Notice('等待确认任务需要填写“确认截止”');
      return;
    }
    if (!skipFollowupValidation && values.workflowTag === '#BLOCKED' && !values.eta) {
      new Notice('明确阻塞任务需要填写“预计完成”');
      return;
    }

    if (values.startTime && values.endTime && values.endTime <= values.startTime) {
      new Notice('结束时间需要晚于开始时间');
      return;
    }

    const payload = this.plugin.buildTaskPayload(values);
    if (task) {
      await this.plugin.updateTaskFromPayload(task, payload);
      this.isCreatingTask = false;
      this.selectedTaskKey = this.getTaskKey(task);
      new Notice('已更新任务');
    } else {
      const currentTab = this.plugin.getWorkspaceTabs().find((tab) => tab.id === this.activeTab) || null;
      const targetPath = currentTab && currentTab.type === 'workspace' && currentTab.sourcePath
        ? currentTab.sourcePath
        : this.plugin.getInboxPath();
      const created = await this.plugin.createTaskInSource(targetPath, payload);
      this.isCreatingTask = false;
      this.selectedTaskKey = created ? this.getTaskKey(created) : '';
      new Notice('已新增任务');
    }
    await this.render();
  }

  renderTaskEditor(panel, task) {
    const draft = this.getTaskEditorDraft(task);

    if (task) {
      const quickActions = panel.createDiv({ cls: 'twe-detail-actions' });
      this.createActionButton(quickActions, 'check', '完成任务', async () => {
        this.isCreatingTask = false;
        this.folderScope = 'done';
        this.selectedTaskKey = this.getTaskKey(task);
        this.persistViewState();
        await this.plugin.completeTask(task);
      });
      if (task.archived) {
        this.createActionButton(quickActions, 'archive-restore', '撤回归档', async () => this.plugin.unarchiveTask(task));
      } else {
        this.createActionButton(quickActions, 'archive', '归档任务', async () => this.plugin.openArchiveTaskModal(task));
      }
      this.createActionButton(quickActions, 'arrow-up-right', '打开来源', async () => this.plugin.openTaskLocation(task));
      this.createActionButton(quickActions, 'calendar-plus-2', '延长截止日 +1天', async () => this.plugin.extendTaskDueDate(task, 1));
      if (task.project) {
        this.createActionButton(quickActions, 'folder-kanban', '查看项目', async () => this.plugin.openProjectByTag(`P/${task.project}`));
      }
    }

    const form = panel.createDiv({ cls: 'twe-editor-form' });

    const basicSection = form.createDiv({ cls: 'twe-editor-section twe-editor-section-primary' });
    const title = this.createField(basicSection, '任务内容');
    const titleInput = title.createEl('input', { type: 'text', value: draft.title });
    titleInput.placeholder = '例如：提交吴娟电脑申请流程';

    const scheduleSection = form.createDiv({ cls: 'twe-editor-section' });
    const timeRow = scheduleSection.createDiv({ cls: 'twe-editor-row' });
    const start = this.createField(timeRow, '开始');
    const startInput = start.createEl('input', { type: 'time', value: draft.startTime });
    const end = this.createField(timeRow, '结束');
    const endInput = end.createEl('input', { type: 'time', value: draft.endTime });

    const dateRow = scheduleSection.createDiv({ cls: 'twe-editor-row' });
    const scheduled = this.createField(dateRow, '计划处理日');
    const scheduledInput = scheduled.createEl('input', { type: 'date', value: draft.scheduled });
    const due = this.createField(dateRow, '截止日');
    const dueInput = due.createEl('input', { type: 'date', value: draft.due });

    const classifySection = form.createDiv({ cls: 'twe-editor-section' });
    const metaRow = classifySection.createDiv({ cls: 'twe-editor-row' });
    const workflowField = this.createField(metaRow, '安排到');
    const workflowSelect = workflowField.createEl('select');
    workflowSelect.createEl('option', { value: '', text: '暂不安排' });
    TRIAGE_ACTIONS.forEach((action) => workflowSelect.createEl('option', { value: action.tag, text: action.label }));
    workflowSelect.value = draft.workflowTag;

    const projectField = this.createField(metaRow, '所属项目');
    const projectSelect = projectField.createEl('select');
    projectSelect.createEl('option', { value: '', text: '无项目' });
    this.plugin.cachedProjectTags.forEach((tag) => projectSelect.createEl('option', { value: tag, text: `#${tag}` }));
    projectSelect.value = draft.projectTag;

    const detailRow = classifySection.createDiv({ cls: 'twe-editor-row' });
    const complexityField = this.createField(detailRow, '复杂度');
    const complexitySelect = complexityField.createEl('select');
    complexitySelect.createEl('option', { value: '', text: '未指定' });
    COMPLEXITY_OPTIONS.forEach((option) => {
      complexitySelect.createEl('option', { value: option.tag, text: option.label });
    });
    complexitySelect.value = draft.complexityTag;

    const doneField = this.createField(detailRow, '状态');
    const doneWrap = doneField.createDiv({ cls: 'twe-checkbox-row' });
    const doneInput = doneWrap.createEl('input', { type: 'checkbox' });
    doneInput.checked = draft.done;
    doneWrap.createSpan({ text: '标记为已完成' });

    const followupSection = form.createDiv({ cls: 'twe-editor-section' });
    const followupRow = followupSection.createDiv({ cls: 'twe-editor-row' });
    const ownerField = this.createField(followupRow, '责任人');
    const ownerInput = ownerField.createEl('input', { type: 'text', value: draft.owner || '' });
    ownerInput.placeholder = '例如：吴娟 / 供应商A';

    const itemField = this.createField(followupRow, '事项');
    const itemInput = itemField.createEl('input', { type: 'text', value: draft.item || '' });
    itemInput.placeholder = '例如：确认审批结果 / 解决接口报错';

    const followupTimeRow = followupSection.createDiv({ cls: 'twe-editor-row' });
    const confirmByField = this.createField(followupTimeRow, '确认截止');
    const confirmByInput = confirmByField.createEl('input', { type: 'date', value: draft.confirmBy || '' });

    const etaField = this.createField(followupTimeRow, '预计完成');
    const etaInput = etaField.createEl('input', { type: 'date', value: draft.eta || '' });

    const refreshFollowupSection = () => {
      const tag = workflowSelect.value;
      if (tag === '#WAIT' || tag === '#BLOCKED') {
        followupSection.style.display = '';
        confirmByField.style.display = tag === '#WAIT' ? '' : 'none';
        etaField.style.display = tag === '#BLOCKED' ? '' : 'none';
      } else {
        followupSection.style.display = 'none';
      }
    };
    workflowSelect.addEventListener('change', refreshFollowupSection);
    refreshFollowupSection();

    const notesSection = form.createDiv({ cls: 'twe-editor-section' });
    const notesField = this.createField(notesSection, '补充说明');
    const notesInput = notesField.createEl('textarea');
    notesInput.value = draft.note || '';
    notesInput.placeholder = '补充上下文、依赖人、提醒事项…';
    notesInput.rows = 4;
    const noteMediaActions = notesSection.createDiv({ cls: 'twe-note-actions' });
    const addImageButton = noteMediaActions.createEl('button', {
      cls: 'twe-detail-button',
      text: '添加图片',
      attr: { type: 'button' },
    });
    addImageButton.addEventListener('click', async () => {
      addImageButton.disabled = true;
      addImageButton.setText('上传中...');
      try {
        await this.plugin.pickTaskImagesAndAppend(notesInput);
      } finally {
        if (addImageButton.isConnected) {
          addImageButton.disabled = false;
          addImageButton.setText('添加图片');
        }
      }
    });
    const syncNotesButton = noteMediaActions.createEl('button', {
      cls: 'twe-detail-button twe-detail-button-secondary',
      text: '同步主子说明',
      attr: { type: 'button' },
    });
    syncNotesButton.addEventListener('click', () => {
      const subtasks = Array.isArray(draft.subtasks) ? draft.subtasks : [];
      notesInput.value = this.plugin.upsertSubtaskSyncSummary(notesInput.value, subtasks);
      new Notice(subtasks.length ? '已同步子任务说明到主任务备注' : '当前没有子任务，已插入空白汇总区块');
    });

    const actions = panel.createDiv({ cls: 'twe-detail-actions twe-editor-actions' });
    const cancel = actions.createEl('button', { cls: 'twe-detail-button', text: '取消' });
    cancel.addEventListener('click', async () => {
      this.isCreatingTask = false;
      await this.render();
    });
    const save = actions.createEl('button', { cls: 'twe-detail-button mod-cta', text: task ? '保存修改' : '创建任务' });
    save.addEventListener('click', async () => {
      if (save.disabled) return;
      save.disabled = true;
      save.setText(task ? '保存中...' : '创建中...');
      try {
        await this.saveTaskFromForm(task, {
          title: titleInput,
          startTime: startInput,
          endTime: endInput,
          scheduled: scheduledInput,
          due: dueInput,
          workflowTag: workflowSelect,
          projectTag: projectSelect,
          complexityTag: complexitySelect,
          owner: ownerInput,
          item: itemInput,
          confirmBy: confirmByInput,
          eta: etaInput,
          subtasks: draft.subtasks || [],
          note: notesInput,
          done: doneInput,
        });
      } finally {
        if (save.isConnected) {
          save.disabled = false;
          save.setText(task ? '保存修改' : '创建任务');
        }
      }
    });

    if (task) {
      const raw = panel.createDiv({ cls: 'twe-detail-block' });
      raw.createEl('div', { cls: 'twe-detail-label', text: '原始记录' });
      raw.createEl('div', { cls: 'twe-detail-value twe-detail-raw', text: task.raw });
    }
  }

  createField(container, label) {
    const field = container.createDiv({ cls: 'twe-editor-field' });
    field.createEl('label', { cls: 'twe-detail-label', text: label });
    return field;
  }

  createActionButton(container, icon, label, handler) {
    const button = container.createEl('button', {
      cls: 'twe-detail-button',
      attr: { 'aria-label': label },
    });
    setIcon(button, icon);
    button.createSpan({ text: label });
    button.addEventListener('click', async () => {
      await handler();
      await this.render();
    });
  }

  getTaskKey(task) {
    return `${task.path}:${task.line}`;
  }

  getTaskEditorDraft(task) {
    const draft = this.plugin.taskToFormState(task);
    if (task) return draft;

    if (this.timeScope === 'tomorrow' && !draft.scheduled) {
      draft.scheduled = window.moment().add(1, 'day').format('YYYY-MM-DD');
    }
    if (this.timeScope === 'today' && !draft.scheduled) {
      draft.scheduled = window.moment().format('YYYY-MM-DD');
    }
    return draft;
  }

  getTomorrowCardState(task, tomorrow) {
    if (this.timeScope !== 'tomorrow' || !tomorrow || task.done || task.archived) return '';
    if (task.scheduled === tomorrow && !task.timeRange) return 'tomorrow-unslotted';
    if (task.due === tomorrow && task.scheduled !== tomorrow) return 'tomorrow-due';
    if (
      task.workflowTags.includes('#WAIT')
      || task.workflowTags.includes('#BLOCKED')
      || task.workflowTags.includes('#weekly')
    ) return 'tomorrow-rolling';
    return '';
  }

  persistViewState() {
    this.plugin.setTodayWorkspaceState({
      activeTab: this.activeTab,
      timeScope: this.timeScope,
      folderScope: this.folderScope,
      topNavCollapsed: this.topNavCollapsed,
      selectedTaskKey: this.selectedTaskKey,
      selectedProject: this.selectedProject,
      sidebarWidth: this.sidebarWidth,
      detailWidth: this.detailWidth,
      expandedTaskKeys: Array.from(this.expandedTaskKeys),
    });
  }
}

module.exports = { TodayPanelView };
