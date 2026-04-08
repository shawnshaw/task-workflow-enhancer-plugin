const { Notice, Modal, FuzzySuggestModal, Setting, PluginSettingTab } = require('obsidian');
const {
  TRIAGE_ACTIONS,
  COMPLEXITY_OPTIONS,
  DEFAULT_INBOX_PATH,
  DEFAULT_ARCHIVE_ROOT,
  DEFAULT_BACKUP_ROOT,
  DEFAULT_WORKSPACE_ROOT,
  EMPTY_TAB_FOLDER_SCOPE,
} = require('../constants');
const { buildTimeOptions } = require('../utils');

class TimeRangeModal extends Modal {
  constructor(app, onSubmit, initialStart, initialEnd) {
    super(app);
    this.onSubmit = onSubmit;
    this.options = buildTimeOptions();
    this.startValue = initialStart || '09:00';
    this.endValue = initialEnd || '09:15';
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('twe-form');
    this.titleEl.setText('选择时间段');

    new Setting(contentEl)
      .setName('开始时间')
      .addDropdown((dropdown) => {
        this.options.forEach((option) => dropdown.addOption(option, option));
        dropdown.setValue(this.startValue);
        dropdown.onChange((value) => {
          this.startValue = value;
          if (this.options.indexOf(this.endValue) <= this.options.indexOf(value)) {
            const fallbackIndex = Math.min(this.options.length - 1, this.options.indexOf(value) + 1);
            this.endValue = this.options[fallbackIndex];
            if (this.endDropdown) this.endDropdown.setValue(this.endValue);
          }
        });
      });

    new Setting(contentEl)
      .setName('结束时间')
      .addDropdown((dropdown) => {
        this.endDropdown = dropdown;
        this.options.forEach((option) => dropdown.addOption(option, option));
        dropdown.setValue(this.endValue);
        dropdown.onChange((value) => {
          this.endValue = value;
        });
      });

    contentEl.createEl('div', {
      cls: 'twe-hint',
      text: '会把时间段写到当前任务行最前面，例如 09:00 - 09:15。',
    });

    const actions = contentEl.createDiv({ cls: 'twe-actions' });
    const cancelButton = actions.createEl('button', { text: '取消' });
    cancelButton.addEventListener('click', () => this.close());

    const confirmButton = actions.createEl('button', {
      text: '插入',
      cls: 'mod-cta',
    });
    confirmButton.addEventListener('click', () => {
      if (this.options.indexOf(this.endValue) <= this.options.indexOf(this.startValue)) {
        new Notice('结束时间需要晚于开始时间');
        return;
      }
      this.onSubmit(this.startValue, this.endValue);
      this.close();
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

class TriageButtonModal extends Modal {
  constructor(app, onChoose) {
    super(app);
    this.onChooseAction = onChoose;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('twe-form');
    this.titleEl.setText('分拣当前任务');

    contentEl.createEl('div', {
      cls: 'twe-hint',
      text: '点一个动作，插件会自动给当前任务补上对应标签。',
    });

    const actions = contentEl.createDiv({ cls: 'twe-triage-grid' });
    TRIAGE_ACTIONS.forEach((action) => {
      const button = actions.createEl('button', {
        text: `${action.label} ${action.tag}`,
        cls: 'mod-cta',
      });
      button.addEventListener('click', () => {
        this.onChooseAction(action);
        this.close();
      });
    });

    const footer = contentEl.createDiv({ cls: 'twe-actions' });
    const cancelButton = footer.createEl('button', { text: '取消' });
    cancelButton.addEventListener('click', () => this.close());
  }

  onClose() {
    this.contentEl.empty();
  }
}

class ArchiveTaskModal extends Modal {
  constructor(app, task, onChoose) {
    super(app);
    this.task = task;
    this.onChoose = onChoose;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('twe-form');
    this.titleEl.setText('归档任务');

    contentEl.createEl('div', {
      cls: 'twe-hint',
      text: `选择「${this.task?.title || '当前任务'}」的归档方式。`,
    });

    const actions = contentEl.createDiv({ cls: 'twe-triage-grid' });
    const knowledge = actions.createEl('button', {
      text: '转知识点',
      cls: 'mod-cta',
    });
    knowledge.addEventListener('click', async () => {
      await this.onChoose('knowledge');
      this.close();
    });

    const evidence = actions.createEl('button', {
      text: '转留痕归档',
      cls: 'mod-cta',
    });
    evidence.addEventListener('click', async () => {
      await this.onChoose('evidence');
      this.close();
    });

    const footer = contentEl.createDiv({ cls: 'twe-actions' });
    const cancelButton = footer.createEl('button', { text: '取消' });
    cancelButton.addEventListener('click', () => this.close());
  }

  onClose() {
    this.contentEl.empty();
  }
}

class DatePickerModal extends Modal {
  constructor(app, onSubmit, initialScheduled, initialDue) {
    super(app);
    this.onSubmit = onSubmit;
    this.scheduledValue = initialScheduled || '';
    this.dueValue = initialDue || '';
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('twe-form');
    this.titleEl.setText('设置日期');

    new Setting(contentEl)
      .setName('计划日期')
      .setDesc('对应任务中的 ⏳ YYYY-MM-DD')
      .addText((text) => {
        text.inputEl.type = 'date';
        text.setValue(this.scheduledValue);
        text.onChange((value) => {
          this.scheduledValue = value;
        });
      });

    new Setting(contentEl)
      .setName('截止日期')
      .setDesc('对应任务中的 📅 YYYY-MM-DD')
      .addText((text) => {
        text.inputEl.type = 'date';
        text.setValue(this.dueValue);
        text.onChange((value) => {
          this.dueValue = value;
        });
      });

    contentEl.createEl('div', {
      cls: 'twe-hint',
      text: '留空表示移除该日期字段。',
    });

    const actions = contentEl.createDiv({ cls: 'twe-actions' });
    const cancelButton = actions.createEl('button', { text: '取消' });
    cancelButton.addEventListener('click', () => this.close());

    const confirmButton = actions.createEl('button', {
      text: '保存',
      cls: 'mod-cta',
    });
    confirmButton.addEventListener('click', () => {
      this.onSubmit(this.scheduledValue, this.dueValue);
      this.close();
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

class SubtaskEditorModal extends Modal {
  constructor(app, plugin, initialValues, onSubmit) {
    super(app);
    this.plugin = plugin;
    this.values = Object.assign({
      title: '',
      startTime: '',
      endTime: '',
      scheduled: '',
      due: '',
      workflowTag: '',
      complexityTag: '',
      owner: '',
      item: '',
      confirmBy: '',
      eta: '',
      note: '',
      done: false,
    }, initialValues || {});
    this.onSubmit = onSubmit;
    this.isSubmitting = false;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('twe-form');
    this.titleEl.setText('子任务');

    const form = contentEl.createDiv({ cls: 'twe-editor-form' });
    const titleSection = form.createDiv({ cls: 'twe-editor-section twe-editor-section-primary' });
    const titleField = titleSection.createDiv({ cls: 'twe-editor-field' });
    titleField.createEl('label', { cls: 'twe-detail-label', text: '任务内容' });
    const titleInput = titleField.createEl('input', { type: 'text', value: this.values.title || '' });

    const scheduleSection = form.createDiv({ cls: 'twe-editor-section' });
    const timeRow = scheduleSection.createDiv({ cls: 'twe-editor-row' });
    const startField = timeRow.createDiv({ cls: 'twe-editor-field' });
    startField.createEl('label', { cls: 'twe-detail-label', text: '开始' });
    const startInput = startField.createEl('input', { type: 'time', value: this.values.startTime || '' });
    const endField = timeRow.createDiv({ cls: 'twe-editor-field' });
    endField.createEl('label', { cls: 'twe-detail-label', text: '结束' });
    const endInput = endField.createEl('input', { type: 'time', value: this.values.endTime || '' });

    const dateRow = scheduleSection.createDiv({ cls: 'twe-editor-row' });
    const scheduledField = dateRow.createDiv({ cls: 'twe-editor-field' });
    scheduledField.createEl('label', { cls: 'twe-detail-label', text: '计划处理日' });
    const scheduledInput = scheduledField.createEl('input', { type: 'date', value: this.values.scheduled || '' });
    const dueField = dateRow.createDiv({ cls: 'twe-editor-field' });
    dueField.createEl('label', { cls: 'twe-detail-label', text: '截止日' });
    const dueInput = dueField.createEl('input', { type: 'date', value: this.values.due || '' });

    const classifySection = form.createDiv({ cls: 'twe-editor-section' });
    const classifyRow = classifySection.createDiv({ cls: 'twe-editor-row' });
    const workflowField = classifyRow.createDiv({ cls: 'twe-editor-field' });
    workflowField.createEl('label', { cls: 'twe-detail-label', text: '安排到' });
    const workflowSelect = workflowField.createEl('select');
    workflowSelect.createEl('option', { value: '', text: '暂不安排' });
    TRIAGE_ACTIONS.forEach((action) => workflowSelect.createEl('option', { value: action.tag, text: action.label }));
    workflowSelect.value = this.values.workflowTag || '';

    const complexityField = classifyRow.createDiv({ cls: 'twe-editor-field' });
    complexityField.createEl('label', { cls: 'twe-detail-label', text: '复杂度' });
    const complexitySelect = complexityField.createEl('select');
    complexitySelect.createEl('option', { value: '', text: '未指定' });
    COMPLEXITY_OPTIONS.forEach((option) => complexitySelect.createEl('option', { value: option.tag, text: option.label }));
    complexitySelect.value = this.values.complexityTag || '';

    const followSection = form.createDiv({ cls: 'twe-editor-section' });
    const followRow = followSection.createDiv({ cls: 'twe-editor-row' });
    const ownerField = followRow.createDiv({ cls: 'twe-editor-field' });
    ownerField.createEl('label', { cls: 'twe-detail-label', text: '责任人' });
    const ownerInput = ownerField.createEl('input', { type: 'text', value: this.values.owner || '' });
    const itemField = followRow.createDiv({ cls: 'twe-editor-field' });
    itemField.createEl('label', { cls: 'twe-detail-label', text: '事项' });
    const itemInput = itemField.createEl('input', { type: 'text', value: this.values.item || '' });

    const followTimeRow = followSection.createDiv({ cls: 'twe-editor-row' });
    const confirmByField = followTimeRow.createDiv({ cls: 'twe-editor-field' });
    confirmByField.createEl('label', { cls: 'twe-detail-label', text: '确认截止' });
    const confirmByInput = confirmByField.createEl('input', { type: 'date', value: this.values.confirmBy || '' });
    const etaField = followTimeRow.createDiv({ cls: 'twe-editor-field' });
    etaField.createEl('label', { cls: 'twe-detail-label', text: '预计完成' });
    const etaInput = etaField.createEl('input', { type: 'date', value: this.values.eta || '' });

    const refreshFollowupSection = () => {
      const tag = workflowSelect.value;
      if (tag === '#WAIT' || tag === '#BLOCKED') {
        followSection.style.display = '';
        confirmByField.style.display = tag === '#WAIT' ? '' : 'none';
        etaField.style.display = tag === '#BLOCKED' ? '' : 'none';
      } else {
        followSection.style.display = 'none';
      }
    };
    workflowSelect.addEventListener('change', refreshFollowupSection);
    refreshFollowupSection();

    const noteSection = form.createDiv({ cls: 'twe-editor-section' });
    const noteField = noteSection.createDiv({ cls: 'twe-editor-field' });
    noteField.createEl('label', { cls: 'twe-detail-label', text: '补充说明' });
    const noteInput = noteField.createEl('textarea');
    noteInput.value = this.values.note || '';
    noteInput.rows = 3;
    const noteMediaActions = noteSection.createDiv({ cls: 'twe-note-actions' });
    const addImageButton = noteMediaActions.createEl('button', {
      cls: 'twe-detail-button',
      text: '添加图片',
      attr: { type: 'button' },
    });
    addImageButton.addEventListener('click', async () => {
      addImageButton.disabled = true;
      addImageButton.setText('上传中...');
      try {
        await this.plugin.pickTaskImagesAndAppend(noteInput);
      } finally {
        if (addImageButton.isConnected) {
          addImageButton.disabled = false;
          addImageButton.setText('添加图片');
        }
      }
    });

    const doneRow = form.createDiv({ cls: 'twe-checkbox-row' });
    const doneInput = doneRow.createEl('input', { type: 'checkbox' });
    doneInput.checked = Boolean(this.values.done);
    doneRow.createSpan({ text: '标记为已完成' });

    const actions = contentEl.createDiv({ cls: 'twe-actions' });
    const cancel = actions.createEl('button', { text: '取消' });
    cancel.addEventListener('click', () => this.close());
    const save = actions.createEl('button', { text: '保存', cls: 'mod-cta' });
    save.addEventListener('click', async () => {
      if (this.isSubmitting) return;
      this.isSubmitting = true;
      save.disabled = true;
      save.setText('保存中...');
      const nextValues = {
        title: titleInput.value.trim(),
        startTime: startInput.value,
        endTime: endInput.value,
        scheduled: scheduledInput.value,
        due: dueInput.value,
        workflowTag: workflowSelect.value,
        complexityTag: complexitySelect.value,
        owner: ownerInput.value.trim(),
        item: itemInput.value.trim(),
        confirmBy: confirmByInput.value,
        eta: etaInput.value,
        note: noteInput.value,
        done: doneInput.checked,
      };
      try {
        await this.onSubmit(nextValues);
        this.close();
      } catch (err) {
        new Notice('保存失败: ' + (err.message || String(err)), 5000);
      } finally {
        this.isSubmitting = false;
        if (save.isConnected) {
          save.disabled = false;
          save.setText('保存');
        }
      }
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

class WeeklyReportModal extends Modal {
  constructor(app, reportText, onCopy) {
    super(app);
    this.reportText = reportText;
    this.onCopy = onCopy;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('twe-form');
    this.titleEl.setText('周报汇总');

    contentEl.createEl('div', {
      cls: 'twe-hint',
      text: '已按当前任务自动生成，可直接复制后发给领导。',
    });

    const preview = contentEl.createEl('textarea', { cls: 'twe-report-preview' });
    preview.value = this.reportText;
    preview.readOnly = true;
    preview.rows = 18;

    const actions = contentEl.createDiv({ cls: 'twe-actions' });
    const close = actions.createEl('button', { text: '关闭' });
    close.addEventListener('click', () => this.close());

    const copy = actions.createEl('button', {
      text: '复制周报',
      cls: 'mod-cta',
    });
    copy.addEventListener('click', async () => {
      await this.onCopy(this.reportText);
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

class ProjectTagModal extends FuzzySuggestModal {
  constructor(app, tags, onChoose) {
    super(app);
    this.tags = tags;
    this.onChooseTag = onChoose;
    this.setPlaceholder('选择项目标签，例如 P/装修');
  }

  getItems() {
    return this.tags;
  }

  getItemText(item) {
    return item;
  }

  onChooseItem(item) {
    this.onChooseTag(item);
  }

  onClose() {
    this.contentEl.empty();
  }
}

class WorkspaceTabsModal extends Modal {
  constructor(app, plugin, tabs, onSave) {
    super(app);
    this.plugin = plugin;
    this.tabs = tabs.map((tab) => ({ ...tab }));
    this.onSave = onSave;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('twe-tabs-modal');
    contentEl.createEl('h3', { text: '管理工作台 Tabs' });
    contentEl.createEl('p', { text: '支持新增空白面板、重命名现有面板，以及删除自定义面板。' });

    const list = contentEl.createDiv();
    const renderRows = () => {
      list.empty();
      this.tabs.forEach((tab, index) => {
        const row = list.createDiv({ cls: 'twe-tab-manager-row' });
        const sourceLabel = tab.type === 'project'
          ? '项目中心视图'
          : (tab.sourcePath || this.plugin.getInboxPath());
        new Setting(row)
          .setName(tab.locked ? `${tab.name}（内置）` : `自定义面板 ${index + 1}`)
          .setDesc(`数据源：${sourceLabel}`)
          .addText((text) => text
            .setPlaceholder('Tab 名称')
            .setValue(tab.name || '')
            .onChange((value) => {
              if (!this._nameDebounceMap) this._nameDebounceMap = new Map();
              const key = index;
              clearTimeout(this._nameDebounceMap.get(key));
              const timer = setTimeout(() => {
                this.tabs[index].name = value.trim();
                renderRows();
              }, 200);
              this._nameDebounceMap.set(key, timer);
            }))
          .addDropdown((dropdown) => {
            dropdown
              .addOption('workspace', '工作台面板')
              .addOption('project', '项目中心');
            dropdown.setValue(tab.type || 'workspace');
            dropdown.onChange((value) => {
              this.tabs[index].type = value;
            });
          })
          .addDropdown((dropdown) => {
            dropdown
              .addOption(EMPTY_TAB_FOLDER_SCOPE, '空白页')
              .addOption('all', '全部')
              .addOption('today', '今天')
              .addOption('tomorrow', '明天')
              .addOption('week', '本周')
              .addOption('month', '本月')
              .addOption('overdue', '已过期');
            dropdown.setValue(tab.defaultFolderScope || EMPTY_TAB_FOLDER_SCOPE);
            dropdown.onChange((value) => {
              this.tabs[index].defaultFolderScope = value;
            });
          })
          .addExtraButton((button) => {
            button
              .setIcon('arrow-up-right')
              .setTooltip(tab.type === 'project' ? '项目中心没有单独源文件' : '打开数据源')
              .setDisabled(tab.type === 'project')
              .onClick(async () => {
                if (tab.type === 'project' || !sourceLabel) return;
                await this.plugin.openFileByPath(sourceLabel);
              });
          })
          .addExtraButton((button) => {
            button
              .setIcon('database-backup')
              .setTooltip(tab.type === 'project' ? '项目中心没有单独源文件' : '备份数据源')
              .setDisabled(tab.type === 'project')
              .onClick(async () => {
                if (tab.type === 'project' || !sourceLabel) return;
                await this.plugin.backupSourcePath(sourceLabel);
              });
          })
          .addExtraButton((button) => {
            button
              .setIcon('trash-2')
              .setTooltip(tab.locked ? '内置 Tab 不能删除' : '删除此 Tab')
              .setDisabled(Boolean(tab.locked))
              .onClick(() => {
                if (tab.locked) return;
                this.tabs.splice(index, 1);
                renderRows();
              });
          });
      });
    };

    renderRows();

    const footer = contentEl.createDiv({ cls: 'twe-actions' });
    const addButton = footer.createEl('button', { text: '新增空白页' });
    addButton.addEventListener('click', () => {
      this.tabs.push({
        id: `workspace-${Date.now()}`,
        name: '新面板',
        type: 'workspace',
        defaultTimeScope: 'all',
        defaultFolderScope: EMPTY_TAB_FOLDER_SCOPE,
        locked: false,
      });
      renderRows();
    });
    const cancel = footer.createEl('button', { text: '取消' });
    cancel.addEventListener('click', () => this.close());
    const save = footer.createEl('button', { text: '保存', cls: 'mod-cta' });
    save.addEventListener('click', async () => {
      const normalized = this.tabs
        .map((tab, index) => ({
          ...tab,
          id: tab.id || `workspace-${Date.now()}-${index}`,
          name: (tab.name || '').trim() || `面板 ${index + 1}`,
          type: tab.type === 'project' ? 'project' : 'workspace',
          defaultTimeScope: tab.defaultTimeScope || 'all',
          defaultFolderScope: tab.defaultFolderScope || EMPTY_TAB_FOLDER_SCOPE,
          locked: Boolean(tab.locked),
        }));
      await this.onSave(normalized);
      this.close();
    });
  }

  onClose() {
    if (this._nameDebounceMap) {
      for (const timer of this._nameDebounceMap.values()) clearTimeout(timer);
      this._nameDebounceMap.clear();
    }
    this.contentEl.empty();
  }
}

class TaskWorkflowSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Task Workflow 设置' });

    const dataSources = this.plugin.getDataSources();
    containerEl.createEl('h3', { text: '数据源管理' });

    new Setting(containerEl)
      .setName('主收件箱文件')
      .setDesc('工作主面板默认读取和写入的任务源文件')
      .addText((text) => text
        .setPlaceholder(DEFAULT_INBOX_PATH)
        .setValue(dataSources.inboxPath || '')
        .onChange(async (value) => {
          await this.plugin.saveDataSources({ inboxPath: value.trim() || DEFAULT_INBOX_PATH });
        }))
      .addButton((button) => button
        .setButtonText('打开')
        .onClick(async () => this.plugin.openFileByPath(this.plugin.getInboxPath())))
      .addButton((button) => button
        .setButtonText('备份')
        .onClick(async () => this.plugin.backupSourcePath(this.plugin.getInboxPath())));

    new Setting(containerEl)
      .setName('归档根目录')
      .setDesc('知识归档和留痕归档默认存放目录')
      .addText((text) => text
        .setPlaceholder(DEFAULT_ARCHIVE_ROOT)
        .setValue(dataSources.archiveRoot || '')
        .onChange(async (value) => {
          await this.plugin.saveDataSources({ archiveRoot: value.trim() || DEFAULT_ARCHIVE_ROOT });
        }));

    new Setting(containerEl)
      .setName('备份目录')
      .setDesc('每次写入任务源前自动生成快照备份')
      .addText((text) => text
        .setPlaceholder(DEFAULT_BACKUP_ROOT)
        .setValue(dataSources.backupRoot || '')
        .onChange(async (value) => {
          await this.plugin.saveDataSources({ backupRoot: value.trim() || DEFAULT_BACKUP_ROOT });
        }))
      .addToggle((toggle) => toggle
        .setValue(Boolean(dataSources.autoBackup))
        .onChange(async (value) => {
          await this.plugin.saveDataSources({ autoBackup: value });
        }));

    new Setting(containerEl)
      .setName('备份保留天数')
      .setDesc('超过这个天数的旧备份会被自动清理')
      .addText((text) => text
        .setPlaceholder('14')
        .setValue(String(dataSources.backupRetentionDays ?? 14))
        .onChange(async (value) => {
          const days = Math.max(1, Number(value) || 14);
          await this.plugin.saveDataSources({ backupRetentionDays: days });
        }));

    new Setting(containerEl)
      .setName('每日最多保留备份数')
      .setDesc('同一天内超过这个数量时，只保留最新的若干份')
      .addText((text) => text
        .setPlaceholder('20')
        .setValue(String(dataSources.backupMaxPerDay ?? 20))
        .onChange(async (value) => {
          const count = Math.max(1, Number(value) || 20);
          await this.plugin.saveDataSources({ backupMaxPerDay: count });
        }));

    new Setting(containerEl)
      .setName('Workspace 源目录')
      .setDesc('自定义 Tab 的独立 md 数据源默认创建在这里')
      .addText((text) => text
        .setPlaceholder(DEFAULT_WORKSPACE_ROOT)
        .setValue(dataSources.workspaceRoot || '')
        .onChange(async (value) => {
          await this.plugin.saveDataSources({ workspaceRoot: value.trim() || DEFAULT_WORKSPACE_ROOT });
        }));

    containerEl.createEl('h3', { text: 'Tab 数据源' });
    containerEl.createEl('p', { text: '这里可以看到每个 Tab 背后绑定的文件。自定义 Tab 会有自己的独立 md 数据源。' });

    this.plugin.getWorkspaceTabs().forEach((tab) => {
      const sourcePath = tab.type === 'project' ? '' : (tab.sourcePath || this.plugin.getInboxPath());
      new Setting(containerEl)
        .setName(tab.name)
        .setDesc(tab.type === 'project' ? '项目中心视图，不绑定单独任务文件' : `数据源：${sourcePath}`)
        .addButton((button) => button
          .setButtonText('管理 Tabs')
          .onClick(async () => this.plugin.openWorkspaceTabsModal(tab.id)))
        .addButton((button) => button
          .setButtonText('打开源文件')
          .setDisabled(tab.type === 'project')
          .onClick(async () => this.plugin.openFileByPath(sourcePath)))
        .addButton((button) => button
          .setButtonText('备份')
          .setDisabled(tab.type === 'project')
          .onClick(async () => this.plugin.backupSourcePath(sourcePath)))
        .addButton((button) => button
          .setButtonText('恢复最新备份')
          .setDisabled(tab.type === 'project')
          .onClick(async () => this.plugin.restoreSourcePathFromLatestBackup(sourcePath)));
    });
  }
}

class TaskCreateModal extends Modal {
  constructor(app, plugin, projectTag) {
    super(app);
    this.plugin = plugin;
    this.projectTag = projectTag || '';
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('twe-form');
    this.titleEl.setText('新建项目任务');

    const form = contentEl.createDiv({ cls: 'twe-editor-form' });

    const titleSection = form.createDiv({ cls: 'twe-editor-section twe-editor-section-primary' });
    const titleField = titleSection.createDiv({ cls: 'twe-editor-field' });
    titleField.createEl('label', { cls: 'twe-detail-label', text: '任务内容' });
    const titleInput = titleField.createEl('input', { type: 'text', value: '' });
    titleInput.placeholder = '例如：对接新版 API 接口';

    const scheduleSection = form.createDiv({ cls: 'twe-editor-section' });
    const dateRow = scheduleSection.createDiv({ cls: 'twe-editor-row' });
    const scheduledField = dateRow.createDiv({ cls: 'twe-editor-field' });
    scheduledField.createEl('label', { cls: 'twe-detail-label', text: '计划处理日' });
    const scheduledInput = scheduledField.createEl('input', { type: 'date', value: '' });
    const dueField = dateRow.createDiv({ cls: 'twe-editor-field' });
    dueField.createEl('label', { cls: 'twe-detail-label', text: '截止日' });
    const dueInput = dueField.createEl('input', { type: 'date', value: '' });

    const classifySection = form.createDiv({ cls: 'twe-editor-section' });
    const classifyRow = classifySection.createDiv({ cls: 'twe-editor-row' });
    const workflowField = classifyRow.createDiv({ cls: 'twe-editor-field' });
    workflowField.createEl('label', { cls: 'twe-detail-label', text: '安排到' });
    const workflowSelect = workflowField.createEl('select');
    workflowSelect.createEl('option', { value: '', text: '暂不安排' });
    TRIAGE_ACTIONS.forEach((action) => workflowSelect.createEl('option', { value: action.tag, text: action.label }));

    const projectField = classifyRow.createDiv({ cls: 'twe-editor-field' });
    projectField.createEl('label', { cls: 'twe-detail-label', text: '所属项目' });
    const projectSelect = projectField.createEl('select');
    projectSelect.createEl('option', { value: '', text: '无项目' });
    (this.plugin.cachedProjectTags || []).forEach((tag) => projectSelect.createEl('option', { value: tag, text: `#${tag}` }));
    projectSelect.value = this.projectTag;

    const complexityRow = classifySection.createDiv({ cls: 'twe-editor-row' });
    const complexityField = complexityRow.createDiv({ cls: 'twe-editor-field' });
    complexityField.createEl('label', { cls: 'twe-detail-label', text: '复杂度' });
    const complexitySelect = complexityField.createEl('select');
    complexitySelect.createEl('option', { value: '', text: '未指定' });
    COMPLEXITY_OPTIONS.forEach((option) => complexitySelect.createEl('option', { value: option.tag, text: option.label }));

    const noteSection = form.createDiv({ cls: 'twe-editor-section' });
    const noteField = noteSection.createDiv({ cls: 'twe-editor-field' });
    noteField.createEl('label', { cls: 'twe-detail-label', text: '补充说明' });
    const noteInput = noteField.createEl('textarea');
    noteInput.rows = 3;

    const actions = contentEl.createDiv({ cls: 'twe-actions' });
    const cancel = actions.createEl('button', { text: '取消' });
    cancel.addEventListener('click', () => this.close());
    const save = actions.createEl('button', { text: '创建任务', cls: 'mod-cta' });
    save.addEventListener('click', async () => {
      const title = titleInput.value.trim();
      if (!title) {
        new Notice('任务标题不能为空');
        return;
      }
      save.disabled = true;
      save.setText('创建中...');
      try {
        const payload = this.plugin.buildTaskPayload({
          title,
          startTime: '',
          endTime: '',
          scheduled: scheduledInput.value,
          due: dueInput.value,
          workflowTag: workflowSelect.value,
          projectTag: projectSelect.value,
          complexityTag: complexitySelect.value,
          owner: '',
          item: '',
          confirmBy: '',
          eta: '',
          subtasks: [],
          note: noteInput.value,
          done: false,
        });
        const targetPath = this.plugin.getInboxPath();
        await this.plugin.createTaskInSource(targetPath, payload);
        new Notice('已新增项目任务');
        this.close();
        await this.plugin.refreshTodayViews();
      } catch (err) {
        new Notice('创建任务失败: ' + (err.message || String(err)), 5000);
      } finally {
        if (save.isConnected) {
          save.disabled = false;
          save.setText('创建任务');
        }
      }
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

module.exports = {
  TimeRangeModal,
  TriageButtonModal,
  ArchiveTaskModal,
  DatePickerModal,
  SubtaskEditorModal,
  WeeklyReportModal,
  ProjectTagModal,
  WorkspaceTabsModal,
  TaskCreateModal,
  TaskWorkflowSettingTab,
};
