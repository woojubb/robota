import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import { resolveRootItems } from '../record-local-review.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const AGENTS_DIR = path.join(WORKSPACE_ROOT, '.claude/agents');
const SKILLS_DIR = path.join(WORKSPACE_ROOT, '.agents/skills');
const MAP = path.join(WORKSPACE_ROOT, '.agents/specs/orchestration-map.md');
const BACKLOG_DIR = path.join(WORKSPACE_ROOT, '.agents/tasks');

/**
 * A worker told to TAKE a depth verdict must have a pipeline that PRODUCES one.
 *
 * `finding-depth.md` puts the verdict with a guardian and the taking with the worker, which is the
 * right split and also a shape this repository has repeatedly got wrong: the worker carries no
 * `Agent` tool, so it cannot obtain the verdict itself, and if no pipeline hands it one the
 * instruction reads as enforced while nothing can ever satisfy it. Measured 2026-08-01 in #1546 —
 * `architecture-fixer` and `architecture-implementer` shipped with exactly that hole and it was
 * closed by prose, twice, before anything checked it.
 *
 * PROC-005 is the same hole one pipeline over. `doc-fixer` was deliberately left un-wired while the
 * question "what does a foundational DOCUMENTATION finding even mean" was open; wiring it without
 * this check would have re-created the defect the wiring is supposed to remove, since the whole
 * dispatch is one line of markdown that a later edit can drop with nothing failing.
 *
 * This is a reachability floor, not anti-rot: it does not ask whether a file mentions a concept, it
 * asks whether a stated instruction has an actor that can satisfy it.
 */

const DEFINITIONS = readdirSync(AGENTS_DIR)
  .filter((n) => n.endsWith('.md'))
  .map((name) => ({
    name: name.replace(/\.md$/, ''),
    text: readFileSync(path.join(AGENTS_DIR, name), 'utf8'),
  }));

/** `tools:` from the frontmatter, as a list. */
function toolsOf(text) {
  const m = text.match(/^tools:[ \t]*(.+)$/m);
  if (!m) return [];
  return m[1]
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Does this body instruct the agent to RECEIVE a depth verdict rather than to produce one?
 *
 * The marker is a take-verb near the DEPTH token, because that is the sentence every wired site
 * actually writes ("Take the DEPTH verdict", "Take its `DEPTH:` line", "as handed to you"). It is a
 * prose predicate, and a prose predicate can stop matching when someone rewords the sentence — so
 * the pinned-membership case below asserts the known sites are still IN the set. A reword that
 * removes an agent from coverage fails there rather than silently narrowing this floor to nothing,
 * which is the way a check like this normally dies.
 */
export function takesDepthVerdict(text) {
  return /(?:\btakes?\b|\btaking\b|\btaken\b|hands? you|handed to you|given to you)[^.]{0,90}\bDEPTH\b/i.test(
    text,
  );
}

/** Agents that take a verdict they cannot obtain themselves. The producer is excluded by name. */
export function depthTakingAgents(definitions) {
  return definitions
    .filter(({ name }) => name !== 'finding-depth-triager')
    .filter(({ text }) => takesDepthVerdict(text) && !toolsOf(text).includes('Agent'))
    .map(({ name }) => name)
    .sort();
}

const SKILLS = readdirSync(SKILLS_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => ({ name: e.name, file: path.join(SKILLS_DIR, e.name, 'SKILL.md') }))
  .filter((s) => existsSync(s.file))
  .map((s) => ({ ...s, text: readFileSync(s.file, 'utf8') }));

/**
 * Skills that hand this agent a verdict: the body must name the agent AND carry the imperative that
 * produces the verdict.
 *
 * Co-occurrence was the first version, and review measured it too weak to make its own claim true:
 * deleting the dispatch STEP from `documentation-refresh` left the check green, because the skill's
 * agent-roster bullet still named the guardian a few lines up. That is precisely the drift the floor
 * is for — the step goes, the roster line survives, nothing fails.
 *
 * The imperative is required instead, and it costs nothing in false positives because all four wired
 * pipelines already write it verbatim: `documentation-refresh`, `architecture-refresh`,
 * `pr-finding-resolution-loop` and `backlog-execution-orchestrator`. It stays a plain
 * `Dispatch <name>` rather than `scan-orchestration-map`'s sentence reader, whose skip list drops any
 * sentence containing "is the" and therefore cannot see `pr-finding-resolution-loop`'s own dispatch — a
 * floor that fails a correctly-wired site is one somebody switches off.
 *
 * The WORKER side stays a plain mention, deliberately and asymmetrically: `architecture-refresh`
 * routes to its appliers as "call the applier the auditor named — doc-side → `architecture-fixer`",
 * which no imperative-adjacent-to-name reading matches. Requiring symmetry would fail that correctly
 * wired site. The property this half carries is only "the pipeline knows this worker exists"; the
 * guardian half is where the verdict has to be produced, and that is the half tightened.
 */
export function producingSkillsFor(agent, skills) {
  const dispatchesGuardian = /[Dd]ispatch(?:es)?\s+`?finding-depth-triager`?/;
  return skills
    .map((s) => ({ ...s, body: bodyOf(s.text) }))
    .filter((s) => s.body.includes(agent) && dispatchesGuardian.test(s.body))
    .map((s) => s.name);
}

/**
 * The skill BODY — frontmatter excluded. A `description:` that names the guardian describes the
 * pipeline; the procedure is what an agent follows. Demonstrated while red-proving this file: with
 * the dispatch step deleted, the description alone still satisfied a whole-text match, which is the
 * declared-but-unreached shape the check exists to refuse.
 */
function bodyOf(text) {
  const m = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
  return m ? text.slice(m[0].length) : text;
}

/**
 * The map's PIPELINE table: its rows AND the position of the two columns this check reads, both
 * taken from the header.
 *
 * The map holds several tables and the columns mean different things in each. A first version found
 * the header and then still read cells 3 and 4 — review inserted one column into the table and the
 * whole case went vacuous while staying green, because every row's worker cell had shifted and
 * nothing matched. Locating the table and then guessing inside it is not better than guessing; the
 * indices come from the same header line as the rows.
 */
export function pipelineTable(mapText) {
  const lines = mapText.split('\n');
  const header = lines.findIndex(
    (l) => l.startsWith('|') && /\bWorker\(s\)/.test(l) && /\bGuardian\(s\)/.test(l),
  );
  if (header === -1) return { rows: [], worker: -1, guardian: -1, orchestrator: -1, loopback: -1 };
  const cells = lines[header].split('|');
  const rows = [];
  for (const line of lines.slice(header + 2)) {
    if (!line.startsWith('|')) break;
    rows.push(line);
  }
  return {
    rows,
    worker: cells.findIndex((c) => /\bWorker\(s\)/.test(c)),
    guardian: cells.findIndex((c) => /\bGuardian\(s\)/.test(c)),
    orchestrator: cells.findIndex((c) => /\bOrchestrator\b/.test(c)),
    loopback: cells.findIndex((c) => /\bLoop-back\b/.test(c)),
  };
}

describe('a worker told to take a depth verdict has a pipeline that produces one', () => {
  it('finds the definitions and skills to check', () => {
    // Fail closed: a moved directory would make every case below pass over nothing.
    expect(DEFINITIONS.length).toBeGreaterThan(5);
    expect(SKILLS.length).toBeGreaterThan(20);
  });

  it('keeps the known depth-taking workers inside the predicate', () => {
    // Anti-vacuity, and the honest weak point of a prose predicate: if a reword drops one of these
    // out of the set, the case below stops checking it and stays green. This one goes red instead.
    expect(depthTakingAgents(DEFINITIONS)).toEqual(
      expect.arrayContaining([
        'architecture-fixer',
        'architecture-implementer',
        'doc-fixer',
        'pr-review-fixer',
        // Handed the verdict to POST it rather than to act on it, and equally unable to obtain one.
        // Found by review, not by the predicate: its sentence says "hands you … the `DEPTH:` verdict",
        // outside the original verb set — the reword-blindness this pin exists to bound.
        'pr-review-writer',
      ]),
    );
  });

  it.each(depthTakingAgents(DEFINITIONS))(
    '%s is dispatched by a pipeline that also dispatches the depth guardian',
    (agent) => {
      expect(
        producingSkillsFor(agent, SKILLS),
        `${agent} is instructed to take a DEPTH verdict, carries no Agent tool, and no skill both dispatches it and dispatches finding-depth-triager — the instruction has no execution path`,
      ).not.toEqual([]);
    },
  );

  it('records the depth guardian in the map row of every pipeline whose worker takes a verdict', () => {
    // The registry half. `scan-orchestration-map` already refuses a dispatch missing from its row;
    // this refuses the converse gap it cannot see — a row whose worker takes a verdict the row
    // does not show anyone producing. Two disagreeing halves of one wiring is the registry-drift
    // class, and the map is what a reader consults instead of reading four skills.
    const workers = depthTakingAgents(DEFINITIONS);
    const { rows, worker, guardian } = pipelineTable(readFileSync(MAP, 'utf8'));

    // Fail closed on all three: a moved header, a renamed column, or a table this reader located
    // but cannot address are each a state where the loop below asserts nothing and stays green.
    expect(
      rows.length,
      'no pipeline rows found — the table header moved or was renamed',
    ).toBeGreaterThan(5);
    expect(worker, 'no Worker(s) column in the pipeline table header').toBeGreaterThan(0);
    expect(guardian, 'no Guardian(s) column in the pipeline table header').toBeGreaterThan(0);

    // The rows this check actually examined, asserted below. A mutation that shifts every worker
    // cell out from under the reader leaves this at zero, which is the shape the first version of
    // this case failed to notice about itself.
    let examined = 0;
    for (const row of rows) {
      const cells = row.split('|');
      const workerCell = cells[worker] ?? '';
      const guardianCell = cells[guardian] ?? '';
      const carried = workers.filter((w) => workerCell.includes(w));
      if (carried.length === 0) continue;
      examined += 1;
      expect(
        guardianCell,
        `the pipeline row for ${carried.join(', ')} lists no finding-depth-triager among its guardians`,
      ).toContain('finding-depth-triager');
    }
    expect(
      examined,
      'no pipeline row carried a depth-taking worker — this case checked nothing',
    ).toBeGreaterThan(0);
  });
});

/**
 * The document form of the containment label, and the same refusal `record-local-review` applies to
 * the code form: an ID that resolves to no filed item asserts a root item exists.
 *
 * A hold labelled with an item nobody filed is indistinguishable from having ignored the finding —
 * worse than leaving it visibly open, because the label is what stops the next audit round from
 * raising it again. So the label is only worth what it resolves to.
 *
 * PROC-009 removed this file's own containment: the reader read `.agents/tasks[/completed]` while
 * the pipelines routed the filing to a skill that writes `.agents/spec-docs/draft/`, so an item filed
 * on the designed path failed the check that verifies it was filed. The fix was never to widen the
 * reader here — that makes a third answer where the problem is that there is no owner for the first.
 * `finding-depth.md` § "Where a root item lives" is the owner now, and the case below asserts the
 * reader resolves exactly what that section declares.
 */
export function containmentNotes(text) {
  const found = [];
  // Leading whitespace is allowed: a claim inside a list item carries its note indented under it, and
  // anchoring hard at `^>` would let exactly those IDs go unchecked while looking covered.
  const pattern = /^\s*>\s*\*\*Contained\s*[—-]\s*(?:\[)?([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d+)/;
  // Fenced blocks are excluded, and this was not a refinement: the rule document that DEFINES the
  // convention shows it in a ```markdown fence, and the first run of this check failed on its own
  // illustration. A sample of a label is not a label, exactly as a code sample is not code.
  let inFence = false;
  for (const line of text.split('\n')) {
    // Any indentation: an illustration nested inside a list item is indented past four spaces, and
    // reading it as a real label would put an unfiled ID in the tree wearing a passing check.
    if (/^\s*(?:```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = line.match(pattern);
    if (m) found.push(m[1]);
  }
  return found;
}

/**
 * The CODE form of the same label: `Contained — <ID>.` inside a comment.
 *
 * One opening for both forms is `finding-depth.md`'s decision and it is what lets one reader serve
 * them — a convention spelled differently per artifact needs a second reader, and the second reader
 * is the thing PROC-009 measured going wrong. What differs is only where the label may sit: a
 * document's is a blockquote a reader sees, code's is a comment the compiler does not.
 *
 * Restricted to comment LINES on purpose. Without it the check fires on this very file, whose parser
 * cases pass the label as a string literal — a floor whose first false positive is itself.
 */
export function containmentComments(text) {
  const found = [];
  const comment = /^\s*(?:\/\/|\/\*|\*|#|--)/;
  const pattern = /Contained\s*[—-]\s*([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d+)/;
  for (const line of text.split('\n')) {
    if (!comment.test(line)) continue;
    const m = line.match(pattern);
    if (m) found.push(m[1]);
  }
  return found;
}

describe('a containment label names a root item that exists', () => {
  const tracked = (...globs) =>
    execFileSync('git', ['ls-files', ...globs], {
      cwd: WORKSPACE_ROOT,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    })
      .split('\n')
      .filter(Boolean);

  const trackedMarkdown = tracked('*.md');
  // The code half's corpus. CORE-042 carries one in agent-core; ARCH-037 added three more (check-sdk-public-surface.mjs, the framework background-tasks barrel, and scan-barrel-parameter-types.mjs), and saying so is more useful than pretending
  // otherwise: the markdown half had none either until PROC-005 wrote the first one. What the case
  // asserts is over the whole tracked tree, so the first code label to appear is read on the run it
  // appears — which is the property, not the current count.
  const trackedCode = tracked('*.mjs', '*.js', '*.cjs', '*.ts', '*.tsx', '*.sh');

  it('reads the tracked tree', () => {
    // Fail closed (HARNESS-052): an empty listing must not read as "no unresolved labels".
    expect(trackedMarkdown.length).toBeGreaterThan(100);
    expect(trackedCode.length).toBeGreaterThan(100);
    expect(existsSync(BACKLOG_DIR)).toBe(true);
  });

  it('parses the convention, and only the convention', () => {
    expect(containmentNotes('> **Contained — PROC-005.** why\n')).toEqual(['PROC-005']);
    expect(containmentNotes('> **Contained — [PROC-005](../backlog/x.md).** why\n')).toEqual([
      'PROC-005',
    ]);
    expect(containmentNotes('> **Contained — SELFHOST-008-P5-3.** why\n')).toEqual([
      'SELFHOST-008-P5-3',
    ]);
    // Not a note: prose about containment, and an HTML comment — the hidden form the convention
    // rejects, which must not be read as a valid label either.
    expect(containmentNotes('This section is contained under PROC-005.')).toEqual([]);
    expect(containmentNotes('<!-- Contained — PROC-005 -->')).toEqual([]);
    expect(
      containmentNotes('```markdown\n> **Contained — ARCH-042.** an example\n```\n'),
      'an illustration of the convention was read as a use of it',
    ).toEqual([]);
  });

  it('parses the code form, and is not fooled by a label in a string', () => {
    expect(containmentComments('// Contained — PROC-005. the loader owns two resolvers\n')).toEqual(
      ['PROC-005'],
    );
    expect(containmentComments(' * Contained — SELFHOST-008-P5-3. why\n')).toEqual([
      'SELFHOST-008-P5-3',
    ]);
    expect(containmentComments('# Contained — PROC-005. shell scripts carry it too\n')).toEqual([
      'PROC-005',
    ]);
    // Code, not a comment: this file's own parser cases pass the label as data, and reading those as
    // labels would make the check fail on itself.
    expect(
      containmentComments('const label = "Contained — NOSUCH-999.";\n'),
      'a label inside a string literal was read as a label',
    ).toEqual([]);
    expect(containmentComments('// this hold is contained under PROC-005')).toEqual([]);
  });

  it('resolves every label in the tree to a filed backlog item', () => {
    const unresolved = [];
    const sources = [
      ...trackedMarkdown.map((rel) => ({ rel, read: containmentNotes })),
      ...trackedCode.map((rel) => ({ rel, read: containmentComments })),
    ];
    for (const { rel, read } of sources) {
      const file = path.join(WORKSPACE_ROOT, rel);
      if (!existsSync(file)) continue;
      const ids = read(readFileSync(file, 'utf8'));
      if (ids.length === 0) continue;
      const { missing } = resolveRootItems(ids, BACKLOG_DIR);
      for (const id of missing) unresolved.push(`${rel}: ${id}`);
    }

    expect(
      unresolved,
      'a containment label names a backlog item that does not exist — file the root item, or remove the label and leave the finding open',
    ).toEqual([]);
  });
});

/**
 * "File the root item" names a PLACE, and until PROC-009 nothing owned which one.
 *
 * Two consumers picked their own and there were two answers: the review loops routed the filing to
 * `backlog-writer`, which creates `.agents/spec-docs/draft/<ID>.md`, while the floor that verifies the
 * filing resolved `.agents/tasks[/completed]` only — so an item filed on the designed happy path
 * failed the check that exists to confirm it was filed, with the message "file the root item first"
 * about an item that IS filed. Measured 2026-08-01: 125 IDs existed only under `.agents/spec-docs/`.
 *
 * The owner is now `finding-depth.md` § "Where a root item lives". These cases are what makes it an
 * owner rather than a paragraph: one asserts the READER resolves exactly what that section declares,
 * the other asserts no pipeline routes a filing anywhere else.
 */
const RULE = path.join(WORKSPACE_ROOT, '.agents/rules/finding-depth.md');

/** Escape a value interpolated into a pattern. A skill name is data, not syntax. */
function reEscape(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The root-item locations the rule DECLARES — bullet lines under the section that owns them.
 *
 * Read from a heading and a list rather than from prose, because the reader below has to compare
 * against it mechanically. Renaming the heading empties this, and the first case fails rather than
 * passing over nothing.
 */
export function declaredRootItemLocations(ruleText) {
  const start = ruleText.indexOf('## Where a root item lives');
  if (start === -1) return [];
  const end = ruleText.indexOf('\n## ', start + 1);
  const section = ruleText.slice(start, end === -1 ? undefined : end);
  const found = [];
  for (const line of section.split('\n')) {
    const m = line.match(/^- `(\.agents\/[^`]+)`/);
    if (m) found.push(m[1].replace(/\/+$/, ''));
  }
  return found;
}

/** Path literals a skill declares as its own OUTPUT — how a named filer resolves to a location. */
export function declaredOutputPaths(text) {
  const out = new Set();
  for (const sentence of text.replace(/\r?\n/g, ' ').split(/(?<=[.!?][*_`)\]]{0,3})\s+/)) {
    if (!/\b(?:creates?|writes?|produces?|output)\b/i.test(sentence)) continue;
    for (const m of sentence.matchAll(/`(\.agents\/[^`]*)`/g)) out.add(m[1]);
  }
  return [...out];
}

/**
 * Where a document says a root item gets filed — as a path it names, or as the ACTOR it routes to.
 *
 * The actor form is the one that was measured going wrong, and it is the one a path-only reading
 * cannot see: "Route to `backlog-writer` for the root item" names no location at all, which is
 * exactly why nobody noticed that it named a different one. So a named filer resolves through its
 * own declared output, and the destination compared is that.
 */
export function rootItemDestinations(text, actorOutputs) {
  const found = [];
  for (const sentence of text.replace(/\r?\n/g, ' ').split(/(?<=[.!?][*_`)\]]{0,3})\s+/)) {
    if (!/root items?\b/i.test(sentence)) continue;
    // A destination is only claimed by a sentence that FILES. "pass any root items filed at step 4
    // into the repo's gated backlog" names no place and decides none; reading it as a routing
    // instruction would make the check fire on correct prose, which is how a floor gets switched off.
    if (!/\b(?:files?|filed|filing|creates?|writes?|routes?)\b/i.test(sentence)) continue;
    for (const m of sentence.matchAll(/`(\.agents\/[^`]*)`/g)) {
      found.push({ place: m[1], sentence: sentence.trim() });
    }
    for (const [actor, places] of actorOutputs) {
      if (!new RegExp('`' + reEscape(actor) + '`').test(sentence)) continue;
      for (const place of places) found.push({ place, via: actor, sentence: sentence.trim() });
    }
  }
  return found;
}

const declares = (place, locations) =>
  locations.some((dir) => place === dir || place.startsWith(`${dir}/`));

describe('a root item has one place to live, and one reader of it', () => {
  const declared = declaredRootItemLocations(readFileSync(RULE, 'utf8'));

  it('finds the declaration', () => {
    // Fail closed: a renamed heading or a reworded list must not read as "nothing to disagree with".
    expect(
      declared,
      'no root-item location is declared in finding-depth.md § "Where a root item lives"',
    ).not.toEqual([]);
    expect(declared).toContain('.agents/tasks');
  });

  it('the reader resolves exactly the locations the rule declares', () => {
    // A probe per candidate directory, in a throwaway tree: the declared ones, plus the rival tree
    // PROC-009 measured as the second answer. Asserting EQUALITY catches both directions — a rule
    // that declares a place the reader cannot see, and a reader that resolves one the rule dropped.
    const rivals = [
      '.agents/spec-docs/draft',
      '.agents/spec-docs/done',
      '.agents/spec-docs/rejected',
    ];
    // Fail closed HERE too, not only in the case above: with an empty declaration this comparison is
    // `[] === []` and passes while asserting nothing, which is the vacuity a renamed heading buys.
    expect(declared, 'nothing declared — the probe below would compare two empty sets').not.toEqual(
      [],
    );
    const candidates = [...declared, ...rivals.filter((r) => !declared.includes(r))];
    const ids = candidates.map((_, i) => `PROBE-${String(i + 1).padStart(3, '0')}`);
    const tmp = makeTemp('root-item-location-');
    try {
      candidates.forEach((dir, i) => {
        mkdirSync(path.join(tmp, dir), { recursive: true });
        writeFileSync(path.join(tmp, dir, `${ids[i]}-probe.md`), 'probe\n');
      });
      const { resolved } = resolveRootItems(ids, path.join(tmp, '.agents/tasks'));
      const resolvedDirs = resolved.map((id) => candidates[ids.indexOf(id)]).sort();

      expect(
        resolvedDirs,
        'the reader (record-local-review’s resolveRootItems) and finding-depth.md § "Where a ' +
          'root item lives" disagree about where a root item lives — which is PROC-009 itself: two ' +
          'answers, so an item filed on one fails the floor that reads the other',
      ).toEqual([...declared].sort());
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('no pipeline routes a filing anywhere else', () => {
    const actorOutputs = new Map(
      SKILLS.map((s) => [s.name, declaredOutputPaths(s.text)]).filter(([, p]) => p.length > 0),
    );
    // Skills and agents only: routing is what they do. A rule STATES the location, and the statement's
    // own consistency is the case above — while the rule that owns the answer must also be able to
    // name the rejected one without that reading as a route to it.
    const documents = [
      ...SKILLS.map((s) => ({ rel: `.agents/skills/${s.name}/SKILL.md`, text: s.text })),
      ...DEFINITIONS.map((d) => ({ rel: `.claude/agents/${d.name}.md`, text: d.text })),
    ];

    const examined = new Set();
    const wrong = [];
    for (const { rel, text } of documents) {
      for (const d of rootItemDestinations(text, actorOutputs)) {
        examined.add(rel);
        if (declares(d.place, declared)) continue;
        wrong.push(`${rel}: ${d.via ? `${d.via} files to ` : ''}${d.place} — "${d.sentence}"`);
      }
    }

    // Pinned membership, not a count. A predicate that matched nothing would pass this case forever
    // while asserting nothing — the shape PROC-005's own floor was caught in during its review — and
    // a count alone would not notice which of the two routing pipelines had dropped out of it.
    expect(
      [...examined].sort(),
      'a routing pipeline stopped naming where it files the root item, so this case no longer reads it',
    ).toEqual(
      expect.arrayContaining([
        '.agents/skills/architecture-refresh/SKILL.md',
        '.agents/skills/documentation-refresh/SKILL.md',
        '.agents/skills/pr-finding-resolution-loop/SKILL.md',
      ]),
    );
    expect(
      wrong,
      'a pipeline files the root item somewhere finding-depth.md § "Where a root item lives" does ' +
        'not declare. The floor that verifies the filing reads only what that section declares, so ' +
        'the item would be filed and the check would still say "file the root item first"',
    ).toEqual([]);
  });
});

/**
 * A rule stated for every loop, adopted by one, is this repository's signature defect wearing a
 * process hat — so the set of consumers is DERIVED here rather than remembered in prose.
 *
 * `finding-depth.md` states two things as general properties: a loop converges on RESOLVED (fixed /
 * contained / INVALID) rather than on FIXED, and containment in a document is a note at the site,
 * "one convention rather than one per pipeline". PROC-005 brought `documentation-refresh` onto both
 * and left `architecture-refresh` and `pr-finding-resolution-loop` on neither, which is worse than an
 * un-adopted rule: two loops over the same tree then disagree about the same claim, because the one
 * that does not read the label re-raises what the other has already answered (PROC-008).
 *
 * The consumers are the map's pipeline rows that BOTH end on a findings count and carry a depth
 * verdict — a loop that converges on a count is the one that can be pushed into an edit by a finding
 * it must not fix. Rows without a depth verdict are deliberately out: `delegated-refactor-green-gate`
 * converges on a count and has no depth step at all, which is a different gap and not this one.
 */
export function signalOf(text) {
  const m = text.match(/^signal:[ \t]*(.+)$/m);
  return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : null;
}

const SIGNALS = new Map(DEFINITIONS.map((d) => [d.name, signalOf(d.text)]));

/**
 * Is this body's convergence stated as RESOLVED?
 *
 * A proximity window rather than a sentence, because the statement does not fit in one: the pipelines
 * write "it is **resolved**, not **fixed**" and then enumerate the dispositions in the next clause. A
 * sentence-scoped reading would fail all three correctly-written sites, and a floor that fails correct
 * work is one somebody switches off. All three markers are required — the word alone is cheap, and the
 * three dispositions are what the word has to MEAN.
 */
export function convergesOnResolved(body) {
  const text = body.replace(/\s+/g, ' ');
  const WINDOW = 500;
  for (const m of text.matchAll(/\bresolved\b/gi)) {
    const around = text.slice(Math.max(0, m.index - WINDOW), m.index + WINDOW);
    if (/\bcontained\b/i.test(around) && /\bINVALID\b/.test(around)) return true;
  }
  return false;
}

/**
 * Does this guardian EXCLUDE a contained site from the count it emits?
 *
 * Not "does the file contain the word". The property is that the label changes the count, so the
 * label's own opening and the signal it feeds have to be stated together — a definition that merely
 * name-drops the convention still re-raises the claim, and re-raising is the whole failure. The window
 * is generous because the four sites write two or three sentences between the two tokens.
 */
export function excludesContainedFromCount(text) {
  const flat = text.replace(/\s+/g, ' ');
  const WINDOW = 800;
  for (const m of flat.matchAll(/Contained\s*[—-]/g)) {
    const around = flat.slice(Math.max(0, m.index - WINDOW), m.index + WINDOW);
    if (/ACTIONABLE FINDINGS/.test(around)) return true;
  }
  return false;
}

/** Backticked tokens in a table cell — the map writes every agent and skill name that way. */
const namesIn = (cell) => [...String(cell).matchAll(/`([a-z0-9-]+)`/g)].map((m) => m[1]);

/**
 * The pipeline rows this rule governs: they end on a findings count and carry a depth verdict.
 *
 * Column indices come from the header, as everywhere else in this file — a table gaining a column
 * must move the reader, not empty it.
 */
export function findingsCountPipelines(mapText) {
  const { rows, guardian, orchestrator, loopback } = pipelineTable(mapText);
  if (guardian < 0 || orchestrator < 0 || loopback < 0) return [];
  const out = [];
  for (const row of rows) {
    const cells = row.split('|');
    const guardianCell = cells[guardian] ?? '';
    if (!guardianCell.includes('finding-depth-triager')) continue;
    if (!guardianCell.includes('ACTIONABLE FINDINGS')) continue;
    out.push({
      // The FIRST orchestrator named owns the row; the parenthetical ones are shared
      // sub-orchestrations that belong to their own rows and converge on their own conditions.
      orchestrator: namesIn(cells[orchestrator] ?? '')[0] ?? null,
      guardians: namesIn(guardianCell),
      loopback: cells[loopback] ?? '',
    });
  }
  return out;
}

describe('every findings-count loop converges on RESOLVED, and its guardians read the label', () => {
  const mapText = readFileSync(MAP, 'utf8');
  const pipelines = findingsCountPipelines(mapText);
  const skillBody = (name) => {
    const skill = SKILLS.find((s) => s.name === name);
    return skill ? bodyOf(skill.text) : null;
  };

  it('derives the consumers from the map, and finds all of them', () => {
    // Pinned membership, because the derivation is what the whole case rests on: a renamed column, a
    // reworded guardian cell or a dropped signal would silently narrow this to the one pipeline that
    // already complies — which is the defect, passing as its own fix.
    expect(
      pipelines.map((p) => p.orchestrator).sort(),
      'a findings-count pipeline with a depth verdict dropped out of the derivation',
    ).toEqual(['architecture-refresh', 'documentation-refresh', 'pr-finding-resolution-loop']);
  });

  it('takes its columns from the header, so an inserted column moves the reader', () => {
    // The anti-cosmetic property, pinned rather than assumed. The first version of the sibling case
    // above located the table and then read fixed cell indices; review inserted one column and it went
    // vacuous while staying green.
    const table =
      '| Pipeline | Extra | Orchestrator (skill) | Worker(s) | Guardian(s) → signal | Loop-back | Floor |\n' +
      '| --- | --- | --- | --- | --- | --- | --- |\n' +
      '| **X** | z | `x-refresh` | `w` | `a` → ACTIONABLE FINDINGS; `finding-depth-triager` → DEPTH | auto → resolved | f |\n';
    expect(findingsCountPipelines(table)).toEqual([
      {
        orchestrator: 'x-refresh',
        guardians: ['a', 'finding-depth-triager'],
        loopback: ' auto → resolved ',
      },
    ]);
  });

  for (const pipeline of pipelines) {
    it(`${pipeline.orchestrator} states its convergence as RESOLVED`, () => {
      expect(
        pipeline.loopback,
        `the map's Loop-back cell for ${pipeline.orchestrator} still converges on a number. A loop ` +
          'that stops at "no findings left" can only stop by editing something, which for a ' +
          'foundational finding is the patch finding-depth.md forbids',
      ).toMatch(/\bresolved\b/i);

      const body = skillBody(pipeline.orchestrator);
      expect(
        body,
        `${pipeline.orchestrator} has no SKILL.md, so the map names a pipeline nobody runs`,
      ).not.toBeNull();
      expect(
        convergesOnResolved(body),
        `${pipeline.orchestrator} does not state its stop condition as resolved — fixed, contained ` +
          'under a filed root item, or recorded INVALID. The map cell agreeing is not the loop ' +
          'implementing it; the body is what an agent follows',
      ).toBe(true);
    });

    it(`${pipeline.orchestrator}'s guardians read a containment label`, () => {
      const counting = pipeline.guardians.filter((g) => SIGNALS.get(g) === 'ACTIONABLE FINDINGS');
      expect(
        counting,
        `no guardian in the ${pipeline.orchestrator} row declares ACTIONABLE FINDINGS — this case ` +
          'checked nothing',
      ).not.toEqual([]);

      const blind = counting.filter(
        (g) => !excludesContainedFromCount(DEFINITIONS.find((d) => d.name === g)?.text ?? ''),
      );
      expect(
        blind,
        'these guardians produce the count this loop converges on and do not know what a containment ' +
          'label is, so they re-raise a claim the pipeline has already answered — and the loop can ' +
          'then only converge by editing it. finding-depth.md owns the convention',
      ).toEqual([]);
    });
  }
});
