const { Notice } = require('obsidian');
const {
  DEFAULT_INBOX_PATH,
  DEFAULT_ARCHIVE_ROOT,
  DEFAULT_BACKUP_ROOT,
  DEFAULT_WORKSPACE_ROOT,
  DEFAULT_WORKSPACE_TABS,
  DEFAULT_DATA_SOURCES,
  EMPTY_TAB_FOLDER_SCOPE,
} = require('../constants');
const {
  sanitizeAttachmentName,
  todayString,
  extractDateToken,
  extractTimeRange,
  stripTaskMetadata,
} = require('../utils');

const taskRepository = {
  getDataSources() {
    return Object.assign({}, DEFAULT_DATA_SOURCES, this.stateStore?.dataSources || {});
  },

  getInboxPath() {
    return this.getDataSources().inboxPath || DEFAULT_INBOX_PATH;
  },

  getArchiveRootPath() {
    return this.getDataSources().archiveRoot || DEFAULT_ARCHIVE_ROOT;
  },

  getBackupRootPath() {
    return this.getDataSources().backupRoot || DEFAULT_BACKUP_ROOT;
  },

  getWorkspaceRootPath() {
    return this.getDataSources().workspaceRoot || DEFAULT_WORKSPACE_ROOT;
  },

  buildWorkspaceTabSourcePath(tabId) {
    return `${this.getWorkspaceRootPath()}/${tabId}.md`;
  },

  normalizeWorkspaceTabs(tabs) {
    const rawTabs = Array.isArray(tabs) && tabs.length ? tabs : DEFAULT_WORKSPACE_TABS;
    const seen = new Set();
    const normalized = rawTabs.map((tab, index) => {
      const defaultTab = DEFAULT_WORKSPACE_TABS[index];
      let id = String(tab?.id || defaultTab?.id || `workspace-${index}`);
      if (seen.has(id)) id = `${id}-${index}`;
      seen.add(id);
      return {
        id,
        name: String(tab?.name || defaultTab?.name || `面板 ${index + 1}`),
        type: tab?.type === 'project' ? 'project' : 'workspace',
        defaultTimeScope: tab?.defaultTimeScope || defaultTab?.defaultTimeScope || 'all',
        defaultFolderScope: tab?.defaultFolderScope || defaultTab?.defaultFolderScope || EMPTY_TAB_FOLDER_SCOPE,
        sourcePath: tab?.sourcePath || (tab?.locked || (defaultTab && defaultTab.locked) ? '' : this.buildWorkspaceTabSourcePath(id)),
        locked: Boolean(tab?.locked || (defaultTab && defaultTab.locked)),
      };
    });
    return normalized.length ? normalized : DEFAULT_WORKSPACE_TABS.map((tab) => ({ ...tab }));
  },

  getWorkspaceTabs() {
    this.stateStore = this.stateStore || {};
    this.stateStore.workspaceTabs = this.normalizeWorkspaceTabs(this.stateStore.workspaceTabs);
    return this.stateStore.workspaceTabs;
  },

  async saveWorkspaceTabs(tabs) {
    this.stateStore = this.stateStore || {};
    this.stateStore.workspaceTabs = this.normalizeWorkspaceTabs(tabs);
    await this.ensureWorkspaceTabSources(this.stateStore.workspaceTabs);
    await this.saveData(this.stateStore);
  },

  async saveDataSources(partial) {
    this.stateStore = this.stateStore || {};
    this.stateStore.dataSources = Object.assign({}, this.getDataSources(), partial || {});
    await this.ensureTaskStorageInitialized();
    await this.saveData(this.stateStore);
  },

  async ensureTaskStorageInitialized() {
    const inboxPath = this.getInboxPath();
    const folder = inboxPath.split('/').slice(0, -1).join('/');
    if (folder) await this.ensureFolderPath(folder);
    if (!this.app.vault.getAbstractFileByPath(inboxPath)) {
      await this.app.vault.create(inboxPath, '# 任务收件箱\n\n## 活跃任务\n\n## 已归档任务\n');
    }
    await this.ensureFolderPath(this.getArchiveRootPath());
    await this.ensureFolderPath(this.getBackupRootPath());
    await this.ensureFolderPath(this.getWorkspaceRootPath());
    const attachmentRoot = this.getDataSources().attachmentRoot || DEFAULT_ATTACHMENT_ROOT;
    await this.ensureFolderPath(attachmentRoot);
    await this.ensureWorkspaceTabSources(this.getWorkspaceTabs());
  },

  async ensureWorkspaceTabSources(tabs) {
    if (!Array.isArray(tabs)) return;
    await this.ensureFolderPath(this.getWorkspaceRootPath());
    for (const tab of tabs) {
      if (!tab || tab.locked || tab.type !== 'workspace' || !tab.sourcePath) continue;
      if (this.app.vault.getAbstractFileByPath(tab.sourcePath)) continue;
      const content = [
        '---',
        `tab_id: ${JSON.stringify(tab.id)}`,
        `tab_name: ${JSON.stringify(tab.name || '')}`,
        'type: "workspace"',
        `created_at: ${JSON.stringify(todayString())}`,
        '---',
        '',
        `# ${tab.name || '新面板'}`,
        '',
        '## 活跃任务',
        '',
        '## 已归档任务',
        '',
      ].join('\n');
      await this.app.vault.create(tab.sourcePath, content);
    }
  },

  async ensureSourceFile(sourcePath, title = '任务面板') {
    if (!sourcePath) return;
    const folder = sourcePath.split('/').slice(0, -1).join('/');
    if (folder) await this.ensureFolderPath(folder);
    if (this.app.vault.getAbstractFileByPath(sourcePath)) return;
    await this.app.vault.create(sourcePath, `# ${title}\n\n## 活跃任务\n\n## 已归档任务\n`);
  },

  async backupTaskSource(file) {
    const sources = this.getDataSources();
    if (!sources.autoBackup || !file) return;
    const content = await this.app.vault.cachedRead(file);
    const folder = `${this.getBackupRootPath()}/${window.moment().format('YYYY-MM-DD')}`;
    await this.ensureFolderPath(folder);
    const safeName = sanitizeAttachmentName(file.path || file.basename || 'tasks');
    const backupPath = `${folder}/${window.moment().format('HHmmss')}-${safeName}.md`;
    await this.app.vault.create(backupPath, content);
    await this.pruneBackupSnapshots(safeName);
  },

  async pruneBackupSnapshots(safeName) {
    const sources = this.getDataSources();
    const retentionDays = Math.max(1, Number(sources.backupRetentionDays) || 14);
    const maxPerDay = Math.max(1, Number(sources.backupMaxPerDay) || 20);
    const root = this.getBackupRootPath();
    const folders = this.app.vault.getAllLoadedFiles()
      .filter((file) => file.path.startsWith(`${root}/`) && file.children);

    const cutoff = window.moment().subtract(retentionDays, 'days').startOf('day');
    for (const folder of folders) {
      const dayPart = folder.path.slice(root.length + 1);
      const day = window.moment(dayPart, 'YYYY-MM-DD', true);
      if (!day.isValid()) continue;
      if (day.isBefore(cutoff)) {
        await this.app.vault.delete(folder, true);
        continue;
      }
      const children = (folder.children || [])
        .filter((child) => child.path.endsWith(`-${safeName}.md`))
        .sort((a, b) => String(b.path).localeCompare(String(a.path)));
      if (children.length <= maxPerDay) continue;
      for (const extra of children.slice(maxPerDay)) {
        await this.app.vault.delete(extra, true);
      }
    }
  },

  async findLatestBackupForSource(sourcePath) {
    const safeName = sanitizeAttachmentName(sourcePath || '');
    const root = this.getBackupRootPath();
    const files = this.app.vault.getMarkdownFiles()
      .filter((file) => file.path.startsWith(`${root}/`) && file.path.endsWith(`-${safeName}.md`))
      .sort((a, b) => String(b.path).localeCompare(String(a.path)));
    return files[0] || null;
  },

  async backupSourcePath(sourcePath) {
    if (!sourcePath) return;
    await this.ensureSourceFile(sourcePath, '任务面板');
    const file = this.app.vault.getAbstractFileByPath(sourcePath);
    if (!file) {
      new Notice('未找到数据源文件');
      return;
    }
    await this.backupTaskSource(file);
    new Notice('已备份数据源');
  },

  async restoreSourcePathFromLatestBackup(sourcePath) {
    if (!sourcePath) return;
    await this.ensureSourceFile(sourcePath, '任务面板');
    const backup = await this.findLatestBackupForSource(sourcePath);
    if (!backup) {
      new Notice('没有可恢复的备份');
      return;
    }
    const target = this.app.vault.getAbstractFileByPath(sourcePath);
    if (!target) {
      new Notice('未找到目标数据源');
      return;
    }
    await this.backupTaskSource(target);
    const content = await this.app.vault.cachedRead(backup);
    await this.app.vault.modify(target, content);
    await this.refreshTodayViews();
    new Notice('已从最新备份恢复');
  },

  async processTaskFile(file, updater) {
    if (!file) return;
    await this.backupTaskSource(file);
    await this.app.vault.process(file, updater);
  },

  getWorkMonthlyArchivePath(dateString = todayString()) {
    const month = window.moment(dateString, 'YYYY-MM-DD', true).isValid()
      ? window.moment(dateString, 'YYYY-MM-DD').format('YYYY-MM')
      : window.moment().format('YYYY-MM');
    return `${this.getArchiveRootPath()}/work/${month}.md`;
  },

  async ensureMonthlyWorkArchiveFile(path) {
    const folder = path.split('/').slice(0, -1).join('/');
    await this.ensureFolderPath(folder);
    if (this.app.vault.getAbstractFileByPath(path)) return;
    await this.app.vault.create(path, `# 工作任务归档 · ${path.match(/(\\d{4}-\\d{2})\\.md$/)?.[1] || window.moment().format('YYYY-MM')}\n\n## 已完成顶层任务\n`);
  },

  async compactPrimaryInboxSource() {
    const inboxPath = this.getInboxPath();
    const file = this.app.vault.getAbstractFileByPath(inboxPath);
    if (!file) return;
    const content = await this.app.vault.cachedRead(file);
    const lines = content.split('\n');
    const blocksByArchivePath = new Map();
    const removeRanges = [];
    let currentH2 = '';
    let index = 0;

    while (index < lines.length) {
      const line = lines[index];
      const headingMatch = line.match(/^##\s+(.+)$/);
      if (headingMatch) {
        currentH2 = headingMatch[1].trim();
        index += 1;
        continue;
      }

      const taskMatch = line.match(/^[-*+]\s+\[([xX])\]\s+(.*)$/);
      if (!taskMatch || currentH2 === '已归档任务') {
        index += 1;
        continue;
      }

      const block = [line];
      let cursor = index + 1;
      while (cursor < lines.length) {
        const nextLine = lines[cursor];
        if (/^##\s+/.test(nextLine)) break;
        if (/^[-*+]\s+\[[ xX]\]\s+/.test(nextLine)) break;
        block.push(nextLine);
        cursor += 1;
      }

      const body = taskMatch[2];
      const completed = this.extractCompletedDate(body) || todayString();
      const archivePath = this.getWorkMonthlyArchivePath(completed);
      const list = blocksByArchivePath.get(archivePath) || [];
      list.push(block.join('\n').trimEnd());
      blocksByArchivePath.set(archivePath, list);
      removeRanges.push([index, cursor]);
      index = cursor;
    }

    if (!removeRanges.length) return;

    for (const [archivePath, blocks] of blocksByArchivePath.entries()) {
      await this.ensureMonthlyWorkArchiveFile(archivePath);
      const archiveFile = this.app.vault.getAbstractFileByPath(archivePath);
      if (!archiveFile) continue;
      await this.app.vault.process(archiveFile, (archiveContent) => {
        let next = archiveContent.trimEnd();
        blocks.forEach((block) => {
          if (next.includes(block)) return;
          next = `${next}\n\n${block}`;
        });
        return `${next}\n`;
      });
    }

    await this.backupTaskSource(file);
    await this.app.vault.process(file, (latest) => {
      const nextLines = latest.split('\n');
      const ranges = [];
      let latestH2 = '';
      let cursor = 0;
      while (cursor < nextLines.length) {
        const row = nextLines[cursor];
        const headingMatch = row.match(/^##\s+(.+)$/);
        if (headingMatch) {
          latestH2 = headingMatch[1].trim();
          cursor += 1;
          continue;
        }
        const taskMatch = row.match(/^[-*+]\s+\[([xX])\]\s+(.*)$/);
        if (!taskMatch || latestH2 === '已归档任务') {
          cursor += 1;
          continue;
        }
        let end = cursor + 1;
        while (end < nextLines.length) {
          const nextLine = nextLines[end];
          if (/^##\s+/.test(nextLine)) break;
          if (/^[-*+]\s+\[[ xX]\]\s+/.test(nextLine)) break;
          end += 1;
        }
        ranges.push([cursor, end]);
        cursor = end;
      }
      ranges.reverse().forEach(([start, end]) => {
        nextLines.splice(start, end - start);
        while (start < nextLines.length && !nextLines[start]?.trim() && !nextLines[start - 1]?.trim()) {
          nextLines.splice(start, 1);
        }
      });
      return `${nextLines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
    });
  },

  schedulePrimaryInboxCompaction() {
    if (this.primaryInboxCompactionTimer) {
      window.clearTimeout(this.primaryInboxCompactionTimer);
    }
    this.primaryInboxCompactionTimer = window.setTimeout(async () => {
      this.primaryInboxCompactionTimer = null;
      try {
        await this.compactPrimaryInboxSource();
        await this.refreshTodayViews();
      } catch (error) {
        console.error('[task-workflow-enhancer] Failed to compact primary inbox source', error);
      }
    }, 80);
  },

  async getTasksFromSource(sourcePath, includeArchived = false) {
    await this.ensureTaskStorageInitialized();
    const file = this.app.vault.getAbstractFileByPath(sourcePath);
    if (!file) return [];
    const content = await this.app.vault.cachedRead(file);
    const lines = content.split('\n');
    const rows = [];
    let currentH2 = '';

    lines.forEach((line, index) => {
      const headingMatch = line.match(/^##\s+(.+)$/);
      if (headingMatch) {
        currentH2 = headingMatch[1].trim();
      }
      const match = line.match(/^[-*+]\s+\[([ xX])\]\s+(.*)$/);
      if (!match) return;
      const archived = currentH2 === '已归档任务';
      if (archived && !includeArchived) return;
      const body = match[2];
      if (!body.trim()) return;
      const noteLines = [];
      let cursor = index + 1;
      while (cursor < lines.length) {
        const nextLine = lines[cursor];
        if (/^\s{4,}/.test(nextLine)) {
          noteLines.push(nextLine.replace(/^\s{4}/, ''));
          cursor += 1;
          continue;
        }
        if (/^[-*+]\s+\[[ xX]\]\s+/.test(nextLine)) break;
        if (!nextLine.trim()) break;
        break;
      }

      const scheduled = extractDateToken(body, '⏳');
      const due = extractDateToken(body, '📅');
      const completed = this.extractCompletedDate(body);
      const projectMatch = body.match(/#P\/([^\s]+)/);
      const note = noteLines.join('\n').trim();
      const archiveType = note.includes('知识归档: [[')
        ? 'knowledge'
        : note.includes('留痕归档: [[')
          ? 'evidence'
          : '';
      rows.push({
        line: index,
        path: sourcePath,
        raw: body,
        title: stripTaskMetadata(body),
        scheduled,
        due,
        completed,
        timeRange: extractTimeRange(body),
        project: projectMatch ? projectMatch[1] : '',
        complexityTag: this.extractComplexityTag(body),
        workflowTags: this.extractWorkflowTags(body),
        note,
        done: match[1].toLowerCase() === 'x',
        archived,
        archiveType,
      });
    });

    rows.sort((a, b) => {
      const aKey = a.timeRange || a.scheduled || a.due || a.completed || '99:99';
      const bKey = b.timeRange || b.scheduled || b.due || b.completed || '99:99';
      return String(aKey).localeCompare(String(bKey));
    });
    return rows;
  },

  async getInboxTasks(includeArchived = false) {
    return this.getTasksFromSource(this.getInboxPath(), includeArchived);
  },

  async getTodayTasks() {
    const today = todayString();
    const tasks = await this.getInboxTasks();
    return tasks.filter((task) => !task.done && (
      (task.workflowTags.includes('#daily') && (!task.scheduled || task.scheduled === today)) ||
      task.scheduled === today ||
      task.due === today
    ));
  },

  async createTaskInSource(sourcePath, payload) {
    await this.ensureTaskStorageInitialized();
    await this.ensureSourceFile(sourcePath, '任务面板');
    const file = this.app.vault.getAbstractFileByPath(sourcePath);
    if (!file) {
      new Notice('未找到任务数据源');
      return null;
    }
    const noteLines = payload.note
      ? payload.note.split('\n').map((line) => `    ${line.trimEnd()}`)
      : [];
    const newBlock = [`- [${payload.done ? 'x' : ' '}] ${payload.body}`, ...noteLines].join('\n');
    await this.processTaskFile(file, (content) => {
      const lines = content.split('\n');
      const archiveIndex = this.findArchiveSectionLineIndex(lines);
      if (archiveIndex < 0) {
        return `${content.trimEnd()}\n${newBlock}\n`;
      }
      const before = lines.slice(0, archiveIndex).join('\n').replace(/\s*$/, '');
      const after = lines.slice(archiveIndex).join('\n').replace(/^\s*/, '');
      return `${before}\n${newBlock}\n\n${after}`;
    });
    const tasks = await this.getTasksFromSource(sourcePath);
    return tasks[tasks.length - 1] || null;
  },

  async createInboxTask(payload) {
    return this.createTaskInSource(this.getInboxPath(), payload);
  },

  async ensureFolderPath(folderPath) {
    if (!folderPath) return;
    const parts = folderPath.split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(current)) {
        await this.app.vault.createFolder(current);
      }
    }
  },

  buildArchiveFolderPath(type) {
    const root = this.getArchiveRootPath();
    return type === 'knowledge' ? `${root}/knowledge` : `${root}/evidence`;
  },

  findArchiveSectionLineIndex(lines) {
    return lines.findIndex((line) => /^##\s+已归档任务\s*$/.test(line.trim()));
  },

  ensureArchiveSectionLines(lines) {
    const existingIndex = this.findArchiveSectionLineIndex(lines);
    if (existingIndex >= 0) return existingIndex;
    while (lines.length && !lines[lines.length - 1].trim()) {
      lines.pop();
    }
    if (lines.length) lines.push('');
    lines.push('## 已归档任务');
    lines.push('');
    return lines.length - 2;
  },

  buildArchiveTitle(task, type) {
    const prefix = type === 'knowledge' ? '知识归档' : '留痕归档';
    return `${prefix} - ${task.title}`;
  },

  buildArchiveNoteContent(task, type, archivePath) {
    const followup = this.extractFollowupMeta(task.note || '');
    const { subtasks, note: noteWithoutSubtasks } = this.extractSubtasksFromNote(task.note || '');
    const yaml = (value) => JSON.stringify(String(value || ''));
    const lines = [
      '---',
      `title: ${yaml(this.buildArchiveTitle(task, type))}`,
      `archive_type: ${yaml(type)}`,
      `source_task: ${yaml(`${task.path}:${task.line + 1}`)}`,
      `archived_at: ${yaml(todayString())}`,
      `task_title: ${yaml(task.title)}`,
      `task_status: ${yaml(task.done ? 'done' : 'open')}`,
      `task_project: ${yaml(task.project || '')}`,
      `task_complexity: ${yaml(task.complexityTag || '')}`,
      `task_workflow: ${yaml((task.workflowTags || []).join(', '))}`,
      '---',
      '',
      `# ${this.buildArchiveTitle(task, type)}`,
      '',
      '## 任务概览',
      `- 标题：${task.title}`,
      `- 来源：[[${task.path}]]`,
      `- 原任务定位：${task.path}:${task.line + 1}`,
      `- 归档日期：${todayString()}`,
    ];

    if (task.timeRange) lines.push(`- 时间段：${task.timeRange}`);
    if (task.scheduled) lines.push(`- 计划处理日：${task.scheduled}`);
    if (task.due) lines.push(`- 截止日：${task.due}`);
    if (task.completed) lines.push(`- 完成日：${task.completed}`);
    if (followup.owner) lines.push(`- 责任人：${followup.owner}`);
    if (followup.item) lines.push(`- 事项：${followup.item}`);
    if (followup.confirmBy) lines.push(`- 确认截止：${followup.confirmBy}`);
    if (followup.eta) lines.push(`- 预计完成：${followup.eta}`);

    if (type === 'knowledge') {
      lines.push('', '## 结论 / 可复用知识');
      lines.push('- 这次事情的处理结论是什么？');
      lines.push('- 哪些步骤下次可以直接复用？');
      lines.push('- 有哪些容易踩坑的点？');
      lines.push('', '## 复用步骤');
      if (subtasks.length) {
        subtasks.forEach((subtask) => lines.push(`- ${subtask.title}`));
      } else {
        lines.push('- 暂无结构化步骤，可后续补充');
      }
      lines.push('', '## 背景与补充');
    } else {
      lines.push('', '## 留痕摘要');
      lines.push('- 这件事的来龙去脉是什么？');
      lines.push('- 当时的处理动作和结果是什么？');
      lines.push('- 如果后续追溯，需要重点看哪些材料？');
      lines.push('', '## 时间线 / 处理动作');
      if (subtasks.length) {
        subtasks.forEach((subtask) => lines.push(`- ${subtask.done ? '[已完成] ' : ''}${subtask.title}`));
      } else {
        lines.push('- 暂无拆解步骤记录');
      }
      lines.push('', '## 证据与补充');
    }

    if (noteWithoutSubtasks) {
      lines.push(noteWithoutSubtasks);
    } else {
      lines.push('- 暂无补充说明');
    }

    if (subtasks.length) {
      lines.push('', '## 子任务记录');
      subtasks.forEach((subtask) => {
        const detail = [];
        if (subtask.timeRange) detail.push(subtask.timeRange);
        if (subtask.scheduled) detail.push(`计划:${subtask.scheduled}`);
        if (subtask.due) detail.push(`截止:${subtask.due}`);
        if (subtask.owner) detail.push(`责任人:${subtask.owner}`);
        if (subtask.item) detail.push(`事项:${subtask.item}`);
        lines.push(`- ${subtask.done ? '[已完成] ' : ''}${subtask.title}${detail.length ? `（${detail.join('；')}）` : ''}`);
        if (subtask.note) {
          subtask.note.split('\n').forEach((line) => {
            lines.push(`  ${line}`);
          });
        }
      });
    }

    lines.push('', '## 原始任务记录');
    lines.push('```text');
    lines.push(task.raw);
    lines.push('```');
    lines.push('', `> 归档文件：${archivePath}`);
    return lines.join('\n');
  },

  async appendArchiveLinkToTask(task, archivePath, type) {
    const context = await this.getFileTaskContext(task);
    if (!context) return;
    const label = type === 'knowledge' ? '知识归档' : '留痕归档';
    const archiveLine = `${label}: [[${archivePath}]]`;
    const existingNote = context.note || '';
    if (existingNote.includes(archiveLine)) return;
    const nextNote = existingNote ? `${existingNote}\n${archiveLine}` : archiveLine;
    await this.updateTaskFromPayload(task, {
      done: task.done,
      body: context.body,
      note: nextNote,
    });
  },

  async moveTaskToArchiveSection(task) {
    const context = await this.getFileTaskContext(task);
    if (!context) return;
    await this.processTaskFile(context.file, (content) => {
      const lines = content.split('\n');
      const block = lines.slice(context.lineNumber, context.lineNumber + context.noteLineCount + 1);
      lines.splice(context.lineNumber, context.noteLineCount + 1);
      let archiveIndex = this.ensureArchiveSectionLines(lines);
      while (archiveIndex + 1 < lines.length && !lines[archiveIndex + 1].trim()) {
        archiveIndex += 1;
      }
      const insertionIndex = archiveIndex + 1;
      const payload = lines.length && lines[insertionIndex - 1] && lines[insertionIndex - 1].trim() ? ['', ...block] : block;
      const suffix = insertionIndex < lines.length && lines[insertionIndex] && lines[insertionIndex].trim() ? [''] : [];
      lines.splice(insertionIndex, 0, ...payload, ...suffix);
      return `${lines.join('\n').replace(/\s+$/, '')}\n`;
    });
  },

  async moveTaskOutOfArchiveSection(task) {
    const context = await this.getFileTaskContext(task);
    if (!context) return;
    await this.processTaskFile(context.file, (content) => {
      const lines = content.split('\n');
      const block = lines.slice(context.lineNumber, context.lineNumber + context.noteLineCount + 1);
      lines.splice(context.lineNumber, context.noteLineCount + 1);
      const archiveIndex = this.findArchiveSectionLineIndex(lines);
      const insertionIndex = archiveIndex >= 0 ? archiveIndex : lines.length;
      const needsLeadingGap = insertionIndex > 0 && lines[insertionIndex - 1] && lines[insertionIndex - 1].trim();
      const payload = needsLeadingGap ? ['', ...block] : block;
      const needsTrailingGap = insertionIndex < lines.length && lines[insertionIndex] && lines[insertionIndex].trim();
      const suffix = needsTrailingGap ? [''] : [];
      lines.splice(insertionIndex, 0, ...payload, ...suffix);
      return `${lines.join('\n').replace(/\s+$/, '')}\n`;
    });
  },

  async archiveTask(task, type) {
    const folder = this.buildArchiveFolderPath(type);
    await this.ensureFolderPath(folder);
    const baseName = sanitizeAttachmentName(this.buildArchiveTitle(task, type)) || 'task-archive';
    const datePrefix = window.moment().format('YYYYMMDD-HHmmss');
    let attempt = 0;
    let path = '';
    do {
      const suffix = attempt === 0 ? '' : `-${attempt}`;
      path = `${folder}/${datePrefix}-${baseName}${suffix}.md`;
      attempt += 1;
    } while (this.app.vault.getAbstractFileByPath(path));
    const content = this.buildArchiveNoteContent(task, type, path);
    await this.app.vault.create(path, content);
    await this.appendArchiveLinkToTask(task, path, type);
    await this.moveTaskToArchiveSection(task);
    new Notice(type === 'knowledge' ? '已归档到知识库' : '已归档到留痕库');
    return path;
  },

  async unarchiveTask(task) {
    await this.moveTaskOutOfArchiveSection(task);
    await this.refreshTodayViews();
    new Notice('已撤回归档');
  },
};

module.exports = taskRepository;
