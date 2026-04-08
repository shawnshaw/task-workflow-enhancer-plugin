const WORKFLOW_TAGS = ['#daily', '#weekly', '#WAIT', '#BLOCKED'];
const TODAY_VIEW_TYPE = 'task-workflow-enhancer-today-view';
const PROJECT_VIEW_TYPE = 'task-workflow-enhancer-project-view';
const DEFAULT_INBOX_PATH = '📥 任务收件箱.md';
const DEFAULT_ARCHIVE_ROOT = '_archives/tasks';
const DEFAULT_BACKUP_ROOT = '_system/task-workflow/backups';
const DEFAULT_WORKSPACE_ROOT = '_system/task-workflow/workspaces';
const TRIAGE_ACTIONS = [
  { label: '今天处理', tag: '#daily' },
  { label: '本周推进', tag: '#weekly' },
  { label: '等待确认', tag: '#WAIT' },
  { label: '明确阻塞', tag: '#BLOCKED' },
];
const COMPLEXITY_TAGS = ['#C1', '#C2', '#C3', '#C4', '#C5'];
const COMPLEXITY_OPTIONS = [
  { tag: '#C1', label: 'C1 · 随手可做' },
  { tag: '#C2', label: 'C2 · 短时处理' },
  { tag: '#C3', label: 'C3 · 需要专注' },
  { tag: '#C4', label: 'C4 · 需要拆解' },
  { tag: '#C5', label: 'C5 · 项目型任务' },
];
const SUBTASK_SYNC_BLOCK_TITLE = '【子任务进展汇总】';
const DEFAULT_WORKSPACE_TABS = [
  { id: 'today', name: 'Today', type: 'workspace', defaultTimeScope: 'today', defaultFolderScope: 'all', locked: true },
  { id: 'tomorrow', name: 'Tomorrow', type: 'workspace', defaultTimeScope: 'tomorrow', defaultFolderScope: 'all', locked: true },
  { id: 'weekly', name: 'Weekly', type: 'workspace', defaultTimeScope: 'week', defaultFolderScope: 'all', locked: true },
  { id: 'project', name: 'Projects', type: 'project', defaultTimeScope: 'all', defaultFolderScope: 'all', locked: true },
];
const DEFAULT_DATA_SOURCES = {
  inboxPath: DEFAULT_INBOX_PATH,
  archiveRoot: DEFAULT_ARCHIVE_ROOT,
  backupRoot: DEFAULT_BACKUP_ROOT,
  workspaceRoot: DEFAULT_WORKSPACE_ROOT,
  autoBackup: true,
  backupRetentionDays: 14,
  backupMaxPerDay: 20,
};
const EMPTY_TAB_FOLDER_SCOPE = '__empty__';

// Precompiled regex patterns (eliminate inline RegExp construction in hot paths)
const RE_TASK_LINE = /^([-*+]\s+\[[ xX]\]\s+)(.*)$/;
const RE_TASK_LINE_BODY = /^([-*+]\s+\[[ xX]\]\s+)(.*)$/;
const RE_HEADING_H2 = /^##\s+(.+)$/;
const RE_HEADING_H3 = /^###\s+(.+)$/;
const RE_WORKFLOW_TAG = /^(?:#WAIT|#BLOCKED|#daily|#weekly)$/;
const RE_DATE_FULL = /^\d{4}-\d{2}-\d{2}$/;
const RE_TIME = /^\d{2}:\d{2}$/;
const WORKFLOW_TAG_SET = new Set(WORKFLOW_TAGS);

// Magic string constants
const TIME_SCOPES = ['today', 'tomorrow', 'week', 'month', 'all', 'overdue'];
const FOLDER_SCOPES = ['all', 'inbox', 'today', 'blocked', 'waiting', 'done', 'archived', 'archive_knowledge', 'archive_evidence'];
const TIMING = {
  STATE_SAVE_DEBOUNCE: 180,
  LAYOUT_READY_DELAY: 80,
  METADATA_CACHE_DELAY: 200,
  COMPACTION_DELAY: 80,
  LAYOUT_CHANGE_DEBOUNCE: 300,
  TAB_NAME_DEBOUNCE: 200,
};

module.exports = {
  WORKFLOW_TAGS,
  WORKFLOW_TAG_SET,
  TODAY_VIEW_TYPE,
  PROJECT_VIEW_TYPE,
  DEFAULT_INBOX_PATH,
  DEFAULT_ARCHIVE_ROOT,
  DEFAULT_BACKUP_ROOT,
  DEFAULT_WORKSPACE_ROOT,
  TRIAGE_ACTIONS,
  COMPLEXITY_TAGS,
  COMPLEXITY_OPTIONS,
  SUBTASK_SYNC_BLOCK_TITLE,
  DEFAULT_WORKSPACE_TABS,
  DEFAULT_DATA_SOURCES,
  EMPTY_TAB_FOLDER_SCOPE,
  RE_TASK_LINE,
  RE_TASK_LINE_BODY,
  RE_HEADING_H2,
  RE_HEADING_H3,
  RE_WORKFLOW_TAG,
  RE_DATE_FULL,
  RE_TIME,
  TIME_SCOPES,
  FOLDER_SCOPES,
  TIMING,
};
