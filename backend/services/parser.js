const XLSX = require('xlsx');

// Parse emails from plain text (paste / .txt)
function parseFromText(text) {
  const results = [];
  const seen = new Set();

  // Split on newlines, commas, semicolons, tabs, spaces
  const tokens = text.split(/[\n\r,;\t ]+/).map(t => t.trim()).filter(Boolean);

  for (const token of tokens) {
    const email = token.toLowerCase().replace(/^[<"']|[>"']$/g, '');
    if (isValidEmail(email) && !seen.has(email)) {
      seen.add(email);
      results.push({ email, name: '' });
    }
  }

  return results;
}

// Parse emails from CSV buffer
function parseFromCSV(buffer) {
  const text = buffer.toString('utf8');
  const lines = text.split(/[\n\r]+/).filter(Boolean);
  const results = [];
  const seen = new Set();

  if (lines.length === 0) return results;

  // Detect header row
  const firstLine = lines[0].toLowerCase();
  const hasHeader = firstLine.includes('email') || firstLine.includes('name') || firstLine.includes('address');
  const startRow = hasHeader ? 1 : 0;

  // Detect delimiter
  const delim = firstLine.includes('\t') ? '\t' : ',';

  // Find email and name column indices from header
  let emailCol = 0;
  let nameCol = -1;

  if (hasHeader) {
    const headers = lines[0].split(delim).map(h => h.trim().toLowerCase().replace(/"/g, ''));
    emailCol = headers.findIndex(h => h.includes('email') || h.includes('address') || h.includes('mail'));
    nameCol = headers.findIndex(h => h.includes('name') || h.includes('first'));
    if (emailCol === -1) emailCol = 0;
  }

  for (let i = startRow; i < lines.length; i++) {
    const cols = lines[i].split(delim).map(c => c.trim().replace(/^"|"$/g, ''));
    const email = (cols[emailCol] || '').toLowerCase().trim();
    const name = nameCol >= 0 ? (cols[nameCol] || '').trim() : '';

    if (isValidEmail(email) && !seen.has(email)) {
      seen.add(email);
      results.push({ email, name });
    }
  }

  return results;
}

// Parse emails from XLSX buffer
function parseFromXLSX(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  const results = [];
  const seen = new Set();

  if (rows.length === 0) return results;

  // Find column keys for email and name
  const keys = Object.keys(rows[0]);
  const emailKey = keys.find(k => /email|address|mail/i.test(k)) || keys[0];
  const nameKey = keys.find(k => /name|first/i.test(k) && k !== emailKey) || null;

  for (const row of rows) {
    const email = String(row[emailKey] || '').toLowerCase().trim();
    const name = nameKey ? String(row[nameKey] || '').trim() : '';

    if (isValidEmail(email) && !seen.has(email)) {
      seen.add(email);
      results.push({ email, name });
    }
  }

  return results;
}

function isValidEmail(str) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(str);
}

// Main parser — detects format from mimetype or filename
function parseEmailList(buffer, filename, mimetype) {
  const ext = (filename || '').split('.').pop().toLowerCase();

  if (ext === 'xlsx' || mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
    return parseFromXLSX(buffer);
  }

  if (ext === 'csv' || mimetype === 'text/csv') {
    return parseFromCSV(buffer);
  }

  // Default: treat as plain text
  return parseFromText(buffer.toString('utf8'));
}

module.exports = { parseEmailList, parseFromText, isValidEmail };
