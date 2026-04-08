const {
  ItemView,
  setIcon,
} = require('obsidian');
const { PROJECT_VIEW_TYPE } = require('../constants');

class ProjectPanelView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.selectedProject = '';
  }

  getViewType() {
    return PROJECT_VIEW_TYPE;
  }

  getDisplayText() {
    return 'Project';
  }

  getIcon() {
    return 'folder-kanban';
  }

  async onOpen() {
    this.contentEl.empty();
    this.contentEl.addClass('twe-project-view');
    if (!this.app.workspace.layoutReady) {
      this.contentEl.createDiv({ cls: 'twe-project-empty', text: '正在加载项目数据…' });
      return;
    }
    await this.render();
  }

  async render() {
    const { contentEl } = this;
    contentEl.empty();

    const header = contentEl.createDiv({ cls: 'twe-project-header' });
    const titleWrap = header.createDiv({ cls: 'twe-project-header-copy' });
    titleWrap.createEl('h2', { text: '项目中心' });
    titleWrap.createDiv({ cls: 'twe-list-subtitle', text: '按项目聚合任务、风险、进度与下一步。' });

    const summaries = await this.plugin.collectProjectSummaries();
    if (!this.selectedProject && summaries.length > 0) {
      this.selectedProject = summaries[0].tag;
    }
    if (this.selectedProject && !summaries.some((item) => item.tag === this.selectedProject)) {
      this.selectedProject = summaries[0]?.tag || '';
    }

    if (!this.selectedProject) {
      contentEl.createDiv({ cls: 'twe-project-empty', text: '还没有可用的项目标签。请先在 Projects 目录里维护带 project_tag 的项目文件。' });
      return;
    }

    const selectedSummary = summaries.find((item) => item.tag === this.selectedProject) || summaries[0];
    const [projectInfo, data] = await Promise.all([
      this.plugin.getProjectInfo(this.selectedProject),
      this.plugin.getProjectData(this.selectedProject),
    ]);

    const shell = contentEl.createDiv({ cls: 'twe-project-shell' });
    const sidebar = shell.createDiv({ cls: 'twe-project-panel twe-project-panel-overview twe-project-catalog' });
    const main = shell.createDiv({ cls: 'twe-project-panel twe-project-panel-list twe-project-main' });
    const detail = shell.createDiv({ cls: 'twe-project-panel twe-project-panel-detail twe-project-detail' });

    this.renderProjectCatalog(sidebar, summaries, selectedSummary);
    this.renderProjectMain(main, projectInfo, data);
    this.renderProjectDetail(detail, projectInfo, data);
  }

  renderProjectCatalog(container, summaries, selectedSummary) {
    container.createEl('h3', { text: '项目列表' });
    const list = container.createDiv({ cls: 'twe-project-catalog-list' });

    summaries.forEach((summary) => {
      const item = list.createEl('button', {
        cls: `twe-project-catalog-item${summary.tag === selectedSummary.tag ? ' is-active' : ''}`,
      });
      const header = item.createDiv({ cls: 'twe-project-catalog-item-top' });
      header.createDiv({ cls: 'twe-project-catalog-item-title', text: summary.title });
      if (summary.status) {
        header.createDiv({ cls: 'twe-chip', text: summary.status });
      }

      const meta = item.createDiv({ cls: 'twe-project-catalog-item-meta' });
      if (summary.owner) meta.createDiv({ cls: 'twe-chip', text: `责任人：${summary.owner}` });
      if (summary.phase) meta.createDiv({ cls: 'twe-chip', text: `阶段：${summary.phase}` });

      const counts = item.createDiv({ cls: 'twe-project-catalog-counts' });
      counts.createDiv({ cls: 'twe-project-catalog-count' }).setText(`进行中 ${summary.openCount}`);
      counts.createDiv({ cls: 'twe-project-catalog-count is-waiting' }).setText(`等待 ${summary.waitingCount}`);
      counts.createDiv({ cls: 'twe-project-catalog-count is-blocked' }).setText(`阻塞 ${summary.blockedCount}`);

      item.addEventListener('click', async () => {
        this.selectedProject = summary.tag;
        await this.render();
      });
    });
  }

  renderProjectMain(container, projectInfo, data) {
    const title = projectInfo?.title || this.selectedProject;
    const overview = container.createDiv({ cls: 'twe-project-overview' });
    const titleRow = overview.createDiv({ cls: 'twe-project-overview-title' });
    titleRow.createEl('h3', { text: title });

    const overviewActions = titleRow.createDiv({ cls: 'twe-project-header-actions' });
    if (projectInfo?.path) {
      const openBtn = overviewActions.createEl('button', {
        cls: 'clickable-icon',
        attr: { 'aria-label': '打开项目文件' },
      });
      setIcon(openBtn, 'arrow-up-right');
      openBtn.addEventListener('click', async () => {
        await this.plugin.openFileByPath(projectInfo.path);
      });
    }
    const reportBtn = overviewActions.createEl('button', {
      cls: 'twe-top-nav-report',
      text: '项目周报',
      attr: { 'aria-label': '生成项目周报' },
    });
    reportBtn.addEventListener('click', async () => {
      await this.plugin.openWeeklyReportModal(null, title, this.selectedProject);
    });
    const addBtn = overviewActions.createEl('button', {
      cls: 'twe-list-add-button',
      text: '新建任务',
    });
    addBtn.addEventListener('click', async () => {
      await this.plugin.openProjectTaskCreateModal(this.selectedProject);
    });

    const facts = overview.createDiv({ cls: 'twe-project-facts' });
    if (projectInfo?.status) facts.createDiv({ cls: 'twe-chip', text: projectInfo.status });
    if (projectInfo?.phase) facts.createDiv({ cls: 'twe-chip', text: `阶段：${projectInfo.phase}` });
    if (projectInfo?.owner) facts.createDiv({ cls: 'twe-chip', text: `责任人：${projectInfo.owner}` });
    if (projectInfo?.targetDate) facts.createDiv({ cls: 'twe-chip', text: `目标日期：${projectInfo.targetDate}` });
    if (projectInfo?.area) facts.createDiv({ cls: 'twe-chip', text: `领域：${projectInfo.area}` });

    const notes = overview.createDiv({ cls: 'twe-project-notes' });
    if (projectInfo?.goal) notes.createDiv({ cls: 'twe-project-note', text: `目标：${projectInfo.goal}` });
    if (projectInfo?.focus) notes.createDiv({ cls: 'twe-project-note', text: `当前重点：${projectInfo.focus}` });
    if (projectInfo?.nextAction) notes.createDiv({ cls: 'twe-project-note', text: `下一步：${projectInfo.nextAction}` });
    if (projectInfo?.risk) notes.createDiv({ cls: 'twe-project-note', text: `风险 / 阻塞：${projectInfo.risk}` });

    const summary = container.createDiv({ cls: 'twe-project-summary' });
    this.createSummaryCard(summary, '进行中', data.openTasks.length);
    this.createSummaryCard(summary, '等待确认', data.waitingTasks.length, 'is-waiting');
    this.createSummaryCard(summary, '明确阻塞', data.blockedTasks.length, 'is-blocked');
    this.createSummaryCard(summary, '本周相关', data.thisWeekTasks.length);

    this.renderTaskSection(container, '当前推进', data.openTasks, { emptyText: '当前没有推进中的项目任务。' });
    this.renderTaskSection(container, '等待确认', data.waitingTasks, { emptyText: '暂无等待确认任务。' });
    this.renderTaskSection(container, '明确阻塞', data.blockedTasks, { emptyText: '暂无阻塞任务。' });
    this.renderTaskSection(container, '本周项目任务', data.thisWeekTasks, { emptyText: '本周暂无相关项目任务。' });
  }

  renderProjectDetail(container, projectInfo, data) {
    container.createEl('h3', { text: '项目摘要' });

    const nextBlock = container.createDiv({ cls: 'twe-project-overview twe-project-side-block' });
    nextBlock.createDiv({ cls: 'twe-project-side-title', text: '下一步' });
    nextBlock.createDiv({
      cls: 'twe-project-note',
      text: projectInfo?.nextAction || '还没有明确的下一步，可在项目文件 frontmatter 的 next_action 或正文里维护。',
    });

    const riskBlock = container.createDiv({ cls: 'twe-project-overview twe-project-side-block twe-project-side-risk' });
    riskBlock.createDiv({ cls: 'twe-project-side-title', text: '风险与阻塞' });
    if (data.blockedTasks.length || data.waitingTasks.length || projectInfo?.risk) {
      if (projectInfo?.risk) {
        riskBlock.createDiv({ cls: 'twe-project-note', text: projectInfo.risk });
      }
      [...data.blockedTasks.slice(0, 3), ...data.waitingTasks.slice(0, 3)].slice(0, 4).forEach((task) => {
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

    this.renderTaskSection(container, '最近完成', data.doneTasks, { emptyText: '最近没有完成记录。', compact: true });
  }

  renderTaskSection(container, title, tasks, options = {}) {
    const section = container.createDiv({ cls: `twe-project-section${options.compact ? ' is-compact' : ''}` });
    section.createEl('h3', { text: `${title} · ${tasks.length}` });

    if (!tasks.length) {
      section.createDiv({ cls: 'twe-project-empty', text: options.emptyText || '暂无数据。' });
      return;
    }

    const list = section.createDiv({ cls: 'twe-project-list' });
    tasks.forEach((task) => {
      const card = list.createDiv({ cls: 'twe-project-card' });
      const top = card.createDiv({ cls: 'twe-project-card-top' });
      top.createDiv({ cls: 'twe-project-card-title', text: task.title });

      const actions = top.createDiv({ cls: 'twe-project-card-actions' });
      if (!task.done) {
        const completeBtn = actions.createEl('button', {
          cls: 'clickable-icon',
          attr: { 'aria-label': '完成任务' },
        });
        setIcon(completeBtn, 'check');
        completeBtn.addEventListener('click', async (evt) => {
          evt.stopPropagation();
          await this.plugin.completeTask(task);
          await this.render();
        });
        const archiveBtn = actions.createEl('button', {
          cls: 'clickable-icon',
          attr: { 'aria-label': '归档任务' },
        });
        setIcon(archiveBtn, 'archive');
        archiveBtn.addEventListener('click', async (evt) => {
          evt.stopPropagation();
          await this.plugin.openArchiveTaskModal(task);
          await this.render();
        });
      }
      const workspaceBtn = actions.createEl('button', {
        cls: 'clickable-icon',
        attr: { 'aria-label': '在任务工作台中查看' },
      });
      setIcon(workspaceBtn, 'list-todo');
      workspaceBtn.addEventListener('click', async (evt) => {
        evt.stopPropagation();
        await this.plugin.openTaskInWorkspace(task);
      });
      const openBtn = actions.createEl('button', {
        cls: 'clickable-icon',
        attr: { 'aria-label': '打开任务来源' },
      });
      setIcon(openBtn, 'arrow-up-right');
      openBtn.addEventListener('click', async (evt) => {
        evt.stopPropagation();
        await this.plugin.openTaskLocation(task);
      });

      const meta = card.createDiv({ cls: 'twe-project-card-meta' });
      if (task.timeRange) meta.createDiv({ cls: 'twe-chip', text: task.timeRange });
      if (task.scheduled) meta.createDiv({ cls: 'twe-chip', text: `⏳ ${task.scheduled}` });
      if (task.due) meta.createDiv({ cls: 'twe-chip', text: `📅 ${task.due}` });
      if (task.completed) meta.createDiv({ cls: 'twe-chip', text: `✅ ${task.completed}` });
      if (task.path) meta.createDiv({ cls: 'twe-chip', text: task.path });
    });
  }

  createSummaryCard(container, label, value, extraCls = '') {
    const card = container.createDiv({ cls: `twe-summary-card${extraCls ? ` ${extraCls}` : ''}` });
    card.createDiv({ cls: 'twe-status-card-value', text: String(value) });
    card.createDiv({ cls: 'twe-status-card-label', text: label });
  }
}

module.exports = { ProjectPanelView };
