function isDateInNextWeek(dateString, momentApi) {
  if (!dateString) return false;
  const date = momentApi(dateString, 'YYYY-MM-DD', true);
  if (!date.isValid()) return false;
  const start = momentApi().add(1, 'week').startOf('isoWeek');
  const end = momentApi().add(1, 'week').endOf('isoWeek');
  return date.isBetween(start, end, 'day', '[]');
}

function getTaskProgressSummary(task, extractSubtasksFromNote) {
  const { subtasks } = extractSubtasksFromNote(task.note || '');
  if (!subtasks.length) return '';
  const doneCount = subtasks.filter((item) => item.done).length;
  return `${doneCount}/${subtasks.length} 步`;
}

function formatTaskSummaryLine(task, options = {}) {
  const parts = [];
  if (task.project) parts.push(`项目:${task.project}`);
  if (task.timeRange) parts.push(task.timeRange);
  if (task.scheduled) parts.push(`计划:${task.scheduled}`);
  if (task.due) parts.push(`截止:${task.due}`);
  if (task.completed) parts.push(`完成:${task.completed}`);
  if (options.owner) parts.push(`责任人:${options.owner}`);
  if (options.item) parts.push(`${options.itemLabel || '事项'}:${options.item}`);
  if (options.confirmBy) parts.push(`确认截止:${options.confirmBy}`);
  if (options.eta) parts.push(`预计完成:${options.eta}`);
  if (options.progress) parts.push(`进度:${options.progress}`);
  return parts.length ? `- ${task.title}（${parts.join('；')}）` : `- ${task.title}`;
}

function buildWeeklyReportText(data) {
  const lines = [];
  lines.push(`${data.sourceLabel || '任务'} · 第${data.weekNumber}周任务周报（${data.rangeText}）`);
  lines.push('');
  lines.push('本周完成');
  lines.push(...(data.completed.length ? data.completed : ['- 无']));
  lines.push('');
  lines.push('进行中');
  lines.push(...(data.inProgress.length ? data.inProgress : ['- 无']));
  lines.push('');
  lines.push('等待确认');
  lines.push(...(data.waiting.length ? data.waiting : ['- 无']));
  lines.push('');
  lines.push('阻塞事项');
  lines.push(...(data.blocked.length ? data.blocked : ['- 无']));
  lines.push('');
  lines.push('下周计划');
  lines.push(...(data.nextWeek.length ? data.nextWeek : ['- 无']));
  return lines.join('\n');
}

function generateWeeklyReportFromTasks(tasks, sourceLabel, helpers) {
  const weekStart = helpers.moment().startOf('isoWeek');
  const weekEnd = helpers.moment().endOf('isoWeek');
  const completed = [];
  const inProgress = [];
  const waiting = [];
  const blocked = [];
  const nextWeek = [];
  const nextWeekSeen = new Set();

  tasks.forEach((task) => {
    const followup = helpers.extractFollowupMeta(task.note || '');
    const progress = getTaskProgressSummary(task, helpers.extractSubtasksFromNote);
    const isCompletedThisWeek = task.done && (
      helpers.isDateInCurrentWeek(task.completed)
      || (!task.completed && (helpers.isDateInCurrentWeek(task.scheduled) || helpers.isDateInCurrentWeek(task.due)))
    );

    if (isCompletedThisWeek) {
      completed.push(formatTaskSummaryLine(task, { progress }));
    }

    if (task.done) return;

    if (task.workflowTags.includes('#WAIT')) {
      waiting.push(formatTaskSummaryLine(task, {
        owner: followup.owner,
        item: followup.item,
        itemLabel: '事项',
        confirmBy: followup.confirmBy,
        progress,
      }));
    } else if (task.workflowTags.includes('#BLOCKED')) {
      blocked.push(formatTaskSummaryLine(task, {
        owner: followup.owner,
        item: followup.item,
        itemLabel: '阻塞项',
        eta: followup.eta,
        progress,
      }));
    } else if (
      task.workflowTags.includes('#daily')
      || task.workflowTags.includes('#weekly')
      || helpers.isDateInCurrentWeek(task.scheduled)
      || helpers.isDateInCurrentWeek(task.due)
    ) {
      inProgress.push(formatTaskSummaryLine(task, { progress }));
    }

    const shouldCarryToNextWeek = task.workflowTags.includes('#weekly')
      || task.workflowTags.includes('#WAIT')
      || task.workflowTags.includes('#BLOCKED')
      || isDateInNextWeek(task.scheduled, helpers.moment)
      || isDateInNextWeek(task.due, helpers.moment)
      || helpers.isDateInCurrentWeek(task.scheduled)
      || helpers.isDateInCurrentWeek(task.due);
    if (!shouldCarryToNextWeek) return;

    const line = formatTaskSummaryLine(task, {
      owner: followup.owner,
      item: followup.item,
      itemLabel: task.workflowTags.includes('#BLOCKED') ? '阻塞项' : '事项',
      confirmBy: followup.confirmBy,
      eta: followup.eta,
      progress,
    });
    if (!nextWeekSeen.has(line)) {
      nextWeekSeen.add(line);
      nextWeek.push(line);
    }
  });

  return buildWeeklyReportText({
    sourceLabel,
    weekNumber: weekStart.isoWeek(),
    rangeText: `${weekStart.format('YYYY-MM-DD')} ~ ${weekEnd.format('YYYY-MM-DD')}`,
    completed,
    inProgress,
    waiting,
    blocked,
    nextWeek,
  });
}

module.exports = {
  isDateInNextWeek,
  getTaskProgressSummary,
  formatTaskSummaryLine,
  buildWeeklyReportText,
  generateWeeklyReportFromTasks,
};
