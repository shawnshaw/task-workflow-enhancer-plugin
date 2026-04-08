const { EMPTY_TAB_FOLDER_SCOPE } = require('./constants');

function isTodayDate(dateString, today) {
  return Boolean(dateString) && dateString === today;
}

function isTomorrowDate(dateString, tomorrow) {
  return Boolean(dateString) && dateString === tomorrow;
}

function isDateInCurrentMonth(dateString, momentApi) {
  if (!dateString) return false;
  const date = momentApi(dateString, 'YYYY-MM-DD', true);
  if (!date.isValid()) return false;
  return date.isSame(momentApi(), 'month');
}

function isOverdueTask(task, today) {
  if (task.done) return false;
  return Boolean(task.due && task.due < today);
}

function isWeeklyTaskActiveToday(task, helpers) {
  if (task.done || !task.workflowTags.includes('#weekly')) return false;
  if (!task.scheduled && !task.due) return true;
  return helpers.isDateInCurrentWeek(task.scheduled) || helpers.isDateInCurrentWeek(task.due);
}

function taskMatchesTimeScope(task, scope, helpers) {
  if (scope === 'all') return true;
  if (scope === 'today') {
    if (task.done) return false;
    if (task.workflowTags.includes('#WAIT') || task.workflowTags.includes('#BLOCKED')) return true;
    if (task.workflowTags.includes('#weekly') && isWeeklyTaskActiveToday(task, helpers)) return true;
    return task.workflowTags.includes('#daily') || isTodayDate(task.scheduled, helpers.today) || isTodayDate(task.due, helpers.today);
  }
  if (scope === 'tomorrow') {
    if (task.done) return false;
    return isTomorrowDate(task.scheduled, helpers.tomorrow) || isTomorrowDate(task.due, helpers.tomorrow);
  }
  if (scope === 'week') {
    if (!task.done && (task.workflowTags.includes('#WAIT') || task.workflowTags.includes('#BLOCKED'))) return true;
    return helpers.isDateInCurrentWeek(task.scheduled)
      || helpers.isDateInCurrentWeek(task.due)
      || helpers.isDateInCurrentWeek(task.completed)
      || task.workflowTags.includes('#weekly');
  }
  if (scope === 'month') return isDateInCurrentMonth(task.scheduled, helpers.moment) || isDateInCurrentMonth(task.due, helpers.moment);
  if (scope === 'overdue') return isOverdueTask(task, helpers.today);
  return true;
}

function taskMatchesFolderScope(task, scope, helpers) {
  if (scope === 'all') return true;
  if (scope === EMPTY_TAB_FOLDER_SCOPE) return false;
  if (scope === 'archived') return Boolean(task.archived);
  if (scope === 'archive_knowledge') return Boolean(task.archived && task.archiveType === 'knowledge');
  if (scope === 'archive_evidence') return Boolean(task.archived && task.archiveType === 'evidence');
  if (task.archived) return false;
  if (scope === 'done') return task.done;
  if (scope === 'blocked') return task.workflowTags.includes('#BLOCKED');
  if (scope === 'waiting') return task.workflowTags.includes('#WAIT');
  if (scope === 'today') {
    return !task.done && (
      task.workflowTags.includes('#daily')
      || (task.workflowTags.includes('#weekly') && isWeeklyTaskActiveToday(task, helpers))
      || task.workflowTags.includes('#WAIT')
      || task.workflowTags.includes('#BLOCKED')
    );
  }
  if (scope === 'inbox') {
    return !task.done
      && !task.workflowTags.includes('#daily')
      && !task.workflowTags.includes('#weekly')
      && !task.workflowTags.includes('#WAIT')
      && !task.workflowTags.includes('#BLOCKED');
  }
  return true;
}

function buildTodayFolderCounts(tasks, helpers) {
  const counts = { all: 0, inbox: 0, today: 0, blocked: 0, waiting: 0, done: 0, archived: 0, archive_knowledge: 0, archive_evidence: 0 };
  for (const task of tasks) {
    counts.all += 1;
    if (task.archived) {
      counts.archived += 1;
      if (task.archiveType === 'knowledge') counts.archive_knowledge += 1;
      else if (task.archiveType === 'evidence') counts.archive_evidence += 1;
      continue;
    }
    if (task.done) { counts.done += 1; continue; }
    const isBlocked = task.workflowTags.includes('#BLOCKED');
    const isWaiting = task.workflowTags.includes('#WAIT');
    const isDaily = task.workflowTags.includes('#daily');
    const isWeekly = task.workflowTags.includes('#weekly');
    if (isBlocked) counts.blocked += 1;
    if (isWaiting) counts.waiting += 1;
    if (isDaily || (isWeekly && isWeeklyTaskActiveToday(task, helpers)) || isWaiting || isBlocked) {
      counts.today += 1;
    }
    if (!isDaily && !isWeekly && !isWaiting && !isBlocked) {
      counts.inbox += 1;
    }
  }
  return counts;
}

function getTaskVisualState(task) {
  if (task.archived) return 'archived';
  if (task.done) return 'done';
  if (task.workflowTags.includes('#BLOCKED')) return 'blocked';
  if (task.workflowTags.includes('#WAIT')) return 'waiting';
  return 'open';
}

function buildTaskStatusSummary(tasks) {
  return {
    open: tasks.filter((task) => !task.archived && !task.done && !task.workflowTags.includes('#WAIT') && !task.workflowTags.includes('#BLOCKED')).length,
    waiting: tasks.filter((task) => !task.archived && !task.done && task.workflowTags.includes('#WAIT')).length,
    blocked: tasks.filter((task) => !task.archived && !task.done && task.workflowTags.includes('#BLOCKED')).length,
    done: tasks.filter((task) => !task.archived && task.done).length,
    archived: tasks.filter((task) => task.archived).length,
  };
}

function getFolderScopeLabel(scope) {
  const labels = {
    [EMPTY_TAB_FOLDER_SCOPE]: '空白页',
    all: '全部',
    inbox: '收件箱',
    today: '待办',
    blocked: '阻塞',
    waiting: '等待',
    done: '已完成',
    archived: '已归档',
    archive_knowledge: '知识归档',
    archive_evidence: '留痕归档',
  };
  return labels[scope] || '任务';
}

function buildTaskDisplaySections(tasks, folderScope = 'all') {
  if (folderScope && folderScope !== 'all') {
    return [{ title: getFolderScopeLabel(folderScope), tasks }];
  }
  const sections = [
    { title: '待办', tasks: tasks.filter((task) => !task.done && !task.workflowTags.includes('#WAIT') && !task.workflowTags.includes('#BLOCKED')) },
    { title: '等待确认', tasks: tasks.filter((task) => !task.archived && !task.done && task.workflowTags.includes('#WAIT')) },
    { title: '明确阻塞', tasks: tasks.filter((task) => !task.archived && !task.done && task.workflowTags.includes('#BLOCKED')) },
    { title: '已完成', tasks: tasks.filter((task) => !task.archived && task.done) },
    { title: '已归档', tasks: tasks.filter((task) => task.archived) },
  ];
  return sections.filter((section) => section.tasks.length);
}

module.exports = {
  isTodayDate,
  isTomorrowDate,
  isDateInCurrentMonth,
  isOverdueTask,
  isWeeklyTaskActiveToday,
  taskMatchesTimeScope,
  taskMatchesFolderScope,
  buildTodayFolderCounts,
  getTaskVisualState,
  buildTaskStatusSummary,
  buildTaskDisplaySections,
  getFolderScopeLabel,
};
