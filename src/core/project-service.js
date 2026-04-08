const { escapeRegExp, extractDateToken, extractTimeRange, stripTaskMetadata } = require('../utils');

const projectService = {
  async getProjectData(projectTag) {
    const target = `#${projectTag}`;
    const rows = [];
    const files = this.app.vault.getMarkdownFiles();

    for (const file of files) {
      const content = await this.app.vault.cachedRead(file);
      const lines = content.split('\n');
      let currentH2 = '';
      lines.forEach((line, index) => {
        const headingMatch = line.match(/^##\s+(.+)$/);
        if (headingMatch) {
          currentH2 = headingMatch[1].trim();
        }
        const match = line.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/);
        if (!match) return;
        const isInboxArchive = file.path === this.getInboxPath() && currentH2 === '已归档任务';
        const body = match[2];
        if (!body.includes(target)) return;
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
          : note.includes('留痕归档: [[') ? 'evidence' : '';
        rows.push({
          line: index,
          path: file.path,
          raw: body,
          title: stripTaskMetadata(body),
          scheduled,
          due,
          completed,
          timeRange: extractTimeRange(body),
          project: projectMatch ? projectMatch[1] : '',
          complexityTag: this.extractComplexityTag(body),
          note,
          workflowTags: this.extractWorkflowTags(body),
          done: match[1].toLowerCase() === 'x',
          archived: isInboxArchive,
          archiveType,
        });
      });
    }

    const activeTasks = rows.filter((task) => !task.archived);
    const sortByActiveDate = (a, b) => {
      const aKey = a.timeRange || a.scheduled || a.due || '9999-99-99';
      const bKey = b.timeRange || b.scheduled || b.due || '9999-99-99';
      return String(aKey).localeCompare(String(bKey));
    };
    const sortByDoneDate = (a, b) => String(b.completed || '').localeCompare(String(a.completed || ''));

    return {
      allTasks: rows,
      openTasks: activeTasks.filter((task) => !task.done && !task.workflowTags.includes('#WAIT') && !task.workflowTags.includes('#BLOCKED')).sort(sortByActiveDate),
      waitingTasks: activeTasks.filter((task) => !task.done && task.workflowTags.includes('#WAIT')).sort(sortByActiveDate),
      blockedTasks: activeTasks.filter((task) => !task.done && task.workflowTags.includes('#BLOCKED')).sort(sortByActiveDate),
      doneTasks: activeTasks.filter((task) => task.done).sort(sortByDoneDate).slice(0, 20),
      thisWeekTasks: rows
        .filter((task) => this.isDateInCurrentWeek(task.scheduled) || this.isDateInCurrentWeek(task.due) || this.isDateInCurrentWeek(task.completed))
        .sort(sortByActiveDate),
    };
  },

  async collectProjectSummaries() {
    const projectTags = await this.collectProjectTags();
    const summaries = await Promise.all(projectTags.map(async (tag) => {
      const [info, data] = await Promise.all([
        this.getProjectInfo(tag),
        this.getProjectData(tag),
      ]);
      return {
        tag,
        title: info?.title || tag,
        status: info?.status || '',
        owner: info?.owner || '',
        phase: info?.phase || '',
        targetDate: info?.targetDate || '',
        risk: info?.risk || '',
        nextAction: info?.nextAction || '',
        openCount: data.openTasks.length,
        waitingCount: data.waitingTasks.length,
        blockedCount: data.blockedTasks.length,
        thisWeekCount: data.thisWeekTasks.length,
        doneCount: data.doneTasks.length,
      };
    }));

    return summaries.sort((a, b) => {
      const aScore = (a.blockedCount * 100) + (a.waitingCount * 10) + a.openCount;
      const bScore = (b.blockedCount * 100) + (b.waitingCount * 10) + b.openCount;
      if (aScore !== bScore) return bScore - aScore;
      return String(a.title || '').localeCompare(String(b.title || ''), 'zh-Hans-CN');
    });
  },

  async getProjectInfo(projectTag) {
    const file = await this.findProjectFileByTag(projectTag);
    if (!file) return null;

    const cache = this.app.metadataCache.getFileCache(file);
    const frontmatter = cache && cache.frontmatter ? cache.frontmatter : {};
    const content = await this.app.vault.cachedRead(file);

    return {
      path: file.path,
      title: frontmatter.title || file.basename,
      status: frontmatter.status || '',
      phase: frontmatter.current_phase || '',
      owner: frontmatter.owner || '',
      area: frontmatter.area || '',
      targetDate: frontmatter.target_date || '',
      goal: this.extractBulletValue(content, '目标'),
      focus: this.extractBulletValue(content, '当前重点'),
      nextAction: frontmatter.next_action || this.extractBulletValue(content, '下一步'),
      risk: this.extractBulletValue(content, '风险 / 阻塞'),
    };
  },

  async findProjectFileByTag(projectTag) {
    const files = this.app.vault.getMarkdownFiles().filter((file) => file.path.startsWith('Projects/'));
    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      const frontmatter = cache && cache.frontmatter ? cache.frontmatter : null;
      if (frontmatter && frontmatter.project_tag === projectTag) return file;
      const tags = cache && Array.isArray(cache.tags) ? cache.tags : [];
      if (tags.some((tag) => tag.tag === `#${projectTag}`)) return file;
    }
    return null;
  },

  extractBulletValue(content, label) {
    const pattern = new RegExp(`^-\\s*${escapeRegExp(label)}：\\s*(.+)$`, 'm');
    const match = content.match(pattern);
    return match ? match[1].trim() : '';
  },

  async collectProjectTags() {
    const tags = new Set();
    const files = this.app.vault.getMarkdownFiles();
    for (const file of files) {
      if (!file.path.startsWith('Projects/')) continue;
      const cache = this.app.metadataCache.getFileCache(file);
      const frontmatter = cache && cache.frontmatter ? cache.frontmatter : null;
      if (frontmatter && typeof frontmatter.project_tag === 'string' && frontmatter.project_tag.trim()) {
        tags.add(frontmatter.project_tag.trim());
      }
      const fileTags = cache && Array.isArray(cache.tags) ? cache.tags : [];
      fileTags.forEach((tag) => {
        if (typeof tag.tag === 'string' && tag.tag.startsWith('#P/')) {
          tags.add(tag.tag.slice(1));
        }
      });
    }
    return Array.from(tags).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
  },
};

module.exports = projectService;
