#!/usr/bin/env node

/**
 * A TUI render site cannot reach the terminal except through `SafeText` (#2222).
 *
 * `packages/agent-transport-tui/src/SafeText.tsx` sanitizes every string child before Ink sees it.
 * That boundary is worth exactly as much as this scan: without it, `SafeText` is one more thing to
 * remember, which is the shape SEC-019 measured failing three times in six review rounds. So every
 * OTHER production module in the package is refused a `Text` import from `ink` — the plain form,
 * the aliased form (`Text as T`), and the namespace form (`* as ink`, through which `ink.Text` is
 * reachable). Tests and fixtures are exempt: a test that renders raw Ink `Text` to PROVE a leak is
 * how the boundary's own suite stays falsifiable.
 *
 * The boundary has a SECOND direction, and it failed the same way (SCREEN-006). `renderMarkdown`
 * sanitizes the untrusted markdown BEFORE `marked-terminal` styles it, so the SGR in its output is
 * this package's own — the heading emphasis, the `tui-ansi-palette` diff colours. Passing that
 * output back through `SafeText` strips exactly that styling, and strips it SILENTLY: the frame
 * still renders, just colourless, so every assertion on text stays green. `SafeText.tsx` exports
 * `RenderedText` for this one case, and the second rule below refuses `renderMarkdown(...)` as a
 * child of the sanitizing component. One scan owns both directions because they are one boundary:
 * a render site on the wrong side of it is a defect either way.
 *
 * Reads the tracked tree only (git ls-files), so a clone judges it offline; reports `::examined::`
 * per HARNESS-057.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);
const PACKAGE_SRC = 'packages/agent-transport-tui/src';
export const BOUNDARY_MODULE = `${PACKAGE_SRC}/SafeText.tsx`;

// One statement at a time: the clause cannot cross a `;`, so a later `from 'ink'` in the file does
// not pull an unrelated import (e.g. `{ Text } from './SafeText.js'`) into this match.
const IMPORT_FROM_INK = /import\s+(type\s+)?([^;]*?)\s+from\s+['"]ink['"]/g;

function isExempt(relative) {
  return (
    relative === BOUNDARY_MODULE ||
    relative.includes('/__tests__/') ||
    /\.test\.tsx?$/.test(relative) ||
    /\.d\.ts$/.test(relative)
  );
}

/** Every way `ink`'s `Text` becomes reachable from one import statement's clause. */
export function offendingImportForms(clause) {
  const forms = [];
  if (/^\*\s+as\s+\w+/.test(clause.trim())) forms.push('namespace');
  const named = clause.match(/\{([\s\S]*?)\}/);
  if (named) {
    for (const raw of named[1].split(',')) {
      const spec = raw.trim().replace(/^type\s+/, '');
      if (spec === 'Text') forms.push('plain');
      else if (/^Text\s+as\s+\w+$/.test(spec)) forms.push('aliased');
    }
  }
  return forms;
}

/** The renderer whose output already carries this package's own SGR. */
export const RENDERER = 'renderMarkdown';

const IMPORT_FROM_SAFE_TEXT = /import\s+(type\s+)?([^;]*?)\s+from\s+['"]\.\/SafeText\.js['"]/g;

/**
 * The local names in one module that resolve to the SANITIZING component.
 *
 * `SafeText` and its `Text` alias sanitize; `RenderedText` deliberately does not. An alias is
 * followed (`SafeText as S`) because the rule is about which component the JSX names, not which
 * identifier the import statement happened to use.
 */
export function sanitizingLocalNames(source) {
  const names = [];
  for (const match of source.matchAll(IMPORT_FROM_SAFE_TEXT)) {
    if (match[1]) continue; // a type-only import renders nothing
    const named = match[2].match(/\{([\s\S]*?)\}/);
    if (!named) continue;
    for (const raw of named[1].split(',')) {
      const spec = raw.trim().replace(/^type\s+/, '');
      if (!spec) continue;
      const aliased = spec.match(/^(\w+)\s+as\s+(\w+)$/);
      const imported = aliased ? aliased[1] : spec;
      if (imported !== 'SafeText' && imported !== 'Text') continue;
      names.push(aliased ? aliased[2] : imported);
    }
  }
  return names;
}

/**
 * Every `<Sanitizing>` element in `source` whose children carry the renderer's output.
 *
 * Two shapes reach it: the call written inline in the child expression, and the call bound to a
 * local first. Anything further — the string crossing a function boundary or arriving as a prop —
 * is out of a text scan's reach, and is what the `RenderedText` contract in `SafeText.tsx` covers.
 */
export function findStyleStrippingSites(source, names) {
  const bound = [
    ...source.matchAll(new RegExp(`(?:const|let|var)\\s+(\\w+)[^=\\n]*=\\s*${RENDERER}\\(`, 'g')),
  ].map((match) => match[1]);
  const sites = [];
  for (const name of names) {
    for (const open of source.matchAll(new RegExp(`<${name}(?=[\\s/>])[^>]*>`, 'g'))) {
      if (open[0].endsWith('/>')) continue; // self-closing: no children
      const start = open.index + open[0].length;
      const end = source.indexOf(`</${name}>`, start);
      const body = source.slice(start, end === -1 ? source.length : end);
      const carriesRendererOutput =
        body.includes(`${RENDERER}(`) ||
        bound.some((local) => new RegExp(`\\{[^}]*\\b${local}\\b`).test(body));
      if (!carriesRendererOutput) continue;
      sites.push({ line: source.slice(0, open.index).split('\n').length, component: name });
    }
  }
  return sites.sort((a, b) => a.line - b.line);
}

export function findBoundaryViolations(root = WORKSPACE_ROOT) {
  const listed = spawnSync('git', ['ls-files', '--', PACKAGE_SRC], { cwd: root, encoding: 'utf8' });
  if (listed.status !== 0) throw new Error(`git ls-files failed: ${listed.stderr}`);
  const files = listed.stdout
    .split('\n')
    .filter((file) => /\.(ts|tsx)$/.test(file) && !isExempt(file));
  const violations = [];
  const strippedStyling = [];
  for (const relative of files) {
    const text = readFileSync(path.join(root, relative), 'utf8');
    for (const match of text.matchAll(IMPORT_FROM_INK)) {
      if (match[1]) continue; // a type-only import renders nothing
      for (const form of offendingImportForms(match[2])) {
        const line = text.slice(0, match.index).split('\n').length;
        violations.push({ file: relative, line, form });
      }
    }
    for (const site of findStyleStrippingSites(text, sanitizingLocalNames(text))) {
      strippedStyling.push({ file: relative, ...site });
    }
  }
  return { examined: files.length, violations, strippedStyling };
}

function reportInkTextImports(violations) {
  console.error(
    "✗ tui-safe-text-boundary: a render site imports ink's Text outside SafeText.tsx (#2222).",
  );
  console.error("  Import { Text } from './SafeText.js' instead; it sanitizes every string child.");
  for (const v of violations)
    console.error(`  ${v.file}:${v.line}: ${v.form} import of Text from 'ink'`);
}

function reportStrippedStyling(sites) {
  console.error(
    `✗ tui-safe-text-boundary: ${RENDERER} output reaches a sanitizing component, whose sanitizer`,
  );
  console.error("  strips the renderer's own colours (SCREEN-006).");
  console.error(
    `  Render it with { RenderedText } from './SafeText.js'; ${RENDERER} sanitizes its INPUT.`,
  );
  for (const site of sites)
    console.error(
      `  ${site.file}:${site.line}: <${site.component}> child carries ${RENDERER} output`,
    );
}

function main() {
  const { examined, violations, strippedStyling } = findBoundaryViolations();
  console.log(`::examined:: ${examined} agent-transport-tui production module(s)`);
  if (violations.length === 0 && strippedStyling.length === 0) {
    console.log('✓ tui-safe-text-boundary: only SafeText.tsx imports Text from ink');
    console.log(`✓ tui-safe-text-boundary: no ${RENDERER} output is sanitized a second time`);
    return;
  }
  if (violations.length > 0) reportInkTextImports(violations);
  if (strippedStyling.length > 0) reportStrippedStyling(strippedStyling);
  process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main();
}
