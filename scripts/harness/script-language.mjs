/**
 * INFRA-115 — which committed files are SCRIPTS, and in what language.
 *
 * A scan that judges committed scripts has to answer two halves of one question, and every scan
 * answered both with its own hand-written constant: an extension pattern and a shebang alternation,
 * with nothing checking that the two describe the same population. They did not.
 *
 * MEASURED, in `scan-symlink-following-enumeration.mjs`: `dash`, `ksh` and `ash` were admitted by
 * shebang and had no matching extension entry, so the SAME FILE with the SAME CONTENT was
 *
 *     scripts/sweep       reported
 *     scripts/sweep.ksh   clean
 *
 * That file's own comment claimed the interpreters were "exactly the ones `SCANNED_EXTENSIONS` also
 * admits, and no more", and the commit that wrote the sentence shipped the counter-example. The
 * three names had been copied verbatim out of `scan-shell-portability.mjs`, which carries the
 * identical asymmetry — into the file whose comment cites that scan as the lesson to follow. The
 * lesson copied; the defect copied with it.
 *
 * So the two halves are DERIVED FROM ONE ROW rather than written beside each other. A language is
 * added once, with both of its halves, or it is not added.
 *
 * WHY A TABLE AND NOT A TEST. A test can pin one out-of-set example, which is what the previous one
 * did; it cannot pin the invariant while the invariant is a sentence in a comment. Here the
 * invariant is the data structure: `shebangPatternFor` and `extensionsFor` read the same rows, so
 * there is no second list to disagree with the first.
 */

/**
 * One row per language: what it says it is RUN BY, and how a file in that language is NAMED.
 *
 * THE EXTENSIONS ARE NOT A SECOND LIST. Each interpreter carries the extensions that name a file it
 * runs, and a language's extension set is the union of them. That is the whole mechanism: there is
 * no second place for a language's two halves to disagree, because there is no second place.
 *
 * The first cut of this file did have two lists plus a `namesAreExtensions` flag that decided
 * whether to cross-check them. Red-proofed, the flag was the hole: reintroducing the EXACT original
 * asymmetry — `dash`, `ksh` and `ash` admitted by shebang against `.sh`, `.bash`, `.zsh` — and
 * setting the flag false left the agreement assertion green, because the assertion skipped rows that
 * declared themselves exempt. A check a row can switch off is a check that says yes to the case it
 * exists to refuse, which is the same shape as the defect this file was opened for.
 *
 * An interpreter name is matched as a whole word inside a shebang line, so `python[0-9.]*` covers
 * `python3` and `python3.12`.
 *
 * `contentOnlyExtensions` is for a language nothing runs by a shebang — a YAML document is read for
 * its content and is never executed. A row with no interpreters and no such extensions would scan
 * nothing at all, which `assertLanguageTableAgrees` refuses.
 */
const ROWS = [
  {
    language: 'shell',
    // A shell dialect names its files too: a ksh script is `sweep.ksh`. This pairing IS the fix —
    // measured, `scripts/sweep` with `#!/bin/ksh` was reported and `scripts/sweep.ksh` with the same
    // content was clean, because the two halves were typed in different places.
    interpreters: {
      sh: ['.sh'],
      bash: ['.bash'],
      zsh: ['.zsh'],
      dash: ['.dash'],
      ksh: ['.ksh'],
      ash: ['.ash'],
    },
    contentOnlyExtensions: [],
  },
  {
    language: 'javascript',
    // The names do NOT coincide here — nothing is called `sweep.node` — so the mapping is stated
    // rather than derived from the interpreter's spelling. It is still on the interpreter, so
    // `node` cannot be admitted without saying what a file it runs is called.
    interpreters: { node: ['.mjs', '.cjs', '.js'] },
    contentOnlyExtensions: [],
  },
  {
    language: 'typescript',
    interpreters: { tsx: ['.ts', '.mts', '.cts'], 'ts-node': ['.ts', '.mts', '.cts'] },
    contentOnlyExtensions: [],
  },
  {
    language: 'python',
    interpreters: { 'python[0-9.]*': ['.py'] },
    contentOnlyExtensions: [],
  },
  {
    language: 'yaml',
    interpreters: {},
    contentOnlyExtensions: ['.yml', '.yaml'],
  },
];

export const SCRIPT_LANGUAGES = Object.freeze(
  ROWS.map((row) =>
    Object.freeze({
      language: row.language,
      interpreters: Object.freeze(Object.keys(row.interpreters)),
      extensionsByInterpreter: Object.freeze(row.interpreters),
      extensions: Object.freeze([
        ...new Set([...Object.values(row.interpreters).flat(), ...row.contentOnlyExtensions]),
      ]),
    }),
  ),
);

/** Every language name in the table, for a caller that wants all of them. */
export const ALL_LANGUAGES = Object.freeze(SCRIPT_LANGUAGES.map((row) => row.language));

function rowsFor(languages) {
  const wanted = new Set(languages);
  for (const name of wanted) {
    if (!SCRIPT_LANGUAGES.some((row) => row.language === name)) {
      throw new Error(
        `script-language: no row for '${name}'. A scan asking for a language the table does not ` +
          'have would silently scan nothing, which is the failure this table exists to prevent.',
      );
    }
  }
  return SCRIPT_LANGUAGES.filter((row) => wanted.has(row.language));
}

/** The file extensions that name a script in any of `languages`. */
export function extensionsFor(languages) {
  return new Set(rowsFor(languages).flatMap((row) => [...row.extensions]));
}

/**
 * A shebang matcher for `languages`, or `null` when none of them is ever run by one.
 *
 * `null` rather than a regex that matches nothing, so a caller cannot accidentally shebang-test
 * against an empty alternation — `/^#!.*\b()\b/` matches every shebang line.
 */
export function shebangPatternFor(languages) {
  const names = rowsFor(languages).flatMap((row) => [...row.interpreters]);
  if (names.length === 0) return null;
  return new RegExp(String.raw`^#!.*\b(${names.join('|')})\b`);
}

/**
 * Both halves of the predicate, from the same rows.
 *
 * `isScript(relativePath, content)` is the whole question: a known extension names a script, and an
 * EXTENSIONLESS file is one if it says so. `path.extname` returns '' for a leading-dot name, so
 * `.bashrc` is shebang-tested rather than classified as carrying a `.bashrc` extension and then
 * matching neither branch — a real script that would have been dropped in silence.
 */
export function scriptFilters(languages) {
  const extensions = extensionsFor(languages);
  const shebang = shebangPatternFor(languages);
  return {
    extensions,
    shebang,
    hasScriptExtension(relativePath) {
      return extensions.has(extensionOf(relativePath));
    },
    isScript(relativePath, content) {
      if (extensions.has(extensionOf(relativePath))) return true;
      if (extensionOf(relativePath) !== '') return false;
      return shebang !== null && shebang.test(content);
    },
  };
}

/**
 * The extension of a path, where a LEADING dot is not one.
 *
 * Inlined rather than imported from `node:path` so this module stays dependency-free and so the
 * leading-dot rule — the one both consumers had to discover separately — is stated once.
 */
export function extensionOf(relativePath) {
  const base = relativePath.slice(relativePath.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot);
}

/**
 * The invariant, as an assertion rather than a sentence: every interpreter's language has at least
 * one admitted extension.
 *
 * Exported so the test asserts it over the WHOLE table rather than over one chosen example. The
 * previous test pinned `ksh`, which is why `dash` and `ash` were equally broken and equally green.
 */
export function assertLanguageTableAgrees() {
  const broken = [];
  for (const row of SCRIPT_LANGUAGES) {
    for (const [name, extensions] of Object.entries(row.extensionsByInterpreter)) {
      if (extensions.length === 0) {
        broken.push(`${row.language} runs '${name}' but names no file it runs`);
      }
    }
    if (row.extensions.length === 0) {
      broken.push(`${row.language} admits no extension at all, so it scans nothing`);
    }
  }
  if (broken.length > 0) {
    throw new Error(
      `script-language: ${broken.join('; ')}. The same script is then judged when written one way ` +
        'and ignored when written the other. Add both halves of a language, or neither.',
    );
  }
}
