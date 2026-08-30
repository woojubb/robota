/**
 * HARNESS-046 — the SINGLE owner of YAML-frontmatter parsing for every harness script.
 *
 * WHY THIS MODULE EXISTS. Before this, four harness scripts each hand-rolled their own
 * `^<key>:\s*(.+)$` line regex. Every one of them shared the same single-line-only assumption, so a
 * fix in one left the others broken — which is exactly how #1369 shipped: prettier (the repo's SSOT
 * formatter, applied to every `.md` by lint-staged) reflows a YAML flow array past `printWidth` onto
 * several indented lines, and a per-line regex reads the key's value as the empty string. The
 * hazard is armed repo-wide: `.agents/tasks/` alone carries 441 `depends_on: [` and 24 `related: [`
 * flow arrays, and `.claude/agents/*.md` may write `tools:` as a flow array.
 *
 * The fix is structural, not local: ONE parser, imported everywhere. `scripts/harness/__tests__/
 * frontmatter-parser-ssot.test.mjs` is the mechanical floor that fails when any harness script
 * re-forks a frontmatter regex outside this file.
 *
 * Deliberately dependency-free — the repo declares no YAML parser, and a harness scan must run from
 * a bare checkout. It covers exactly the forms this repo's toolchain can produce (see `resolveValue`);
 * it is not a general YAML implementation.
 *
 * Home rationale (HARNESS-046): not `check-spec-doc-frontmatter.mjs` — that is a POLICY GATE with its
 * own `main()`/exit code, and making other scans depend on a gate inverts the dependency direction.
 * Not `shared.mjs` — that is the verify-pipeline module (git, spawnSync, workspace scopes) whose
 * `WORKSPACE_ROOT` is `process.cwd()`; a leaf scan should not drag that in to read a `---` block.
 * A dedicated single-responsibility module also gives the anti-fork floor a one-file allowlist.
 */

const FRONTMATTER_ENTRY_LINE_PATTERN = /^([A-Za-z_][A-Za-z0-9_-]*):(.*)$/u;
const GIT_TRAILER_LINE_PATTERN = /^([A-Za-z0-9][A-Za-z0-9-]*):[ \t]*(.*)$/u;

function parseKeyValueLine(line, pattern) {
  const match = pattern.exec(line);
  return match ? { key: match[1], value: match[2] } : undefined;
}

/** Parse one top-level YAML frontmatter entry without resolving continuation lines. */
export function parseFrontmatterEntryLine(line) {
  return parseKeyValueLine(line, FRONTMATTER_ENTRY_LINE_PATTERN);
}

/** Parse one Git trailer line using Git's token grammar. */
export function parseGitTrailerLine(line) {
  return parseKeyValueLine(line, GIT_TRAILER_LINE_PATTERN);
}

/**
 * Strip ONE layer of surrounding quotes: `"draft"` → `draft`.
 *
 * Conservative on purpose — a value that merely CONTAINS the quote character (`"a" and "b"`) is
 * returned untouched, so a quoted phrase inside a prose value is never mangled.
 */
export function unquote(text) {
  const trimmed = String(text).trim();
  const match = /^(['"])([\s\S]*)\1$/.exec(trimmed);
  if (match && !match[2].includes(match[1])) return match[2].trim();
  return trimmed;
}

/** Split a YAML flow sequence (`[a, b, c]`, possibly already joined from several lines). */
function parseFlowSequence(text) {
  const open = text.indexOf('[');
  const close = text.lastIndexOf(']');
  if (open === -1 || close < open) return undefined;
  return text
    .slice(open + 1, close)
    .split(',')
    .map(unquote)
    .filter((item) => item.length > 0);
}

/**
 * Resolve one key's value from its inline part plus the indented lines beneath it.
 *
 * Handles every form this repo's toolchain produces:
 *   - scalar            `status: draft`
 *   - quoted scalar     `path: ".agents/evals/scenarios/x.md"`
 *   - inline flow list  `tags: [a, b]`
 *   - wrapped flow list `tags:\n  [\n    a,\n    b,\n  ]`   ← what prettier emits past printWidth
 *   - compact wrap      `tags:\n  [a, b]`
 *   - block sequence    `tags:\n  - a\n  - b`
 *   - wrapped scalar    `key:\n  value-on-the-next-line`
 *   - folded/literal    `description: >-\n  line one\n  line two`
 *
 * A folded/literal block's inner indentation is not preserved — this reader answers "what is this
 * key's value", not "reproduce the document".
 */
function resolveValue(inline, continuationLines) {
  const indented = continuationLines.map((line) => line.trim()).filter((line) => line.length > 0);

  if (inline.startsWith('[')) return parseFlowSequence([inline, ...indented].join(' ')) ?? [];
  if (/^[|>][-+]?\d*$/.test(inline)) return indented.join(inline.startsWith('|') ? '\n' : ' ');
  if (inline.length > 0) return unquote(inline);

  if (indented.length === 0) return undefined;
  if (indented[0].startsWith('[')) return parseFlowSequence(indented.join(' ')) ?? [];
  if (indented.every((line) => line.startsWith('-')))
    return indented.map((line) => unquote(line.slice(1))).filter((item) => item.length > 0);

  return unquote(indented.join(' '));
}

/**
 * Locate the `---` frontmatter block. Returns the block's inner text and the body that follows it,
 * or `null` when the file has no frontmatter. CRLF-tolerant.
 */
function locateBlock(text) {
  const normalized = String(text).replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---')) return null;
  const end = normalized.indexOf('\n---', 3);
  if (end === -1) return null;
  const afterFence = normalized.indexOf('\n', end + 1);
  return {
    block: normalized.slice(3, end),
    body: afterFence === -1 ? '' : normalized.slice(afterFence + 1),
  };
}

/**
 * THE frontmatter reader. Maps every top-level key to a string (scalar) or string[] (sequence).
 * Returns `null` when the text carries no frontmatter block.
 *
 * This function — and only this function — owns the `^<key>:` line regex for the whole harness.
 */
export function parseFrontmatterBlock(text) {
  const located = locateBlock(text);
  if (!located) return null;

  const lines = located.block.split('\n');
  const entries = new Map();
  for (let i = 0; i < lines.length; i++) {
    const entry = parseFrontmatterEntryLine(lines[i]);
    if (!entry) continue;

    // Everything indented below the key belongs to this key's value.
    const continuation = [];
    let next = i + 1;
    for (; next < lines.length; next++) {
      if (lines[next].trim() !== '' && !/^\s/.test(lines[next])) break;
      continuation.push(lines[next]);
    }
    entries.set(entry.key, resolveValue(entry.value.trim(), continuation));
    i = next - 1;
  }
  return entries;
}

/**
 * Frontmatter + the body beneath it — for scans that check the document text as well as its keys.
 * `entries` is `null` when there is no frontmatter block (and `body` is then the whole text).
 */
export function splitFrontmatter(text) {
  const located = locateBlock(text);
  if (!located) return { entries: null, body: String(text).replace(/\r\n/g, '\n') };
  return { entries: parseFrontmatterBlock(text), body: located.body };
}

/** The same map as a plain object (`{}` when there is no frontmatter) — convenient for `fm.key`. */
export function frontmatterObject(text) {
  const entries = parseFrontmatterBlock(text);
  return entries ? Object.fromEntries(entries) : {};
}

/** A key's value as a single string: a list joins with ', ', a missing key yields ''. */
export function asScalar(value) {
  if (value === undefined || value === null) return '';
  return Array.isArray(value) ? value.join(', ') : String(value);
}

/** A key's value as a list: a bare scalar counts as a one-item list, a missing key as empty. */
export function asList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') return [value.trim()];
  return [];
}

/** True when a key is absent or carries no usable value (`''`, `[]`, a bare `key:`). */
export function isBlank(value) {
  return asList(value).length === 0;
}
