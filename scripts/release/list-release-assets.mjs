#!/usr/bin/env node
/**
 * #3356 — one shared glob-matcher for release-desktop-app.yml's two asset-matching steps ("Assert
 * packaged artifacts exist and are non-trivial" and "Generate SHA-256 checksums for this OS's
 * installers"), which used to each carry their own copy of
 * `for pattern in $ASSETS; do for f in $pattern; do found+=("$f"); done; done`.
 *
 * That idiom has a real failure mode a duplicated fix would have left in both places: `for f in
 * $pattern` glob-expands correctly, but then WORD-SPLITS the result, so a matched filename containing
 * a space (electron-builder's default artifact names do — e.g. "My App-1.2.3.dmg" is fine, but a
 * product name with a space in it is not unheard of) becomes two array entries instead of one, and
 * every later `sha256sum "$f"` or `wc -c <"$f"` operates on the wrong, nonexistent halves.
 *
 * Matching in Node instead of bash sidesteps the whole class: `glob` returns real filenames as an
 * array, never re-parses them as shell words. The CLI still hands them to bash as a NUL-separated
 * stream (`read -r -d ''`, not `mapfile -d ''` — macOS's system `/bin/bash` is 3.2, which has no
 * `mapfile` builtin at all), which is the one framing bash can split without touching the bytes.
 *
 * Pure core (exported, no I/O beyond the glob read): matchReleaseAssets. The CLI layer only reads
 * argv and writes stdout.
 *
 * Usage:
 *   node scripts/release/list-release-assets.mjs '<space-separated glob patterns>'
 * Prints each match, relative to cwd (POSIX-separated, sorted, deduped), NUL-terminated. Prints
 * nothing and exits 0 when nothing matches — the caller decides whether that is an error, since the
 * two call sites report it differently.
 */
import { pathToFileURL } from 'node:url';

import { globSync } from 'glob';

/**
 * @param {string} patternString one or more whitespace-separated glob patterns, e.g.
 *   "release/*.dmg release/*.zip" — the patterns themselves are authored in the workflow YAML and
 *   never contain spaces, so splitting this string on whitespace is unambiguous; only the FILENAMES
 *   the patterns match might contain spaces, and those never pass through this split.
 * @param {{ cwd: string }} opts directory the patterns are relative to
 * @returns {string[]} matched paths relative to `cwd`, POSIX-separated, sorted, deduped
 */
export function matchReleaseAssets(patternString, { cwd }) {
  const patterns = patternString.split(/\s+/).filter((p) => p.length > 0);
  const matches = new Set();
  for (const pattern of patterns) {
    for (const match of globSync(pattern, { cwd, nodir: true })) {
      matches.add(match.split('\\').join('/'));
    }
  }
  return [...matches].sort();
}

function main() {
  const patternString = process.argv.slice(2).join(' ');
  const matches = matchReleaseAssets(patternString, { cwd: process.cwd() });
  for (const match of matches) {
    process.stdout.write(`${match}\0`);
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
