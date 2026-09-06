/**
 * What `new-spec.mjs` reads OUT of a paired Task record, and how it lays that out.
 *
 * Its own module because the two halves answer different questions: `new-spec.mjs` decides what a
 * draft spec should CONTAIN, and this reads what the Task already SAYS. Only this half needs the
 * frontmatter reader, so the split narrows that dependency too. It also keeps `new-spec.mjs` inside
 * the size its frozen baseline holds (INFRA-181) — moved, never raised.
 *
 * Every exported name is re-exported from `new-spec.mjs`, so no consumer changes.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { asList, asScalar, frontmatterObject } from './frontmatter.mjs';

export const TASKS_DIR = '.agents/tasks';

/**
 * The same slug `allocate-work-item-id.mjs` gives a Task record. The draft's name is not derived from
 * it — the Task's own basename is reused verbatim (see the header) — but the tests build Task records
 * with it, and it stays the one owner of the slug shape on this side.
 */
export function slugify(title) {
  return String(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}
/** First paragraph under a `## <heading>` section, or '' when the section is absent or a stub. */
function sectionParagraph(body, heading) {
  const match = new RegExp(`^##\\s+${heading}\\s*$`, 'm').exec(body);
  if (!match) return '';
  const rest = body.slice(match.index + match[0].length);
  const end = rest.search(/^#{1,3}\s/m);
  const section = (end === -1 ? rest : rest.slice(0, end)).trim();
  const paragraph = section.split(/\n\s*\n/)[0].trim();
  if (paragraph === '' || /^(TODO|TBD)\b/.test(paragraph)) return '';
  return paragraph;
}
/**
 * The paired Task record for `id`: `null` when none exists, a `{ambiguous}` marker when several do.
 *
 * Only the live half is read. A record in `completed/` is finished work, and a spec drafted against
 * it would be planning what already shipped.
 */
export function readTaskRecord(root, id) {
  const dir = path.join(root, TASKS_DIR);
  const idPrefix = new RegExp(`^${escapeRegExp(id)}:\\s*`);
  const matches = readdirSync(dir)
    .filter((name) => name.endsWith('.md') && name.startsWith(`${id}-`))
    .sort();
  if (matches.length === 0) return null;
  if (matches.length > 1) return { ambiguous: matches.map((name) => `${TASKS_DIR}/${name}`) };

  const file = `${TASKS_DIR}/${matches[0]}`;
  const text = readFileSync(path.join(root, file), 'utf8');
  const fm = frontmatterObject(text);
  const fmTitle = asScalar(fm.title).replace(idPrefix, '');
  const h1 = /^#\s+(.+)$/m.exec(text)?.[1]?.replace(idPrefix, '') ?? '';
  const issue = asScalar(fm.issue).match(/(\d+)\s*$/)?.[1];
  const area = asList(fm.area)
    .flatMap((entry) => entry.split(','))
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '' && !/^(TODO|TBD)$/i.test(entry));
  return {
    file,
    title: (fmTitle || h1).trim(),
    status: asScalar(fm.status) || 'todo',
    issue,
    area,
    objective: sectionParagraph(text, 'Objective'),
  };
}
/** The CLI-supplied id is data: `PROC-1.0+` must match its own spelling, never `PROC-1x0:`. */
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
/** A markdown table padded the way prettier pads it, so the generated file is already formatted. */
export function formatTable(header, rows) {
  const all = [header, ...rows];
  const widths = header.map((_, column) =>
    Math.max(3, ...all.map((row) => [...row[column]].length)),
  );
  const line = (row) =>
    `| ${row.map((cell, column) => cell + ' '.repeat(widths[column] - [...cell].length)).join(' | ')} |`;
  const rule = `| ${widths.map((width) => '-'.repeat(width)).join(' | ')} |`;
  return [line(header), rule, ...rows.map(line)].join('\n');
}
