/**
 * HARNESS-118 (issue #2248) — resolve a cited task-record path against the tree.
 *
 * A citation of a task-record path is a FACT about where a file is, and four ordinary events make
 * it false without anyone saying so: the record is completed (`git mv` into `completed/`), it is
 * renamed (the slug is part of the path), it is archived out of `.agents/tasks/` entirely, or its
 * ID is reused for a different subject.
 *
 * ## Why resolution is by ID *and* slug
 *
 * Matching on ID alone is worse than not resolving, because it produces a confident wrong answer
 * where a broken link would have produced a noticed one. Three cases in this tree, reached from
 * three directions:
 *
 *   - `CORE-014-shutdown-drops-in-flight-work.md` (allow-missing-artifact: the SUBJECT is that no
 *     commit ever added this slug) — the ID is live and the slug was never real. The only CORE-014
 *     file ever added is the stateless-run-mode record.
 *   - `DIST-002-release-artifact-verification.md` (allow-missing-artifact: the SUBJECT is an id and
 *     a slug that disagree) — the slug is live, under someone else's ID. It belongs to DIST-005;
 *     DIST-002 is a Bun-binary release workflow.
 *   - `CLI-BL-024` and `CLI-BL-019` — one ID, two archived subjects each. An ID-only resolver picks
 *     one of two and is right by luck half the time, which is not right.
 *
 * So a disagreement between the two axes is the FINDING (`conflict`), never something to resolve
 * past. It is the outcome this module exists for, and the only one that must never be auto-repaired.
 */

import path from 'node:path';

/** `DOMAIN-NNN` at the start of a record basename, allowing multi-segment domains (`CLI-BL-024`). */
const ID_PATTERN = /^([A-Z][A-Z0-9]*(?:-[A-Z][A-Z0-9]*)*-\d+(?:-P\d+)?)(?:-(.+))?$/;

/** Directories whose documents are FROZEN HISTORY: excluded as a citation source. */
const HISTORY_SOURCES = [
  '.agents/archive/',
  '.design/',
  '.agents/daily-reports/',
  '.agents/spec-docs/done/',
  '.agents/tasks/completed/',
];

/**
 * Directories searched when RESOLVING a citation.
 *
 * History is excluded as a source and INCLUDED as a target, and the two lists must not be shared.
 * A completed record still exists — reporting it as missing is the most alarming verdict available
 * for the least alarming cause, and four citations in this tree are in exactly that position.
 *
 * Only TASK RECORDS resolve a task-record citation. `.agents/spec-docs/` is deliberately absent: a
 * spec-doc is a different document with the same ID, and answering "where is the record" with a
 * spec-doc is the same class of confident wrong answer that ID-only matching produces. Where only a
 * spec-doc survives, the honest answers are `conflict` and `dangling`, and both are here.
 */
const RESOLUTION_ROOTS = ['.agents/tasks/', '.agents/archive/task-breakdowns/'];

/** Split a record basename into its work-item ID and slug. Returns null when it is not a record. */
export function parseRecordName(basename) {
  const stem = basename.endsWith('.md') ? basename.slice(0, -3) : basename;
  const match = ID_PATTERN.exec(stem);
  if (!match) return null;
  return { id: match[1], slug: match[2] ?? '' };
}

/** Whether a citing file is frozen history rather than a live claim. */
export function isHistorySource(file) {
  return HISTORY_SOURCES.some((prefix) => file.startsWith(prefix));
}

/** Every candidate record the tree holds, indexed by ID and by slug. */
export function indexRecords(files) {
  const byId = new Map();
  const bySlug = new Map();
  for (const file of files) {
    if (!RESOLUTION_ROOTS.some((root) => file.startsWith(root))) continue;
    if (!file.endsWith('.md')) continue;
    const parsed = parseRecordName(path.basename(file));
    if (!parsed) continue;
    if (!byId.has(parsed.id)) byId.set(parsed.id, []);
    byId.get(parsed.id).push({ file, ...parsed });
    if (parsed.slug) {
      if (!bySlug.has(parsed.slug)) bySlug.set(parsed.slug, []);
      bySlug.get(parsed.slug).push({ file, ...parsed });
    }
  }
  return { byId, bySlug };
}

/**
 * Classify one cited path.
 *
 * `exact` — the file is where the citation says.
 * `moved` — same ID and slug, different directory under `.agents/tasks/`.
 * `archived` — same ID and slug, but the record left `.agents/tasks/` for the archive.
 * `renamed` — the ID resolves and the cited slug is a prefix of the record's (or absent).
 * `conflict` — the ID and the slug lead to DIFFERENT records, or one leads somewhere and the other
 *   leads elsewhere. Never repaired automatically.
 * `dangling` — neither axis resolves.
 */
export function classifyCitation(cited, index, exists) {
  if (exists(cited)) return { outcome: 'exact', actual: cited };

  const parsed = parseRecordName(path.basename(cited));
  if (!parsed) return { outcome: 'dangling', actual: undefined };

  const byId = index.byId.get(parsed.id) ?? [];
  const bySlug = parsed.slug ? (index.bySlug.get(parsed.slug) ?? []) : [];

  // The slug is the stronger axis: it names the subject, and a subject does not change identity
  // when an ID is reassigned. Where both resolve and disagree, that disagreement IS the answer.
  const idFiles = new Set(byId.map((entry) => entry.file));
  const slugFiles = new Set(bySlug.map((entry) => entry.file));

  if (idFiles.size > 0 && slugFiles.size > 0) {
    const agreed = [...slugFiles].filter((file) => idFiles.has(file));
    if (agreed.length === 0) {
      return { outcome: 'conflict', actual: undefined, id: [...idFiles], slug: [...slugFiles] };
    }
    return { ...placement(cited, agreed[0]), actual: agreed[0] };
  }

  // Only the slug resolves: the ID in the citation belongs to nobody, or to someone else entirely.
  if (slugFiles.size > 0) {
    const other = index.byId.get(parsed.id);
    if (other && other.length > 0) {
      return {
        outcome: 'conflict',
        actual: undefined,
        id: other.map((e) => e.file),
        slug: [...slugFiles],
      };
    }
    return { outcome: 'conflict', actual: undefined, id: [], slug: [...slugFiles] };
  }

  // Only the ID resolves. A cited slug that the record does not carry is a fabricated slug, not a
  // rename — `CORE-014-shutdown-drops-in-flight-work` is the case, and repointing it would make a
  // false citation look verified.
  if (idFiles.size > 0) {
    if (!parsed.slug) {
      // A bare-id citation carries no slug to disambiguate with, so one ID holding two subjects has
      // no answer here. Taking the first is the coin flip this module exists to refuse — right half
      // the time, and confident either way.
      if (idFiles.size > 1)
        return { outcome: 'conflict', actual: undefined, id: [...idFiles], slug: [] };
      return { ...placement(cited, byId[0].file), actual: byId[0].file };
    }
    const extending = byId.filter((entry) => entry.slug.startsWith(parsed.slug));
    if (extending.length === 1)
      return { ...placement(cited, extending[0].file), actual: extending[0].file };
    return { outcome: 'conflict', actual: undefined, id: [...idFiles], slug: [] };
  }

  return { outcome: 'dangling', actual: undefined };
}

/**
 * Which of the three placement outcomes a resolved record is.
 *
 * The directory decides first, because that is what a repair has to change. `renamed` is what is
 * left when the directory did NOT change and only the file name did — a real case (a slug gains a
 * word), and one an earlier version of this file could not report: the branch that should have
 * produced it fell through to this function, so `renamed` existed in the prose, in the output-group
 * list, and nowhere in the returned values. A documented outcome no input can produce is a claim
 * about behaviour that nothing holds to.
 */
function placement(cited, actual) {
  const wasTask = cited.startsWith('.agents/tasks/');
  const isTask = actual.startsWith('.agents/tasks/');
  if (wasTask && !isTask) return { outcome: 'archived' };
  if (path.dirname(cited) === path.dirname(actual)) return { outcome: 'renamed' };
  return { outcome: 'moved' };
}
