/** Document/evidence boundary. Gate lifecycle code consumes these helpers but does not own them. */
import { checkpointCheckboxItems } from './checkpoint-evidence-contract.mjs';
import { createHash } from 'node:crypto';

export function sectionBody(text, headingPattern) {
  const lines = String(text).split('\n');
  let fenced = false;
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\s*```/.test(line)) fenced = !fenced;
    if (fenced) continue;
    if (start === -1) {
      if (/^##\s+/.test(line) && headingPattern.test(line.replace(/^##\s+/, '').trim())) start = i;
      continue;
    }
    if (/^##\s+/.test(line)) return { heading: lines[start], body: lines.slice(start + 1, i) };
  }
  return start === -1 ? null : { heading: lines[start], body: lines.slice(start + 1) };
}

function sectionEnd(lines, startIndex) {
  let fenced = false;
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    if (/^\s*```/.test(lines[i])) fenced = !fenced;
    if (!fenced && /^##\s+/.test(lines[i])) return i;
  }
  return lines.length;
}

export function checkboxItems(lines) {
  return checkpointCheckboxItems(lines);
}

export function tableRows(lines) {
  const rows = lines
    .filter((line) => /^\s*\|.*\|\s*$/.test(line))
    .map((line) => line.trim().slice(1, -1).split('|').map((cell) => cell.trim()));
  return rows.filter((cells, index) => index > 0 && !cells.every((cell) => /^:?-+:?$/.test(cell)));
}

export function evidenceEntries(text) {
  const section = sectionBody(text, /^Evidence Log$/i);
  if (!section) return null;
  const entries = [];
  let current = null;
  for (const line of section.body) {
    const heading =
      /^###\s+\[([^\]]+)\]\s*—\s*(✅ PASS|❌ FAIL|🔴 NON-COMPLIANCE)\s*\|\s*(\d{4}-\d{2}-\d{2})/.exec(
        line,
      );
    if (heading) {
      current = { gate: heading[1], verdict: heading[2], date: heading[3], heading: line, lines: [] };
      entries.push(current);
      continue;
    }
    if (/^###\s/.test(line)) {
      current = { gate: null, verdict: null, date: null, heading: line, lines: [] };
      entries.push(current);
      continue;
    }
    if (current) current.lines.push(line);
  }
  return entries;
}

export function statusUpgradeOf(entry) {
  for (const line of entry.lines) {
    const match = /^\*\*Status upgrade:\*\*\s*`?([a-z-]+)`?\s*→\s*`?([a-z-]+)`?/.exec(line);
    if (match) return { from: match[1], to: match[2] };
  }
  return null;
}

export function appendToEvidenceLog(text, entryLines) {
  const lines = String(text).split('\n');
  const start = lines.findIndex((line) => /^##\s+Evidence Log\s*$/i.test(line));
  if (start === -1) throw new Error('the document has no `## Evidence Log` section to write into');
  const end = sectionEnd(lines, start);
  let cut = end;
  while (cut > start + 1 && lines[cut - 1].trim() === '') cut -= 1;
  const after = lines
    .slice(end)
    .filter((line, index, all) => !(index === all.length - 1 && line === ''));
  const out = [...lines.slice(0, cut), '', ...entryLines, ''];
  if (after.length > 0) out.push(...after, '');
  return out.join('\n');
}

export function taskPathFromSpec(text) {
  const section = sectionBody(text, /^Tasks$/i);
  if (!section) return null;
  const match = /\.agents\/tasks\/[^\s`)>\]]+\.md/.exec(section.body.join('\n'));
  return match ? match[0] : null;
}

export function blobIdOf(text) {
  const bytes = Buffer.from(String(text ?? ''), 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

export function stripHtmlComments(text) {
  let out = text;
  for (;;) {
    const next = stripHtmlCommentsOnce(out);
    if (next === out) return out;
    out = next;
  }
}

function stripHtmlCommentsOnce(text) {
  let out = '';
  let from = 0;
  for (;;) {
    const open = text.indexOf('<!--', from);
    if (open === -1) return out + text.slice(from);
    out += text.slice(from, open);
    const close = text.indexOf('-->', open + '<!--'.length);
    if (close === -1) return out;
    from = close + '-->'.length;
  }
}
