/**
 * The ONE parser for "which statements in this file reference module X" (issue #2206).
 *
 * `scan-interface-family-owner.mjs` and every migration codemod over the interface packages ask the
 * same question, and answered it with independently written regular expressions. The scan's was
 * debugged twice (HARNESS-116: blind to extension-less imports and to every `export … from`; PR #2183:
 * blind to `export *`); a throwaway codemod written the same week matched only `import` and left 24
 * multi-line `export type { … } from` re-exports pointing at a package that no longer exported them.
 * Documenting the forms in the scan's header did not reach the codemod, because the codemod author
 * was not reading the scan's header. Sharing the parser does: a codemod that imports
 * `findModuleReferences` cannot be blind to a form the scan can see.
 *
 * **A codemod that rewrites module references MUST import this module** rather than write its own
 * `import`-matching expression. The same rule `interface-layers.mjs` (ARCH-101) states for the edge
 * predicate two guards share.
 *
 * Forms handled — each one is a fixture in `__tests__/module-reference-forms.test.mjs`:
 *
 *   - `import { a, b } from './x'` and `export { a, b } from './x'` (either keyword)
 *   - the `type` variant of both (`import type { … }`, `export type { … }`), and inline `type a`
 *   - `import * as ns from './x'` and `export * from './x'` (braceless: no symbol is named)
 *   - a relative specifier with `.js`, `.ts`, `.mjs`, `.mts` or NO extension
 *   - a multi-line named clause (the brace may span lines; Prettier writes it that way)
 *   - `… from '<internalPackagePrefix>interface-<family>'` — the CROSS-PACKAGE form a relative
 *     import turns into once a leaf moves a family out (ARCH-105)
 *
 * Residual limits, stated because a form outside this list is a silently dropped edge: single-quoted
 * specifiers only; no default import (`import x from`); no dynamic `import()`; relative targets are
 * a single `./<kebab-name>` segment (the contract modules' own shape). A form beyond these is the
 * cue to move to an AST parse (`lib/ts-ast.mjs`), not to add a fourth expression.
 */

/** Escape a literal for use inside a RegExp source. */
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/** Relative target: `./<name>` with any of the handled extensions, or none. */
const RELATIVE_TARGET = String.raw`'\.\/([a-z-]+)(?:\.m?[jt]s)?'`;

/** `export * from './x'` and `import * as ns from './x'`. */
export const RELATIVE_BARE_REFERENCE = new RegExp(
  String.raw`(?:export\s+\*|import\s+\*\s+as\s+[A-Za-z_$][\w$]*)\s+from\s*` + RELATIVE_TARGET,
  'gms',
);

/** `import { … } from './x'`, `export { … } from './x'`, and the `type` variant of each. */
export const RELATIVE_NAMED_REFERENCE = new RegExp(
  String.raw`(?:import|export)\s+(?:type\s+)?\{([^}]*)\}\s*from\s*` + RELATIVE_TARGET,
  'gms',
);

/**
 * `import|export [type] { … } | * [as ns] from '<internalPackagePrefix>interface-<family>'`.
 *
 * The prefix is configuration (`harness.config.json` → `internalPackagePrefix`, scope included), not
 * a literal: a hardcoded scope does not FAIL when the scope changes, it matches nothing, and matching
 * nothing reads as a pass.
 */
export function packageReferencePattern(internalPackagePrefix) {
  return new RegExp(
    String.raw`(?:import|export)\s+(?:type\s+)?(?:\{[^}]*\}|\*(?:\s+as\s+[A-Za-z_$][\w$]*)?)\s*from\s*'` +
      escapeRegExp(internalPackagePrefix) +
      String.raw`(interface-[a-z-]+)'`,
    'gms',
  );
}

/** The LOCAL names a named clause binds: `type a as b` → `a`; empty and malformed entries dropped. */
export function namedClauseSymbols(clause) {
  const symbols = [];
  for (const raw of String(clause ?? '').split(',')) {
    const symbol = raw
      .trim()
      .replace(/^type\s+/, '')
      .split(/\s+as\s+/)[0]
      ?.trim();
    if (symbol && /^[A-Za-z_$][\w$]*$/.test(symbol)) symbols.push(symbol);
  }
  return symbols;
}

/**
 * Every module reference in `source`, in source order.
 *
 * @param {string} source
 * @param {{ internalPackagePrefix?: string }} options — omit the prefix to skip the package form.
 * @returns {Array<
 *   | { form: 'package', target: string, statement: string, index: number }
 *   | { form: 'bare', target: string, statement: string, index: number }
 *   | { form: 'named', target: string, symbols: string[], statement: string, index: number }
 * >}
 *   `target` is the `interface-<family>` suffix for the package form and the `./<name>` module name
 *   (extension stripped) for the relative forms.
 */
export function findModuleReferences(source, { internalPackagePrefix } = {}) {
  const text = String(source ?? '');
  const references = [];
  if (internalPackagePrefix) {
    for (const m of text.matchAll(packageReferencePattern(internalPackagePrefix))) {
      references.push({ form: 'package', target: m[1], statement: m[0], index: m.index });
    }
  }
  for (const m of text.matchAll(RELATIVE_BARE_REFERENCE)) {
    references.push({ form: 'bare', target: m[1], statement: m[0], index: m.index });
  }
  for (const m of text.matchAll(RELATIVE_NAMED_REFERENCE)) {
    references.push({
      form: 'named',
      target: m[2],
      symbols: namedClauseSymbols(m[1]),
      statement: m[0],
      index: m.index,
    });
  }
  return references.sort((a, b) => a.index - b.index);
}
