const { Notice, MarkdownView } = require('obsidian');
const { normalizeSpace, sanitizeAttachmentName, todayString } = require('../utils');

const taskEditing = {
  async updateTaskFromPayload(task, payload) {
    const context = await this.getFileTaskContext(task);
    if (!context) return;
    const nextPrefix = context.prefix.replace(/\[[ xX]\]/, `[${payload.done ? 'x' : ' '}]`);
    await this.processTaskFile(context.file, (content) => {
      const lines = content.split('\n');
      const replacement = [`${nextPrefix}${payload.body}`];
      if (payload.note) {
        payload.note.split('\n').forEach((line) => replacement.push(`    ${line.trimEnd()}`));
      }
      lines.splice(context.lineNumber, context.noteLineCount + 1, ...replacement);
      return lines.join('\n');
    });
    await this.refreshTodayViews();
    if (context.file.path === this.getInboxPath()) {
      this.schedulePrimaryInboxCompaction();
    }
  },

  async saveTaskAttachment(file) {
    const folder = '_assets/task-workflow';
    await this.ensureFolderPath(folder);
    const originalName = file && file.name ? file.name : `image-${Date.now()}.png`;
    const dotIndex = originalName.lastIndexOf('.');
    const ext = dotIndex >= 0 ? originalName.slice(dotIndex) : '';
    const base = sanitizeAttachmentName(dotIndex >= 0 ? originalName.slice(0, dotIndex) : originalName) || 'image';
    let attempt = 0;
    let targetPath = '';
    do {
      const suffix = attempt === 0 ? `${Date.now()}` : `${Date.now()}-${attempt}`;
      targetPath = `${folder}/${base}-${suffix}${ext}`;
      attempt += 1;
    } while (this.app.vault.getAbstractFileByPath(targetPath));
    const buffer = await file.arrayBuffer();
    await this.app.vault.createBinary(targetPath, buffer);
    return targetPath;
  },

  async pickTaskImagesAndAppend(textarea) {
    const files = await this.promptForImageFiles();
    if (!files.length) return;
    const embeds = [];
    for (const file of files) {
      const path = await this.saveTaskAttachment(file);
      embeds.push(`![[${path}]]`);
    }
    const prefix = textarea.value && !textarea.value.endsWith('\n') ? '\n' : '';
    const suffix = textarea.value ? '\n' : '';
    textarea.value = `${textarea.value || ''}${prefix}${embeds.join('\n')}${suffix}`;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    new Notice(`已添加 ${embeds.length} 张图片`);
  },

  async openTaskLocation(task) {
    await this.openFileByPath(task.path);
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || !view.editor) return;
    view.editor.setCursor({ line: task.line, ch: 0 });
    view.editor.scrollIntoView({ from: { line: task.line, ch: 0 }, to: { line: task.line + 1, ch: 0 } }, true);
  },

  async getFileTaskContext(task) {
    const file = this.app.vault.getAbstractFileByPath(task.path);
    if (!file) {
      new Notice('未找到任务来源文件');
      return null;
    }

    const content = await this.app.vault.cachedRead(file);
    const lines = content.split('\n');
    const rawLine = lines[task.line];
    if (typeof rawLine !== 'string') {
      new Notice('未找到任务行');
      return null;
    }

    const match = rawLine.match(/^([-*+]\s+\[[ xX]\]\s+)(.*)$/);
    if (!match) {
      new Notice('该行已不是任务格式');
      return null;
    }

    let noteLineCount = 0;
    const noteLines = [];
    let cursor = task.line + 1;
    while (cursor < lines.length) {
      const nextLine = lines[cursor];
      if (/^\s{4,}/.test(nextLine)) {
        noteLines.push(nextLine.replace(/^\s{4}/, ''));
        noteLineCount += 1;
        cursor += 1;
        continue;
      }
      if (/^[-*+]\s+\[[ xX]\]\s+/.test(nextLine)) break;
      if (!nextLine.trim()) break;
      break;
    }

    return {
      file,
      lineNumber: task.line,
      prefix: match[1],
      body: match[2],
      rawLine,
      note: noteLines.join('\n').trim(),
      noteLineCount,
    };
  },

  async updateFileTaskLine(context, newBody) {
    await this.processTaskFile(context.file, (content) => {
      const lines = content.split('\n');
      lines[context.lineNumber] = `${context.prefix}${normalizeSpace(newBody)}`;
      return lines.join('\n');
    });
    await this.refreshTodayViews();
    if (context.file.path === this.getInboxPath()) {
      this.schedulePrimaryInboxCompaction();
    }
  },

  async replaceFileTaskLine(context, rawLine) {
    await this.processTaskFile(context.file, (content) => {
      const lines = content.split('\n');
      lines[context.lineNumber] = rawLine;
      return lines.join('\n');
    });
    await this.refreshTodayViews();
    if (context.file.path === this.getInboxPath()) {
      this.schedulePrimaryInboxCompaction();
    }
  },

  extractExistingTime(body) {
    const match = body.match(/^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\s+(.*)$/);
    if (!match) return null;
    return {
      start: `${String(match[1].split(':')[0]).padStart(2, '0')}:${match[1].split(':')[1]}`,
      end: `${String(match[2].split(':')[0]).padStart(2, '0')}:${match[2].split(':')[1]}`,
      rest: match[3],
    };
  },

  extractExistingDates(body) {
    const scheduledMatch = body.match(/⏳\s*(\d{4}-\d{2}-\d{2})/);
    const dueMatch = body.match(/📅\s*(\d{4}-\d{2}-\d{2})/);
    return {
      scheduled: scheduledMatch ? scheduledMatch[1] : '',
      due: dueMatch ? dueMatch[1] : '',
    };
  },

  async completeTask(task) {
    const context = await this.getFileTaskContext(task);
    if (!context) return;
    let completedLine = context.rawLine
      .replace(/\[ \]/, '[x]')
      .replace(/\s*✅\s*\d{4}-\d{2}-\d{2}/g, '');
    completedLine = `${normalizeSpace(completedLine)} ✅ ${todayString()}`;
    await this.replaceFileTaskLine(context, completedLine);
    new Notice('已完成任务');
  },

  async extendTaskDueDate(task, days = 1) {
    const context = await this.getFileTaskContext(task);
    if (!context) return;
    const existing = this.extractExistingDates(context.body);
    const base = existing.due || existing.scheduled || todayString();
    const nextDate = window.moment(base, 'YYYY-MM-DD', true).isValid()
      ? window.moment(base, 'YYYY-MM-DD').add(days, 'day').format('YYYY-MM-DD')
      : window.moment().add(days, 'day').format('YYYY-MM-DD');
    let body = context.body.replace(/\s*📅\s*\d{4}-\d{2}-\d{2}/g, '');
    body = `${normalizeSpace(body)} 📅 ${nextDate}`;
    await this.updateFileTaskLine(context, body);
    new Notice(`截止日已延长到 ${nextDate}`);
  },

  async addTaskSubtask(task, title) {
    const context = await this.getFileTaskContext(task);
    if (!context) return;
    const parsed = this.extractSubtasksFromNote(context.note || '');
    const nextSubtasks = [...parsed.subtasks, { done: false, body: title, note: '' }];
    const nextNote = this.composeNoteWithSubtasks(parsed.note, nextSubtasks);
    await this.updateTaskFromPayload(task, {
      done: task.done,
      body: context.body,
      note: nextNote,
    });
    new Notice('已新增步骤');
  },

  async toggleTaskSubtask(task, subtaskIndex, done) {
    const context = await this.getFileTaskContext(task);
    if (!context) return;
    const parsed = this.extractSubtasksFromNote(context.note || '');
    const nextSubtasks = parsed.subtasks.map((item, index) => (
      index === subtaskIndex ? { ...item, done: Boolean(done) } : item
    ));
    const nextNote = this.composeNoteWithSubtasks(parsed.note, nextSubtasks);
    await this.updateTaskFromPayload(task, {
      done: task.done,
      body: context.body,
      note: nextNote,
    });
  },

  async deleteTaskSubtask(task, subtaskIndex) {
    const context = await this.getFileTaskContext(task);
    if (!context) return;
    const parsed = this.extractSubtasksFromNote(context.note || '');
    if (subtaskIndex < 0 || subtaskIndex >= parsed.subtasks.length) return;
    const target = parsed.subtasks[subtaskIndex];
    const ok = window.confirm(`确认删除子任务「${target.title || '未命名子任务'}」吗？`);
    if (!ok) return;
    const nextSubtasks = parsed.subtasks.filter((_, index) => index !== subtaskIndex);
    const nextNote = this.composeNoteWithSubtasks(parsed.note, nextSubtasks);
    await this.updateTaskFromPayload(task, {
      done: task.done,
      body: context.body,
      note: nextNote,
    });
    new Notice('已删除子任务');
  },

  subtaskToFormValues(subtask) {
    if (!subtask) {
      return {
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
      };
    }
    const existingTime = this.extractExistingTime(subtask.body || '');
    return {
      title: subtask.title || '',
      startTime: existingTime ? existingTime.start : '',
      endTime: existingTime ? existingTime.end : '',
      scheduled: subtask.scheduled || '',
      due: subtask.due || '',
      workflowTag: subtask.workflowTags && subtask.workflowTags[0] ? subtask.workflowTags[0] : '',
      complexityTag: subtask.complexityTag || '',
      owner: subtask.owner || '',
      item: subtask.item || '',
      confirmBy: subtask.confirmBy || '',
      eta: subtask.eta || '',
      note: subtask.note || '',
      done: Boolean(subtask.done),
    };
  },
};

module.exports = taskEditing;
