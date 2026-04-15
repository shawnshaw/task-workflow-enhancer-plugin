const {
  Plugin,
  Notice,
  MarkdownView,
  ItemView,
  setIcon,
} = require('obsidian');
const { EditorView, Decoration, WidgetType, ViewPlugin } = require('@codemirror/view');
const { StateField } = require('@codemirror/state');
const {
  WORKFLOW_TAGS,
  TODAY_VIEW_TYPE,
  PROJECT_VIEW_TYPE,
  DEFAULT_INBOX_PATH,
  DEFAULT_ARCHIVE_ROOT,
  DEFAULT_BACKUP_ROOT,
  DEFAULT_WORKSPACE_ROOT,
  COMPLEXITY_TAGS,
  SUBTASK_SYNC_BLOCK_TITLE,
  DEFAULT_WORKSPACE_TABS,
  DEFAULT_DATA_SOURCES,
  EMPTY_TAB_FOLDER_SCOPE,
} = require('./constants');
const {
  escapeRegExp,
  normalizeSpace,
  todayString,
  extractDateToken,
  extractTimeRange,
  stripTaskMetadata,
} = require('./utils');
const taskLogic = require('./task-logic');
const reports = require('./reports');
const taskRepository = require('./core/task-repository');
const projectService = require('./core/project-service');
const taskEditing = require('./features/task-editing');
const taskNotes = require('./features/task-notes');
const {
  TimeRangeModal,
  TriageButtonModal,
  ArchiveTaskModal,
  SubtaskArchiveModal,
  DatePickerModal,
  SubtaskEditorModal,
  WeeklyReportModal,
  ProjectTagModal,
  WorkspaceTabsModal,
  TaskCreateModal,
  TaskWorkflowSettingTab,
} = require('./ui/modals');
const { TodayPanelView } = require('./views/today-panel-view');
const { ProjectPanelView } = require('./views/project-panel-view');
const { EmbeddedWorkspaceRenderer } = require('./core/embedded-workspace');

class TaskWorkflowEnhancerPlugin extends Plugin {
  async onload() {
    this.stateStore = Object.assign({
      todayWorkspaceState: null,
      workspaceTabs: DEFAULT_WORKSPACE_TABS,
      dataSources: DEFAULT_DATA_SOURCES,
      openViews: { today: false, project: false },
    }, await this.loadData());
    this.stateSaveTimer = null;
    this.stateStore.workspaceTabs = this.normalizeWorkspaceTabs(this.stateStore.workspaceTabs);
    this.stateStore.dataSources = this.getDataSources();
    await this.ensureTaskStorageInitialized();
    this.cachedProjectTags = await this.collectProjectTags();
    this.addSettingTab(new TaskWorkflowSettingTab(this.app, this));
    this.registerView(
      TODAY_VIEW_TYPE,
      (leaf) => new TodayPanelView(leaf, this)
    );
    this.registerView(
      PROJECT_VIEW_TYPE,
      (leaf) => new ProjectPanelView(leaf, this)
    );

    this.registerEditorExtension(this.buildInlineActionExtension());
    this.addCommand({
      id: 'insert-task-time-range',
      name: '任务：插入时间段',
      editorCallback: (editor, view) => this.openTimeRangeModal(editor, view),
    });
    this.addCommand({
      id: 'triage-current-task',
      name: '任务：分拣当前任务',
      editorCallback: (editor, view) => this.openTriageModal(editor, view),
    });
    this.addCommand({
      id: 'set-project-tag',
      name: '任务：设置项目标签',
      editorCallback: (editor, view) => this.openProjectTagModal(editor, view),
    });
    this.addCommand({
      id: 'set-task-dates',
      name: '任务：设置日期',
      editorCallback: (editor, view) => this.openDateModal(editor, view),
    });
    this.addCommand({
      id: 'open-today-panel',
      name: '打开任务工作台',
      callback: async () => this.activateTodayPanel(),
    });
    this.addCommand({
      id: 'open-project-panel',
      name: '打开 Project 面板',
      callback: async () => this.activateProjectPanel(),
    });
    this.addCommand({
      id: 'generate-weekly-report',
      name: '任务：生成周报汇总',
      callback: async () => this.openWeeklyReportModal(),
    });
    this.addCommand({
      id: 'reload-task-plugin',
      name: '任务：重载插件',
      callback: async () => this.reloadSelf(),
    });
    this.addCommand({
      id: 'compact-work-source',
      name: '任务：整理工作源文件',
      callback: async () => {
        await this.compactPrimaryInboxSource();
        await this.refreshTodayViews();
        new Notice('已整理工作源文件');
      },
    });

    this.registerEvent(
      this.app.workspace.on('editor-menu', (menu, editor, view) => {
        if (!this.getTaskContext(editor, view)) return;
        menu.addItem((item) => item
          .setTitle('选择时间段')
          .setIcon('clock-3')
          .onClick(() => this.openTimeRangeModal(editor, view)));
        menu.addItem((item) => item
          .setTitle('分拣当前任务')
          .setIcon('list-checks')
          .onClick(() => this.openTriageModal(editor, view)));
        menu.addItem((item) => item
          .setTitle('设置日期')
          .setIcon('calendar-days')
          .onClick(() => this.openDateModal(editor, view)));
        menu.addItem((item) => item
          .setTitle('设置项目标签')
          .setIcon('folder-tree')
          .onClick(() => this.openProjectTagModal(editor, view)));
      })
    );

    this.registerEvent(
      this.app.vault.on('modify', async (file) => {
        if (file.path === this.getInboxPath()) await this.refreshTodayViews();
        if (file.path.startsWith('Projects/')) {
          this.cachedProjectTags = await this.collectProjectTags();
        }
      })
    );

    let layoutChangeTimer = null;
    this.registerEvent(
      this.app.workspace.on('layout-change', () => {
        clearTimeout(layoutChangeTimer);
        layoutChangeTimer = setTimeout(() => this.captureOpenViewState(), 300);
      })
    );

    this.registerMarkdownCodeBlockProcessor('task-workflow', async (source, el) => {
      const config = this.parseTaskWorkflowBlock(source);
      if (config.view === 'today') {
        const embeddedRenderer = new EmbeddedWorkspaceRenderer(this);
        await embeddedRenderer.render(el);
        return;
      }

      el.createDiv({ text: `暂不支持的工作流视图：${config.view || 'unknown'}` });
    });

    this.app.workspace.onLayoutReady(() => {
      window.setTimeout(async () => {
        await this.restoreCustomViewsOnStartup();
        await this.refreshAllCustomViews();
      }, 80);
    });

    this.registerEvent(
      this.app.metadataCache.on('resolved', () => {
        if (this._metadataCacheResolved) return;
        this._metadataCacheResolved = true;
        window.setTimeout(async () => {
          this.cachedProjectTags = await this.collectProjectTags();
          await this.refreshAllCustomViews();
        }, 200);
      })
    );
  }

  onunload() {
    this.captureOpenViewState();
    if (this.stateSaveTimer) {
      window.clearTimeout(this.stateSaveTimer);
      this.stateSaveTimer = null;
    }
    if (this.stateStore) {
      void this.saveData(this.stateStore);
    }
  }

  getTodayWorkspaceState() {
    return this.stateStore?.todayWorkspaceState || null;
  }

  captureOpenViewState() {
    this.stateStore = this.stateStore || {};
    this.stateStore.openViews = {
      today: this.app.workspace.getLeavesOfType(TODAY_VIEW_TYPE).length > 0,
      project: this.app.workspace.getLeavesOfType(PROJECT_VIEW_TYPE).length > 0,
    };
    this.queueStateSave();
  }

  async restoreCustomViewsOnStartup() {
    const openViews = this.stateStore?.openViews || {};
    if (openViews.today && this.app.workspace.getLeavesOfType(TODAY_VIEW_TYPE).length === 0) {
      await this.activateTodayPanel();
    }
    if (openViews.project && this.app.workspace.getLeavesOfType(PROJECT_VIEW_TYPE).length === 0) {
      await this.activateProjectPanel();
    }
    this.captureOpenViewState();
  }

  async openWorkspaceTabsModal(activeTabId) {
    new WorkspaceTabsModal(this.app, this, this.getWorkspaceTabs(), async (tabs) => {
      await this.saveWorkspaceTabs(tabs);
      const nextActive = tabs.some((tab) => tab.id === activeTabId) ? activeTabId : tabs[0]?.id || 'today';
      const currentState = this.getTodayWorkspaceState() || {};
      this.setTodayWorkspaceState(Object.assign({}, currentState, { activeTab: nextActive }));
      await this.refreshTodayViews();
      const leaves = this.app.workspace.getLeavesOfType(TODAY_VIEW_TYPE);
      for (const leaf of leaves) {
        const view = leaf.view;
        if (view instanceof TodayPanelView) {
          view.activeTab = nextActive;
          await view.render();
        }
      }
    }).open();
  }

  setTodayWorkspaceState(nextState) {
    this.stateStore = this.stateStore || { todayWorkspaceState: null };
    this.stateStore.todayWorkspaceState = nextState;
    this.queueStateSave();
  }

  queueStateSave() {
    if (this.stateSaveTimer) window.clearTimeout(this.stateSaveTimer);
    this.stateSaveTimer = window.setTimeout(() => {
      this.stateSaveTimer = null;
      void this.saveData(this.stateStore);
    }, 180);
  }

  async reloadSelf() {
    const pluginId = this.manifest?.id;
    if (!pluginId) {
      new Notice('未找到当前插件 ID，无法重载');
      return;
    }
    new Notice('正在重载任务插件...');
    window.setTimeout(async () => {
      try {
        await this.app.plugins.disablePlugin(pluginId);
        await this.app.plugins.enablePlugin(pluginId);
        new Notice('任务插件已重载完成');
      } catch (error) {
        console.error(error);
        new Notice('插件重载失败，请手动在插件设置里重启');
      }
    }, 30);
  }

  buildInlineActionExtension() {
    const plugin = this;

    class TaskActionWidget extends WidgetType {
      constructor(lineNumber) {
        super();
        this.lineNumber = lineNumber;
      }

      eq(other) {
        return other.lineNumber === this.lineNumber;
      }

      toDOM() {
        const wrap = document.createElement('span');
        wrap.className = 'twe-inline-actions';

        const createButton = (label, title, handler) => {
          const button = document.createElement('button');
          button.className = 'twe-inline-button';
          button.type = 'button';
          button.title = title;
          setIcon(button, label);
          button.addEventListener('mousedown', (evt) => {
            evt.preventDefault();
            evt.stopPropagation();
          });
          button.addEventListener('click', (evt) => {
            evt.preventDefault();
            evt.stopPropagation();
            const activeView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
            const editor = activeView && activeView.editor;
            if (!activeView || !editor) {
              new Notice('当前没有可用的编辑器');
              return;
            }
            editor.setCursor({ line: this.lineNumber, ch: editor.getLine(this.lineNumber).length });
            handler(editor, activeView);
          });
          return button;
        };

        wrap.appendChild(createButton('clock-3', '选择时间段', (editor, view) => plugin.openTimeRangeModal(editor, view)));
        wrap.appendChild(createButton('list-checks', '分拣当前任务', (editor, view) => plugin.openTriageModal(editor, view)));
        wrap.appendChild(createButton('calendar-days', '设置日期', (editor, view) => plugin.openDateModal(editor, view)));
        wrap.appendChild(createButton('folder-tree', '设置项目标签', (editor, view) => plugin.openProjectTagModal(editor, view)));
        return wrap;
      }
    }

    const taskActionField = StateField.define({
      create(state) {
        return buildDecorations(state);
      },
      update(decorations, tr) {
        if (tr.docChanged || tr.selection) {
          return buildDecorations(tr.state);
        }
        return decorations.map(tr.changes);
      },
      provide(field) {
        return EditorView.decorations.from(field);
      },
    });

    function buildDecorations(state) {
      const lineNumber = state.selection.main.head;
      const line = state.doc.lineAt(lineNumber);
      const isTask = /^([-*+]\s+\[[ xX]\]\s+)(.*)$/.test(line.text);
      if (!isTask) return Decoration.none;
      return Decoration.set([
        Decoration.widget({
          widget: new TaskActionWidget(line.number),
          side: 1,
        }).range(line.to),
      ]);
    }

    return [
      taskActionField,
      ViewPlugin.fromClass(class {}),
    ];
  }

  async activateTodayPanel(options = {}) {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(TODAY_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getLeaf(true);
      await leaf.setViewState({ type: TODAY_VIEW_TYPE, active: true });
    }
    workspace.revealLeaf(leaf);
    const view = leaf.view;
    if (view instanceof TodayPanelView) {
      if (options.activeTab) view.activeTab = options.activeTab;
      if (options.timeScope) view.timeScope = options.timeScope;
      if (options.folderScope) view.folderScope = options.folderScope;
      if (typeof options.selectedTaskKey === 'string') {
        view.isCreatingTask = false;
        view.selectedTaskKey = options.selectedTaskKey;
      }
      view.persistViewState();
      await view.render();
    }
    this.captureOpenViewState();
  }

  async activateProjectPanel(projectTag = '') {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(PROJECT_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      await leaf.setViewState({ type: PROJECT_VIEW_TYPE, active: true });
    }
    workspace.revealLeaf(leaf);
    const view = leaf.view;
    if (view instanceof ProjectPanelView) {
      if (projectTag) view.selectedProject = projectTag;
      await view.render();
    }
    this.captureOpenViewState();
  }

  getWorkspaceTabForTask(task) {
    const tabs = this.getWorkspaceTabs();
    if (task?.path && task.path !== this.getInboxPath()) {
      const matched = tabs.find((tab) => tab.type === 'workspace' && tab.sourcePath === task.path);
      if (matched) return matched;
    }
    return tabs.find((tab) => tab.id === 'today')
      || tabs.find((tab) => tab.type === 'workspace' && !tab.sourcePath)
      || tabs[0]
      || null;
  }

  async openTaskInWorkspace(task) {
    if (!task) return;
    const tab = this.getWorkspaceTabForTask(task);
    const folderScope = task.archived
      ? (task.archiveType === 'knowledge' ? 'archive_knowledge' : task.archiveType === 'evidence' ? 'archive_evidence' : 'archived')
      : task.done ? 'done' : 'all';
    await this.activateTodayPanel({
      activeTab: tab?.id || 'today',
      timeScope: 'all',
      folderScope,
      selectedTaskKey: this.getTaskKey(task),
    });
  }

  async openProjectByTag(projectTag) {
    if (!projectTag) return;
    await this.activateProjectPanel(projectTag);
  }

  async refreshTodayViews() {
    const leaves = this.app.workspace.getLeavesOfType(TODAY_VIEW_TYPE);
    for (const leaf of leaves) {
      const view = leaf.view;
      if (view instanceof TodayPanelView) {
        await view.render();
      }
    }
  }

  async refreshAllCustomViews() {
    const todayLeaves = this.app.workspace.getLeavesOfType(TODAY_VIEW_TYPE);
    for (const leaf of todayLeaves) {
      if (leaf.view instanceof TodayPanelView) {
        await leaf.view.render();
      }
    }
    const projectLeaves = this.app.workspace.getLeavesOfType(PROJECT_VIEW_TYPE);
    for (const leaf of projectLeaves) {
      if (leaf.view instanceof ProjectPanelView) {
        await leaf.view.render();
      }
    }
  }

  parseTaskWorkflowBlock(source) {
    const config = {};
    source.split('\n').forEach((line) => {
      const [rawKey, ...rest] = line.split(':');
      if (!rawKey || rest.length === 0) return;
      const key = rawKey.trim();
      const value = rest.join(':').trim();
      if (!key) return;
      config[key] = value;
    });
    return config;
  }

  getTaskKey(task) {
    return `${task.path}:${task.line}`;
  }

  extractWorkflowTags(text) {
    return WORKFLOW_TAGS.filter((tag) => text.includes(tag));
  }

  extractComplexityTag(text) {
    return COMPLEXITY_TAGS.find((tag) => text.includes(tag)) || '';
  }

  isTodayDate(dateString) {
    return taskLogic.isTodayDate(dateString, todayString());
  }

  isTomorrowDate(dateString) {
    return taskLogic.isTomorrowDate(dateString, window.moment().add(1, 'day').format('YYYY-MM-DD'));
  }

  isDateInCurrentMonth(dateString) {
    return taskLogic.isDateInCurrentMonth(dateString, window.moment);
  }

  isOverdueTask(task) {
    return taskLogic.isOverdueTask(task, todayString());
  }

  taskMatchesTimeScope(task, scope) {
    return taskLogic.taskMatchesTimeScope(task, scope, {
      today: todayString(),
      tomorrow: window.moment().add(1, 'day').format('YYYY-MM-DD'),
      moment: window.moment,
      isDateInCurrentWeek: (dateString) => this.isDateInCurrentWeek(dateString),
    });
  }

  taskMatchesFolderScope(task, scope) {
    return taskLogic.taskMatchesFolderScope(task, scope, {
      isDateInCurrentWeek: (dateString) => this.isDateInCurrentWeek(dateString),
    });
  }

  isWeeklyTaskActiveToday(task) {
    return taskLogic.isWeeklyTaskActiveToday(task, {
      isDateInCurrentWeek: (dateString) => this.isDateInCurrentWeek(dateString),
    });
  }

  buildTodayFolderCounts(tasks) {
    return taskLogic.buildTodayFolderCounts(tasks, {
      isDateInCurrentWeek: (dateString) => this.isDateInCurrentWeek(dateString),
    });
  }

  getTaskVisualState(task) {
    return taskLogic.getTaskVisualState(task);
  }

  buildTaskStatusSummary(tasks) {
    return taskLogic.buildTaskStatusSummary(tasks);
  }

  buildTaskDisplaySections(tasks, folderScope = 'all') {
    return taskLogic.buildTaskDisplaySections(tasks, folderScope);
  }

  getFolderScopeLabel(scope) {
    return taskLogic.getFolderScopeLabel(scope);
  }



  getWeekBounds() {
    const start = window.moment().startOf('isoWeek');
    const end = window.moment().endOf('isoWeek');
    return { start, end };
  }

  isDateInCurrentWeek(dateString) {
    if (!dateString) return false;
    const date = window.moment(dateString, 'YYYY-MM-DD', true);
    if (!date.isValid()) return false;
    const { start, end } = this.getWeekBounds();
    return date.isBetween(start, end, 'day', '[]');
  }

  isDateInNextWeek(dateString) {
    return reports.isDateInNextWeek(dateString, window.moment);
  }

  formatTaskSummaryLine(task, options = {}) {
    return reports.formatTaskSummaryLine(task, options);
  }

  buildWeeklyReportText(data) {
    return reports.buildWeeklyReportText(data);
  }

  async generateWeeklyReport(sourcePath, sourceLabel = '任务', projectTag = '') {
    let tasks;
    if (projectTag) {
      const data = await this.getProjectData(projectTag);
      tasks = [...data.openTasks, ...data.waitingTasks, ...data.blockedTasks, ...data.doneTasks, ...data.thisWeekTasks];
      const seen = new Set();
      tasks = tasks.filter((t) => {
        const key = `${t.path}:${t.line}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    } else {
      tasks = await this.getTasksFromSource(sourcePath || this.getInboxPath());
    }
    return reports.generateWeeklyReportFromTasks(tasks, sourceLabel, {
      moment: window.moment,
      extractFollowupMeta: (note) => this.extractFollowupMeta(note),
      extractSubtasksFromNote: (note) => this.extractSubtasksFromNote(note),
      isDateInCurrentWeek: (dateString) => this.isDateInCurrentWeek(dateString),
    });
  }

  async copyTextToClipboard(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', 'true');
        textarea.style.position = 'absolute';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      new Notice('周报已复制到剪贴板');
    } catch (error) {
      console.error(error);
      new Notice('复制失败，请手动复制');
    }
  }

  async openArchiveTaskModal(task) {
    new ArchiveTaskModal(this.app, task, async (type) => {
      await this.archiveTask(task, type);
      await this.refreshTodayViews();
    }).open();
  }

  async promptForImageFiles() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.multiple = true;
      input.style.display = 'none';
      input.addEventListener('change', () => {
        const files = Array.from(input.files || []);
        input.remove();
        resolve(files);
      }, { once: true });
      document.body.appendChild(input);
      input.click();
    });
  }

  async openWeeklyReportModal(sourcePath, sourceLabel = '任务', projectTag = '') {
    const reportText = await this.generateWeeklyReport(sourcePath, sourceLabel, projectTag);
    new WeeklyReportModal(this.app, reportText, async (text) => this.copyTextToClipboard(text)).open();
  }

  async openProjectTaskCreateModal(projectTag) {
    new TaskCreateModal(this.app, this, projectTag).open();
  }

  async openFileByPath(path) {
    if (!path) return;
    await this.ensureSourceFile(path, '任务面板');
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file) {
      new Notice('未找到文件');
      return;
    }
    const leaf = this.app.workspace.getLeaf(true);
    await leaf.openFile(file);
  }

  getTaskContext(editor, view) {
    const markdownView = view instanceof MarkdownView ? view : this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!markdownView || !editor) {
      new Notice('请先把光标放到一条任务行里');
      return null;
    }

    const cursor = editor.getCursor();
    const lineNumber = cursor.line;
    const rawLine = editor.getLine(lineNumber);
    const match = rawLine.match(/^([-*+]\s+\[[ xX]\]\s+)(.*)$/);
    if (!match) {
      new Notice('当前行不是任务行');
      return null;
    }

    return {
      editor,
      lineNumber,
      prefix: match[1],
      body: match[2],
      rawLine,
    };
  }

  updateTaskLine(context, newBody) {
    const nextLine = `${context.prefix}${normalizeSpace(newBody)}`;
    context.editor.setLine(context.lineNumber, nextLine);
  }

  openTimeRangeModal(editor, view) {
    const context = this.getTaskContext(editor, view);
    if (!context) return;

    const existing = this.extractExistingTime(context.body);
    const start = existing ? existing.start : '09:00';
    const end = existing ? existing.end : '09:15';

    new TimeRangeModal(this.app, (selectedStart, selectedEnd) => {
      const rest = existing ? existing.rest : context.body;
      this.updateTaskLine(context, `${selectedStart} - ${selectedEnd} ${rest}`);
      new Notice(`已插入时间段 ${selectedStart} - ${selectedEnd}`);
    }, start, end).open();
  }

  openTriageModal(editor, view) {
    const context = this.getTaskContext(editor, view);
    if (!context) return;

    new TriageButtonModal(this.app, (action) => {
      let body = context.body;
      WORKFLOW_TAGS.forEach((tag) => {
        body = body.replace(new RegExp(`\\s*${escapeRegExp(tag)}\\b`, 'g'), '');
      });
      body = `${normalizeSpace(body)} ${action.tag}`;
      this.updateTaskLine(context, body);
      new Notice(`已标记为：${action.label}`);
    }).open();
  }

  async openProjectTagModal(editor, view) {
    const context = this.getTaskContext(editor, view);
    if (!context) return;

    const projectTags = await this.collectProjectTags();
    if (projectTags.length === 0) {
      new Notice('还没有可选的项目标签');
      return;
    }

    new ProjectTagModal(this.app, projectTags, (selectedTag) => {
      let body = context.body.replace(/\s+#P\/[^\s]+/g, '');
      body = `${normalizeSpace(body)} #${selectedTag}`;
      this.updateTaskLine(context, body);
      new Notice(`已设置项目标签 #${selectedTag}`);
    }).open();
  }

  openDateModal(editor, view) {
    const context = this.getTaskContext(editor, view);
    if (!context) return;

    const existing = this.extractExistingDates(context.body);
    new DatePickerModal(this.app, (scheduled, due) => {
      let body = context.body
        .replace(/\s*⏳\s*\d{4}-\d{2}-\d{2}/g, '')
        .replace(/\s*📅\s*\d{4}-\d{2}-\d{2}/g, '');

      if (scheduled) body = `${normalizeSpace(body)} ⏳ ${scheduled}`;
      if (due) body = `${normalizeSpace(body)} 📅 ${due}`;

      this.updateTaskLine(context, body);
      new Notice('已更新任务日期');
    }, existing.scheduled, existing.due).open();
  }


  async openSubtaskEditModal(task, subtaskIndex = -1) {
    const context = await this.getFileTaskContext(task);
    if (!context) return;
    const parsed = this.extractSubtasksFromNote(context.note || '');
    const current = subtaskIndex >= 0 ? parsed.subtasks[subtaskIndex] : null;
    const skipFollowupValidation = Boolean(task && task.archived);
    new SubtaskEditorModal(this.app, this, this.subtaskToFormValues(current), async (values) => {
      if (!values.title) {
        new Notice('子任务标题不能为空');
        return;
      }
      if (values.startTime && values.endTime && values.endTime <= values.startTime) {
        new Notice('结束时间需要晚于开始时间');
        return;
      }
      if (!skipFollowupValidation && (values.workflowTag === '#WAIT' || values.workflowTag === '#BLOCKED') && (!values.owner || !values.item)) {
        new Notice('等待/阻塞子任务需要填写“责任人”和“事项”');
        return false;
      }
      if (!skipFollowupValidation && values.workflowTag === '#WAIT' && !values.confirmBy) {
        new Notice('等待确认子任务需要填写“确认截止”');
        return false;
      }
      if (!skipFollowupValidation && values.workflowTag === '#BLOCKED' && !values.eta) {
        new Notice('阻塞子任务需要填写“预计完成”');
        return false;
      }

      const payload = this.buildSubtaskPayload({
        title: values.title,
        startTime: values.startTime,
        endTime: values.endTime,
        scheduled: values.scheduled,
        due: values.due,
        workflowTag: values.workflowTag,
        projectTag: '',
        complexityTag: values.complexityTag,
        owner: values.owner,
        item: values.item,
        confirmBy: values.confirmBy,
        eta: values.eta,
        note: values.note,
        done: values.done,
      });

      const nextSubtask = {
        done: payload.done,
        body: payload.body,
        note: payload.note,
      };
      const nextSubtasks = subtaskIndex >= 0
        ? parsed.subtasks.map((item, idx) => (idx === subtaskIndex ? nextSubtask : item))
        : [...parsed.subtasks, nextSubtask];
      const nextNote = this.composeNoteWithSubtasks(parsed.note, nextSubtasks);
      await this.updateTaskFromPayload(task, {
        done: task.done,
        body: context.body,
        note: nextNote,
      });
      new Notice(subtaskIndex >= 0 ? '已更新子任务' : '已新增子任务');
    }).open();
  }

  async openSubtaskArchiveModal(task, subtaskIndex) {
    const context = await this.getFileTaskContext(task);
    if (!context) return;
    const parsed = this.extractSubtasksFromNote(context.note || '');
    const subtask = parsed.subtasks[subtaskIndex];
    if (!subtask) return;
    new SubtaskArchiveModal(this.app, subtask.title, async (type) => {
      await this.archiveSubtask(task, subtaskIndex, type);
      new Notice('子任务已归档');
    }).open();
  }

  async archiveSubtask(task, subtaskIndex, type) {
    const context = await this.getFileTaskContext(task);
    if (!context) return;
    const parsed = this.extractSubtasksFromNote(context.note || '');
    const subtask = parsed.subtasks[subtaskIndex];
    if (!subtask) return;
    // 构造子任务内容写入归档文件
    const folder = this.buildArchiveFolderPath(type);
    await this.ensureFolderPath(folder);
    const datePrefix = window.moment().format('YYYYMMDD-HHmmss');
    const baseName = `subtask-${datePrefix}`;
    let filePath = `${folder}/${baseName}.md`;
    let counter = 1;
    while (this.app.vault.getAbstractFileByPath(filePath)) {
      filePath = `${folder}/${baseName}-${counter}.md`;
      counter++;
    }
    const lines = [
      '---',
      `type: "subtask-archive"`,
      `parent_task: "${task.title}"`,
      `archived_at: "${window.moment().format('YYYY-MM-DD HH:mm:ss')}"`,
      `archive_type: "${type}"`,
      '---',
      '',
      `## ${subtask.title}`,
      '',
    ];
    if (subtask.body) lines.push(subtask.body, '');
    if (subtask.note) {
      lines.push('## 备注', '', subtask.note, '');
    }
    await this.app.vault.create(filePath, lines.join('\n'));
    // 从主任务中删除该子任务
    const nextSubtasks = parsed.subtasks.filter((_, idx) => idx !== subtaskIndex);
    const nextNote = this.composeNoteWithSubtasks(parsed.note, nextSubtasks);
    await this.updateTaskFromPayload(task, {
      done: task.done,
      body: context.body,
      note: nextNote,
    });
    await this.refreshTodayViews();
  }

  async openTaskTriageModal(task) {
    const context = await this.getFileTaskContext(task);
    if (!context) return;

    new TriageButtonModal(this.app, async (action) => {
      let body = context.body;
      WORKFLOW_TAGS.forEach((tag) => {
        body = body.replace(new RegExp(`\\s*${escapeRegExp(tag)}\\b`, 'g'), '');
      });
      body = `${normalizeSpace(body)} ${action.tag}`;
      await this.updateFileTaskLine(context, body);
      new Notice(`已标记为：${action.label}`);
    }).open();
  }

  async openTaskTimeModal(task) {
    const context = await this.getFileTaskContext(task);
    if (!context) return;

    const existing = this.extractExistingTime(context.body);
    const start = existing ? existing.start : '09:00';
    const end = existing ? existing.end : '09:15';

    new TimeRangeModal(this.app, async (selectedStart, selectedEnd) => {
      const rest = existing ? existing.rest : context.body;
      await this.updateFileTaskLine(context, `${selectedStart} - ${selectedEnd} ${rest}`);
      new Notice(`已插入时间段 ${selectedStart} - ${selectedEnd}`);
    }, start, end).open();
  }

  async openTaskDateModal(task) {
    const context = await this.getFileTaskContext(task);
    if (!context) return;

    const existing = this.extractExistingDates(context.body);
    new DatePickerModal(this.app, async (scheduled, due) => {
      let body = context.body
        .replace(/\s*⏳\s*\d{4}-\d{2}-\d{2}/g, '')
        .replace(/\s*📅\s*\d{4}-\d{2}-\d{2}/g, '');

      if (scheduled) body = `${normalizeSpace(body)} ⏳ ${scheduled}`;
      if (due) body = `${normalizeSpace(body)} 📅 ${due}`;

      await this.updateFileTaskLine(context, body);
      new Notice('已更新任务日期');
    }, existing.scheduled, existing.due).open();
  }

  async openTaskProjectTagModal(task) {
    const context = await this.getFileTaskContext(task);
    if (!context) return;

    const projectTags = await this.collectProjectTags();
    if (projectTags.length === 0) {
      new Notice('还没有可选的项目标签');
      return;
    }

    new ProjectTagModal(this.app, projectTags, async (selectedTag) => {
      let body = context.body.replace(/\s+#P\/[^\s]+/g, '');
      body = `${normalizeSpace(body)} #${selectedTag}`;
      await this.updateFileTaskLine(context, body);
      new Notice(`已设置项目标签 #${selectedTag}`);
    }).open();
  }
};

Object.assign(TaskWorkflowEnhancerPlugin.prototype, taskRepository);
Object.assign(TaskWorkflowEnhancerPlugin.prototype, projectService);
Object.assign(TaskWorkflowEnhancerPlugin.prototype, taskEditing);
Object.assign(TaskWorkflowEnhancerPlugin.prototype, taskNotes);

module.exports = TaskWorkflowEnhancerPlugin;
