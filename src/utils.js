function pad2(value) {
  return String(value).padStart(2, '0');
}

function buildTimeOptions() {
  const values = [];
  for (let hour = 0; hour < 24; hour += 1) {
    for (let minute = 0; minute < 60; minute += 15) {
      values.push(`${pad2(hour)}:${pad2(minute)}`);
    }
  }
  return values;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeSpace(text) {
  return text.replace(/\s{2,}/g, ' ').trim();
}

function sanitizeAttachmentName(name) {
  return String(name || 'image')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function todayString() {
  return window.moment().format('YYYY-MM-DD');
}

function extractDateToken(text, emoji) {
  const match = text.match(new RegExp(`${emoji}\\s*(\\d{4}-\\d{2}-\\d{2})`));
  return match ? match[1] : '';
}

function extractTimeRange(text) {
  const match = text.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
  return match ? `${pad2(match[1].split(':')[0])}:${match[1].split(':')[1]} - ${pad2(match[2].split(':')[0])}:${match[2].split(':')[1]}` : '';
}

function stripTaskMetadata(text) {
  return normalizeSpace(
    text
      .replace(/#daily\b/g, '')
      .replace(/#weekly\b/g, '')
      .replace(/#WAIT\b/g, '')
      .replace(/#BLOCKED\b/g, '')
      .replace(/#C[1-5]\b/g, '')
      .replace(/#P\/[^\s]+/g, '')
      .replace(/\s*⏳\s*\d{4}-\d{2}-\d{2}/g, '')
      .replace(/\s*📅\s*\d{4}-\d{2}-\d{2}/g, '')
      .replace(/\s*✅\s*\d{4}-\d{2}-\d{2}/g, '')
      .replace(/\s*[🔺🔽⏫⏬]/g, '')
  );
}

module.exports = {
  pad2,
  buildTimeOptions,
  escapeRegExp,
  normalizeSpace,
  sanitizeAttachmentName,
  todayString,
  extractDateToken,
  extractTimeRange,
  stripTaskMetadata,
};
