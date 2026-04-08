const { normalizeSpace, todayString, extractDateToken, extractTimeRange, stripTaskMetadata } = require('../utils');
const { SUBTASK_SYNC_BLOCK_TITLE } = require('../constants');
const reports = require('../reports');

const taskNotes = {
  taskToFormState(task) {
    if (!task) {
      return {
        title: '',
        startTime: '',
        endTime: '',
        scheduled: '',
        due: '',
        workflowTag: '',
        projectTag: '',
        complexityTag: '',
        owner: '',
        item: '',
        confirmBy: '',
        eta: '',
        subtasks: [],
        note: '',
        done: false,
      };
    }
    const { subtasks, note: noteWithoutSubtasks } = this.extractSubtasksFromNote(task.note || '');
    const followup = this.extractFollowupMeta(noteWithoutSubtasks);
    const existingTime = this.extractExistingTime(task.raw);
    return {
      title: stripTaskMetadata(task.raw).replace(/^\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}\s+/, '').trim(),
      startTime: existingTime ? existingTime.start : '',
      endTime: existingTime ? existingTime.end : '',
      scheduled: task.scheduled || '',
      due: task.due || '',
      workflowTag: task.workflowTags[0] || '',
      projectTag: task.project ? `P/${task.project}` : '',
      complexityTag: task.complexityTag || '',
      owner: followup.owner,
      item: followup.item,
      confirmBy: followup.confirmBy,
      eta: followup.eta,
      subtasks,
      note: followup.note,
      done: task.done,
    };
  },

  buildTaskPayload(values) {
    const parts = [];
    if (values.startTime && values.endTime) {
      parts.push(`${values.startTime} - ${values.endTime}`);
    }
    parts.push(values.title);
    if (values.scheduled) parts.push(`⏳ ${values.scheduled}`);
    if (values.due) parts.push(`📅 ${values.due}`);
    if (values.done) parts.push(`✅ ${todayString()}`);
    if (values.complexityTag) parts.push(values.complexityTag);
    if (values.workflowTag) parts.push(values.workflowTag);
    if (values.projectTag) parts.push(`#${values.projectTag}`);
    const noteLines = [];
    if (values.owner) noteLines.push(`责任人: ${values.owner}`);
    if (values.item) noteLines.push(`事项: ${values.item}`);
    if (values.workflowTag === '#WAIT' && values.confirmBy) noteLines.push(`确认截止: ${values.confirmBy}`);
    if (values.workflowTag === '#BLOCKED' && values.eta) noteLines.push(`预计完成: ${values.eta}`);
    if (values.note && values.note.trim()) noteLines.push(values.note.trim());
    if (Array.isArray(values.subtasks)) {
      values.subtasks
        .filter((item) => item && (typeof item.title === 'string' || typeof item.body === 'string'))
        .forEach((item) => {
          const body = (item.body || item.title || '').trim();
          if (!body) return;
          noteLines.push(`- [${item.done ? 'x' : ' '}] ${body}`);
          if (item.note && String(item.note).trim()) {
            String(item.note).split('\n').forEach((line) => {
              noteLines.push(`    ${line.trimEnd()}`);
            });
          }
        });
    }
    return {
      done: Boolean(values.done),
      body: normalizeSpace(parts.join(' ')),
      note: noteLines.join('\n').trim(),
    };
  },

  buildSubtaskPayload(values) {
    const parts = [];
    if (values.startTime && values.endTime) {
      parts.push(`${values.startTime} - ${values.endTime}`);
    }
    parts.push(values.title);
    if (values.scheduled) parts.push(`⏳ ${values.scheduled}`);
    if (values.due) parts.push(`📅 ${values.due}`);
    if (values.done) parts.push(`✅ ${todayString()}`);
    if (values.complexityTag) parts.push(values.complexityTag);
    if (values.workflowTag) parts.push(values.workflowTag);

    const noteLines = [];
    if (values.owner) noteLines.push(`责任人: ${values.owner}`);
    if (values.item) noteLines.push(`事项: ${values.item}`);
    if (values.workflowTag === '#WAIT' && values.confirmBy) noteLines.push(`确认截止: ${values.confirmBy}`);
    if (values.workflowTag === '#BLOCKED' && values.eta) noteLines.push(`预计完成: ${values.eta}`);
    if (values.note && values.note.trim()) noteLines.push(values.note.trim());

    return {
      done: Boolean(values.done),
      body: normalizeSpace(parts.join(' ')),
      note: noteLines.join('\n').trim(),
    };
  },

  extractSubtasksFromNote(noteText) {
    const subtasks = [];
    const kept = [];
    if (!noteText) return { subtasks, note: '' };
    const lines = noteText.split('\n');
    let index = 0;
    while (index < lines.length) {
      const rawLine = lines[index];
      const line = rawLine.trim();
      const match = line.match(/^-\s+\[([ xX])\]\s+(.+)$/);
      if (!match) {
        kept.push(rawLine);
        index += 1;
        continue;
      }
      const done = match[1].toLowerCase() === 'x';
      const body = match[2].trim();
      const noteLines = [];
      let cursor = index + 1;
      while (cursor < lines.length) {
        const nextLine = lines[cursor];
        if (/^-\s+\[[ xX]\]\s+/.test(nextLine.trim())) break;
        if (/^\s{4,}/.test(nextLine)) {
          noteLines.push(nextLine.replace(/^\s{4}/, ''));
          cursor += 1;
          continue;
        }
        if (!nextLine.trim()) {
          const followingLine = lines[cursor + 1] || '';
          if (/^\s{4,}/.test(followingLine)) {
            noteLines.push('');
            cursor += 1;
            continue;
          }
          break;
        }
        break;
      }
      const note = noteLines.join('\n').trim();
      const followup = this.extractFollowupMeta(note);
      subtasks.push({
        done,
        body,
        title: stripTaskMetadata(body).replace(/^\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}\s+/, '').trim(),
        timeRange: extractTimeRange(body),
        scheduled: extractDateToken(body, '⏳'),
        due: extractDateToken(body, '📅'),
        workflowTags: this.extractWorkflowTags(body),
        complexityTag: (body.match(/#C[1-5]\b/) || [''])[0],
        owner: followup.owner,
        item: followup.item,
        confirmBy: followup.confirmBy,
        eta: followup.eta,
        note: followup.note,
      });
      index = cursor;
    }
    return { subtasks, note: kept.join('\n').trim() };
  },

  splitSubtaskSyncBlock(noteText) {
    const text = String(noteText || '');
    const marker = `\n${SUBTASK_SYNC_BLOCK_TITLE}`;
    const markerIndex = text.indexOf(marker);
    const startIndex = markerIndex >= 0
      ? markerIndex + 1
      : text.startsWith(SUBTASK_SYNC_BLOCK_TITLE) ? 0 : -1;
    if (startIndex === -1) {
      return { main: text.trim(), sync: '' };
    }
    const before = text.slice(0, startIndex).trim();
    const sync = text.slice(startIndex).trim();

    return {
      main: before,
      sync,
    };
  },

  stripDuplicatedSubtaskNoteLines(baseNote, subtasks) {
    if (!baseNote || !baseNote.trim() || !Array.isArray(subtasks) || !subtasks.length) {
      return (baseNote || '').trim();
    }

    const { main, sync } = this.splitSubtaskSyncBlock(baseNote);

    const subtaskNoteLines = new Set();
    subtasks.forEach((item) => {
      if (!item || !item.note) return;
      String(item.note)
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .forEach((line) => subtaskNoteLines.add(line));
    });

    if (!subtaskNoteLines.size) return [main.trim(), sync].filter(Boolean).join('\n\n').trim();

    const cleanedMain = main
      .split('\n')
      .filter((line) => !subtaskNoteLines.has(line.trim()))
      .join('\n')
      .trim();

    return [cleanedMain, sync].filter(Boolean).join('\n\n').trim();
  },

  buildSubtaskSyncSummary(subtasks) {
    const lines = [SUBTASK_SYNC_BLOCK_TITLE];

    if (!Array.isArray(subtasks) || !subtasks.length) {
      lines.push('- 暂无子任务');
      return lines.join('\n');
    }

    subtasks.forEach((item, index) => {
      const title = item.title || stripTaskMetadata(item.body || '') || `步骤 ${index + 1}`;
      const status = item.done ? '已完成' : '进行中';
      lines.push(`${index + 1}. ${title}`);
      lines.push(`   - 状态：${status}`);
      if (item.timeRange) lines.push(`   - 时间：${item.timeRange}`);
      if (item.scheduled) lines.push(`   - 计划处理日：${item.scheduled}`);
      if (item.due) lines.push(`   - 截止日：${item.due}`);
      const tags = []
        .concat(item.complexityTag ? [item.complexityTag] : [])
        .concat(Array.isArray(item.workflowTags) ? item.workflowTags : [])
        .filter(Boolean);
      if (tags.length) lines.push(`   - 标签：${tags.join(' ')}`);
      if (item.owner) lines.push(`   - 责任人：${item.owner}`);
      if (item.item) lines.push(`   - 事项：${item.item}`);
      if (item.confirmBy) lines.push(`   - 确认截止：${item.confirmBy}`);
      if (item.eta) lines.push(`   - 预计完成：${item.eta}`);

      const note = String(item.note || '').trim();
      if (note) {
        lines.push('   - 补充说明：');
        note.split('\n').forEach((line) => {
          lines.push(`     ${line}`);
        });
      } else {
        lines.push('   - 补充说明：无');
      }
    });

    return lines.join('\n').trim();
  },

  upsertSubtaskSyncSummary(noteText, subtasks) {
    const { main } = this.splitSubtaskSyncBlock(noteText || '');
    const summary = this.buildSubtaskSyncSummary(subtasks);
    return [main, summary].filter(Boolean).join('\n\n').trim();
  },

  composeNoteWithSubtasks(baseNote, subtasks) {
    const lines = [];
    const cleanedBaseNote = this.stripDuplicatedSubtaskNoteLines(baseNote, subtasks);
    if (cleanedBaseNote) lines.push(cleanedBaseNote);
    if (Array.isArray(subtasks)) {
      subtasks
        .filter((item) => item && (typeof item.body === 'string' || typeof item.title === 'string'))
        .forEach((item) => {
          const body = (item.body || item.title || '').trim();
          if (!body) return;
          lines.push(`- [${item.done ? 'x' : ' '}] ${body}`);
          if (item.note && String(item.note).trim()) {
            String(item.note).split('\n').forEach((line) => {
              lines.push(`    ${line.trimEnd()}`);
            });
          }
        });
    }
    return lines.join('\n').trim();
  },

  extractFollowupMeta(noteText) {
    const result = {
      owner: '',
      item: '',
      confirmBy: '',
      eta: '',
      note: '',
    };
    if (!noteText) return result;
    const kept = [];
    noteText.split('\n').forEach((rawLine) => {
      const line = rawLine.trim();
      if (!line) {
        kept.push('');
        return;
      }
      const ownerMatch = line.match(/^责任人\s*[:：]\s*(.+)$/);
      if (ownerMatch) {
        result.owner = ownerMatch[1].trim();
        return;
      }
      const itemMatch = line.match(/^(事项|确认事项|阻塞事项)\s*[:：]\s*(.+)$/);
      if (itemMatch) {
        result.item = itemMatch[2].trim();
        return;
      }
      const confirmMatch = line.match(/^确认截止\s*[:：]\s*(.+)$/);
      if (confirmMatch) {
        result.confirmBy = confirmMatch[1].trim();
        return;
      }
      const etaMatch = line.match(/^预计完成(?:时间)?\s*[:：]\s*(.+)$/);
      if (etaMatch) {
        result.eta = etaMatch[1].trim();
        return;
      }
      kept.push(rawLine);
    });
    result.note = kept.join('\n').trim();
    return result;
  },

  extractCompletedDate(text) {
    const match = text.match(/✅\s*(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : '';
  },

  getTaskProgressSummary(task) {
    return reports.getTaskProgressSummary(task, (note) => this.extractSubtasksFromNote(note));
  },
};

module.exports = taskNotes;
