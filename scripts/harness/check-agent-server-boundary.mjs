#!/usr/bin/env node

/**
 * Check the browser/server/playground/remote-client boundary for remote execution.
 *
 * Required-import checks verify a WIRED SEAM, not a token.
 *
 * Lesson source (HARNESS-051, 2026-07-26): this gate's required-import rule was satisfied
 * by `packages/agent-playground/src/lib/playground/robota-executor/remote-providers.ts` — a
 * module nothing in the package imports, holding a function nobody calls. The gate ran, could
 * fail, and still certified a seam that did not exist: it checked that a token appeared in some
 * file. Deleting provably dead code turned the gate red, which is the inverse of what a boundary
 * gate is for.
 *
 * A required import now counts only when BOTH hold:
 * 1. the importing module is reachable from a declared entry point of its own tree, and
 * 2. the imported binding is actually referenced in that module (a side-effect import, a
 *    re-export, and a dynamic `import()` expression each count as referenced, since each one
 *    evaluates or forwards the specifier).
 *
 * Deliberate scope limits, so the rule fires zero times on correct code:
 * - Reachability is computed over relative imports inside the scanned tree only. Test files are
 *   outside the graph, so a module only tests import is not "wired" — which is the intent.
 * - Entry points are declared per check (`entryPattern`), never inferred. Framework route files
 *   (Next.js `page`/`layout`/...) have no in-repo importer and must be declared as entries.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

import { escapeForRegExp, resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta, { fromCwd: true });
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs']);

const PACKAGE_CHECKS = [
  {
    file: 'apps/agent-web/package.json',
    forbiddenPrefixes: [
      '@robota-sdk/agent-provider',
      '@robota-sdk/agent-server',
      '@robota-sdk/agent-remote-client',
    ],
    type: 'agent-web-forbidden-dependency',
    detail:
      'agent-web must stay a browser host; provider, server, and remote protocol behavior belongs below the app shell.',
  },
  {
    file: 'apps/agent-server/package.json',
    forbiddenPrefixes: [
      '@robota-sdk/agent-transport-gui',
      '@robota-sdk/agent-cli',
      '@robota-sdk/agent-remote-client',
    ],
    type: 'agent-server-forbidden-dependency',
    detail:
      'agent-server must stay a server composition root and must not depend on browser hosts, CLI shells, or remote clients.',
  },
  {
    file: 'packages/agent-remote-client/package.json',
    forbiddenPrefixes: [
      '@robota-sdk/agent-provider',
      '@robota-sdk/agent-server',
      '@robota-sdk/agent-transport-gui',
      '@robota-sdk/agent-playground',
    ],
    type: 'remote-client-forbidden-dependency',
    detail:
      'agent-remote-client owns transport client behavior and must not depend on providers, hosts, or Playground UI.',
  },
];

/**
 * Withdrawn requirement (HARNESS-051, 2026-07-26):
 * `agent-playground` was required to depend on and import `@robota-sdk/agent-remote-client`.
 * Measured against the tree, that architecture is not the one implemented: the package reaches the
 * server through its own `robota-executor/sse-client`, and `@robota-sdk/agent-remote-client` has no
 * reachable importer anywhere in the repo — the single import lives in a module nothing loads.
 * Under the wired-seam rule above the requirement can only ever be red, and a gate asserting an
 * unimplemented design is what made deleting dead code a CI failure in the first place.
 *
 * The forbidden-direction rules (no host, CLI, or provider may reach into a remote client, and the
 * remote client may not reach back into UI) are unaffected — those hold whether or not the seam is
 * composed. Re-add a required-seam rule when the composition actually exists; do not re-add it as
 * an aspiration.
 */
const REQUIRED_PACKAGE_DEPENDENCIES = [
  {
    file: 'apps/agent-server/package.json',
    dependencyPattern: /^@robota-sdk\/agent-provider(?:-|$)/,
    type: 'agent-server-missing-provider-composition',
    detail: 'agent-server should remain the provider-side composition root for remote execution.',
  },
];

const SOURCE_IMPORT_CHECKS = [
  {
    dir: 'apps/agent-web/src',
    forbiddenImport(specifier) {
      return (
        specifier.startsWith('@robota-sdk/agent-provider') ||
        specifier === '@robota-sdk/agent-server' ||
        specifier.startsWith('@robota-sdk/agent-server/') ||
        specifier === '@robota-sdk/agent-remote-client' ||
        specifier.startsWith('@robota-sdk/agent-remote-client/') ||
        specifier === '@robota-sdk/agent-playground' ||
        (specifier.startsWith('@robota-sdk/agent-playground/') &&
          specifier !== '@robota-sdk/agent-playground/client')
      );
    },
    type: 'agent-web-forbidden-import',
    detail:
      'agent-web must import only browser-safe Playground entries and must not call providers/server/remote protocol packages directly.',
  },
  {
    dir: 'apps/agent-server/src',
    forbiddenImport(specifier) {
      return (
        specifier === '@robota-sdk/agent-transport-gui' ||
        specifier.startsWith('@robota-sdk/agent-transport-gui/') ||
        specifier === '@robota-sdk/agent-cli' ||
        specifier.startsWith('@robota-sdk/agent-cli/') ||
        specifier === '@robota-sdk/agent-remote-client' ||
        specifier.startsWith('@robota-sdk/agent-remote-client/') ||
        specifier === '@robota-sdk/agent-playground/client' ||
        specifier.startsWith('@robota-sdk/agent-playground/client/')
      );
    },
    type: 'agent-server-forbidden-import',
    detail:
      'agent-server may compose provider proxying and WebSocket hosting, but must not import browser hosts or remote clients.',
  },
  {
    dir: 'packages/agent-remote-client/src',
    forbiddenImport(specifier) {
      return (
        specifier.startsWith('@robota-sdk/agent-provider') ||
        specifier === '@robota-sdk/agent-server' ||
        specifier.startsWith('@robota-sdk/agent-server/') ||
        specifier === '@robota-sdk/agent-transport-gui' ||
        specifier.startsWith('@robota-sdk/agent-transport-gui/') ||
        specifier === '@robota-sdk/agent-playground' ||
        specifier.startsWith('@robota-sdk/agent-playground/')
      );
    },
    type: 'remote-client-forbidden-import',
    detail: 'agent-remote-client must remain a UI-agnostic transport client over core contracts.',
  },
  {
    dir: 'packages/agent-playground/src',
    forbiddenImport(specifier) {
      return (
        specifier === '@robota-sdk/agent-server' ||
        specifier.startsWith('@robota-sdk/agent-server/') ||
        specifier === '@robota-sdk/agent-transport-gui' ||
        specifier.startsWith('@robota-sdk/agent-transport-gui/')
      );
    },
    type: 'agent-playground-forbidden-import',
    detail:
      'agent-playground owns reusable Playground behavior and must not import deployment hosts.',
  },
];

const REQUIRED_SOURCE_IMPORTS = [
  {
    dir: 'apps/agent-web/src',
    // Next.js App Router: route files are framework entry points — nothing in the repo imports them.
    // The full App Router special-file set. `loading` and `global-error` were missing, and a module
    // reachable only from one of those would have read as unreachable — the gate would then call a
    // genuinely wired seam dead. Under-listing entry points fails in the direction that produces
    // false findings, which is the direction that gets a gate disabled.
    entryPattern:
      /(^|\/)(page|layout|template|default|route|middleware|error|global-error|not-found|loading)\.[cm]?[jt]sx?$/,
    // apps/agent-web/tsconfig.json maps "@/*" to "./src/*"; an unresolved alias edge would make a
    // live module look unreachable.
    moduleAliases: [{ prefix: '@/', target: 'apps/agent-web/src/' }],
    importSpecifier: '@robota-sdk/agent-playground/client',
    type: 'agent-web-missing-browser-safe-playground-import',
    unwiredType: 'agent-web-unwired-browser-safe-playground-import',
    detail:
      'agent-web should render Playground through the browser-safe @robota-sdk/agent-playground/client entry.',
  },
  // The agent-playground -> agent-remote-client required import is withdrawn; see the note above
  // REQUIRED_PACKAGE_DEPENDENCIES.
];

const SERVER_FORBIDDEN_OWNERSHIP_PATTERNS = [
  {
    pattern:
      /\b(?:class|interface|type|const)\s+\w*(?:ProviderSemantics|ProviderModelCatalog|SessionPolicy|PlaygroundUiState|PlaygroundViewState)\b/,
    type: 'agent-server-forbidden-ownership',
    detail:
      'agent-server routing must not become the owner of provider semantics, session policy, or Playground UI state.',
  },
];

const REQUIRED_DOCUMENTATION = [
  {
    file: 'apps/agent-server/docs/SPEC.md',
    pattern: /Provider secrets and direct vendor API calls stay server-side in this app\./,
    type: 'missing-agent-server-secret-boundary',
    detail: 'agent-server SPEC must state provider secret and direct vendor-call ownership.',
  },
  {
    file: 'apps/agent-server/docs/SPEC.md',
    pattern: /does not\s+own provider semantics, session policy, or Playground UI state/,
    type: 'missing-agent-server-non-ownership-boundary',
    detail:
      'agent-server SPEC must state that provider semantics, session policy, and Playground UI state are not server-owned.',
  },
  {
    file: 'apps/agent-web/docs/SPEC.md',
    pattern:
      /must not import provider packages, `apps\/agent-server`, or the root\s+`@robota-sdk\/agent-playground` entry/,
    type: 'missing-agent-web-browser-boundary',
    detail: 'agent-web SPEC must state the browser-safe Playground import boundary.',
  },
  {
    file: '.agents/specs/architecture-map/apps-and-deployment.md',
    pattern:
      /Remote execution contract ownership stays in `agent-remote-client` and reusable Playground\s+execution behavior stays in `agent-playground`/,
    type: 'missing-app-deployment-remote-owner-map',
    detail:
      'Architecture map must keep remote execution and reusable Playground behavior out of app hosts.',
  },
];

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function isSourceFile(relativePath) {
  return SOURCE_EXTENSIONS.has(path.extname(relativePath));
}

function isIgnoredPath(relativePath) {
  return (
    relativePath.includes('/node_modules/') ||
    relativePath.includes('/dist/') ||
    relativePath.includes('/coverage/') ||
    relativePath.includes('/.next/') ||
    relativePath.includes('/__tests__/') ||
    /\.test\.[cm]?[jt]sx?$/.test(relativePath) ||
    /\.spec\.[cm]?[jt]sx?$/.test(relativePath)
  );
}

async function walkFiles(root, relativeDir) {
  const absoluteDir = path.join(root, relativeDir);
  if (!(await pathExists(absoluteDir))) {
    return [];
  }

  const entries = await fs.readdir(absoluteDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const childRelativePath = path.join(relativeDir, entry.name);
    if (isIgnoredPath(childRelativePath)) {
      continue;
    }
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(root, childRelativePath)));
      continue;
    }
    if (entry.isFile() && isSourceFile(childRelativePath)) {
      files.push(childRelativePath);
    }
  }
  return files;
}

async function readIfExists(root, relativePath) {
  try {
    return await fs.readFile(path.join(root, relativePath), 'utf8');
  } catch {
    return undefined;
  }
}

async function readJsonIfExists(root, relativePath) {
  const content = await readIfExists(root, relativePath);
  if (content === undefined) {
    return undefined;
  }
  return JSON.parse(content);
}

function listAllDependencies(packageJson) {
  return Object.keys({
    ...(packageJson.dependencies ?? {}),
    ...(packageJson.devDependencies ?? {}),
    ...(packageJson.peerDependencies ?? {}),
    ...(packageJson.optionalDependencies ?? {}),
  });
}

function extractImports(content) {
  const imports = new Set();
  const importPattern =
    /(?:from\s+['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|require\s*\(\s*['"]([^'"]+)['"]\s*\))/g;
  let match;
  while ((match = importPattern.exec(content)) !== null) {
    imports.add(match[1] ?? match[2] ?? match[3]);
  }
  return [...imports];
}

async function findPackageFindings(root) {
  const findings = [];

  for (const check of PACKAGE_CHECKS) {
    const packageJson = await readJsonIfExists(root, check.file);
    if (!packageJson) {
      findings.push({
        file: check.file,
        type: 'missing-package-manifest',
        detail: `${check.file} is required for app/server boundary checks.`,
      });
      continue;
    }
    for (const dependencyName of listAllDependencies(packageJson)) {
      if (!check.forbiddenPrefixes.some((prefix) => dependencyName.startsWith(prefix))) {
        continue;
      }
      findings.push({
        file: check.file,
        type: check.type,
        detail: `${check.detail} Found ${dependencyName}.`,
      });
    }
  }

  for (const check of REQUIRED_PACKAGE_DEPENDENCIES) {
    const packageJson = await readJsonIfExists(root, check.file);
    if (!packageJson) {
      continue;
    }
    const dependencies = listAllDependencies(packageJson);
    if (dependencies.some((dependencyName) => check.dependencyPattern.test(dependencyName))) {
      continue;
    }
    findings.push({
      file: check.file,
      type: check.type,
      detail: check.detail,
    });
  }

  return findings;
}

async function findSourceImportFindings(root) {
  const findings = [];

  for (const check of SOURCE_IMPORT_CHECKS) {
    for (const file of await walkFiles(root, check.dir)) {
      const content = await fs.readFile(path.join(root, file), 'utf8');
      for (const importSpecifier of extractImports(content)) {
        if (!check.forbiddenImport(importSpecifier)) {
          continue;
        }
        findings.push({
          file,
          type: check.type,
          detail: `${check.detail} Found import ${importSpecifier}.`,
        });
      }
    }
  }

  return findings;
}

function toPosixPath(value) {
  return value.split(path.sep).join('/');
}

const RESOLUTION_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs'];

/** Resolve a relative or aliased import to a file inside the scanned set, or undefined. */
export function resolveRelativeImport(fileSet, fromFile, specifier, moduleAliases = []) {
  let base;
  if (specifier.startsWith('.')) {
    base = path.posix.normalize(
      path.posix.join(path.posix.dirname(toPosixPath(fromFile)), specifier),
    );
  } else {
    // A tsconfig path alias is an in-tree edge too; missing one would make a live module look
    // unreachable, and a check that fires on correct code gets suppressed.
    const alias = moduleAliases.find(({ prefix }) => specifier.startsWith(prefix));
    if (!alias) {
      return undefined;
    }
    base = path.posix.normalize(`${alias.target}${specifier.slice(alias.prefix.length)}`);
  }
  const candidates = [base, ...RESOLUTION_EXTENSIONS.map((extension) => `${base}${extension}`)];
  for (const extension of RESOLUTION_EXTENSIONS) {
    candidates.push(`${base}/index${extension}`);
  }
  return candidates.find((candidate) => fileSet.has(candidate));
}

/**
 * Modules reachable from the declared entry points, following relative imports only.
 * A module outside this set ships no behavior: nothing loads it.
 */
export function collectReachableModules(contentsByFile, entryPattern, moduleAliases = []) {
  // Fail closed on a missing entry pattern rather than crashing on `undefined.test`. A check added
  // later without one would otherwise take the whole scan down with a TypeError, and a guard that
  // dies is a guard that gets skipped. Saying which declaration is incomplete beats a stack trace.
  if (!(entryPattern instanceof RegExp)) {
    throw new TypeError(
      'collectReachableModules requires an entryPattern RegExp — the check declaring it is incomplete. ' +
        'Entry points are declared per check and never inferred, so there is no safe default to fall back to.',
    );
  }

  const fileSet = new Set(contentsByFile.keys());
  const reachable = new Set();
  const queue = [...fileSet].filter((file) => entryPattern.test(file));

  while (queue.length > 0) {
    const current = queue.pop();
    if (reachable.has(current)) {
      continue;
    }
    reachable.add(current);
    for (const specifier of extractImports(contentsByFile.get(current) ?? '')) {
      const resolved = resolveRelativeImport(fileSet, current, specifier, moduleAliases);
      if (resolved !== undefined && !reachable.has(resolved)) {
        queue.push(resolved);
      }
    }
  }

  return reachable;
}

/**
 * Drop the parts of a module that cannot reference a binding: comments and quoted string
 * literals. Otherwise a name merely MENTIONED in a comment would count as a use — the same
 * vacuous satisfaction this check exists to reject, one level down.
 *
 * Template literals are left intact: `${name}` is a real reference. `://` is preserved so a URL
 * inside surviving text is not mistaken for a line comment.
 */
function stripCommentsAndStringLiterals(content) {
  return stripComments(content)
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""');
}

/**
 * Remove comments only, keeping string literals intact.
 *
 * Import detection cannot use the full strip: every import pattern matches a QUOTED specifier, so
 * blanking string literals deletes the very thing being searched for and every import would read as
 * absent. But the raw content must not be searched either — a commented-out `import('pkg')` would
 * then classify as `used`, letting a mention stand in for a wiring in the branch that returns
 * `'used'` without looking at anything else. Comments out, strings in.
 */
function stripComments(content) {
  return content.replace(COMMENT_PATTERN, (_match, lineCommentPrefix) =>
    lineCommentPrefix === undefined ? ' ' : lineCommentPrefix,
  );
}

/**
 * One alternation, not two sequential passes — whichever comment STARTS first wins.
 *
 * Two passes cannot be ordered correctly, because each order corrupts real code in the other's
 * case. Block-first, which this was: `// see /* note` opens a block scan inside a LINE comment, so
 * everything up to the next `*​/` is deleted. Measured on
 * `// see /* note\nconst wired = require('pkg');\n/* real block *​/` — the `require` line was gone,
 * so a genuinely wired seam would have read as absent. Line-first is no better: `/* a // b *​/`
 * loses its terminator and the block is then never closed.
 *
 * A single left-to-right scan has no ordering to get wrong. The `[^:]` guard on the line-comment
 * arm stays — without it every `https://…` in the file reads as a comment and deletes the rest of
 * its line.
 */
const COMMENT_PATTERN = /\/\*[\s\S]*?\*\/|(^|[^:])\/\/[^\n]*/g;

/** Every string literal blanked except those whose content is exactly `specifier`. */
function stripStringLiteralsExcept(content, specifier) {
  return content.replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g, (literal) => {
    const quote = literal[0];
    return literal.slice(1, -1) === specifier ? literal : `${quote}${quote}`;
  });
}

/**
 * Classify how a module references a specifier.
 *
 * Returns `'absent'`, `'imported-unused'` (the specifier is imported but no bound name is
 * referenced in the module's executable text — an import statement, not a wired seam), or
 * `'used'`.
 */
export function classifySpecifierUsage(rawContent, specifier) {
  // Comments out, and every string literal blanked EXCEPT the specifier itself.
  //
  // Neither half alone is enough. Keeping strings let a file containing
  // `const example = "await import('pkg')"` classify as a wired seam — token-appears-somewhere, the
  // exact class this gate exists to reject. Blanking all strings is worse: every import pattern
  // matches the QUOTED specifier, so the thing being searched for disappears and every import reads
  // as absent. Preserving only literals whose content IS the specifier resolves it: the outer string
  // above is blanked (its content is not `pkg`), while `import('pkg')` keeps its argument. A bare
  // `const name = 'pkg'` survives too and is harmless — the patterns all require `import(`,
  // `require(`, `import ` or `from ` in front of it.
  const content = stripStringLiteralsExcept(stripComments(rawContent), specifier);
  const quoted = `['"]${escapeForRegExp(specifier)}['"]`;
  // Re-exports are matched separately from the other evaluated forms, because a type-only one is
  // erased exactly like `import type` — `export type { X } from 'pkg'` forwards nothing at runtime,
  // and the single combined pattern counted it as wiring. Same finding as the import side, one
  // review round later, on the branch that had not been given the same rule.
  const reExportPattern = new RegExp(`export\\s+([^;]*?)\\s*from\\s*${quoted}`, 'g');
  for (const reExport of content.matchAll(reExportPattern)) {
    const clause = reExport[1];
    // `export *` / `export * as ns` is a namespace forward: always live at runtime.
    if (/^\s*\*/.test(clause)) return 'used';
    if (extractBoundNames(clause).length > 0) return 'used';
  }

  const evaluatedPattern = new RegExp(
    `(?:import\\s*\\(\\s*${quoted}\\s*\\)|require\\s*\\(\\s*${quoted}\\s*\\)|import\\s+${quoted})`,
  );
  if (evaluatedPattern.test(content)) {
    // Dynamic import, require, and side-effect import all evaluate the
    // specifier — the module wires it by existing.
    return 'used';
  }

  // The clause may span lines but never contains `;` or a quote, so the match cannot swallow a
  // preceding import statement (which would then mis-read that statement's bound names).
  const staticPattern = new RegExp(`import\\s+([^;'"]*?)\\s*from\\s*${quoted}`, 'g');
  const boundNames = new Set();
  let masked = content;
  let matchedStaticImport = false;
  let match;
  while ((match = staticPattern.exec(content)) !== null) {
    matchedStaticImport = true;
    masked = masked.replace(match[0], ' '.repeat(match[0].length));
    for (const name of extractBoundNames(match[1])) {
      boundNames.add(name);
    }
  }

  if (!matchedStaticImport) {
    return 'absent';
  }

  const executable = stripCommentsAndStringLiterals(masked);
  for (const name of boundNames) {
    if (new RegExp(`\\b${escapeForRegExp(name)}\\b`).test(executable)) {
      return 'used';
    }
  }
  return 'imported-unused';
}

/**
 * RUNTIME binding names introduced by an import clause (`X`, `* as ns`, `{ a, b as c }`).
 *
 * Type-only imports bind nothing. `import type { X }` and `import { type X }` are erased by the
 * compiler, so the emitted module never references them — the seam is not wired, whatever the
 * source looks like. An earlier version stripped the `type` keyword and counted them as bindings,
 * which would let a purely type-level reference satisfy a gate whose whole purpose is to prove a
 * seam is actually reachable at runtime. That is the exact defect class HARNESS-051 is closing, so
 * counting them here would have reintroduced it inside the fix.
 *
 * Returns `[]` for a wholly type-only clause; drops individually `type`-marked specifiers from a
 * mixed one (`import { type A, B }` binds only `B`).
 */
function extractBoundNames(clause) {
  // `import type …` — the entire clause is erased. Nothing is bound at runtime.
  if (/^\s*type\s+/.test(clause)) return [];

  const names = [];
  const namedMatch = clause.match(/\{([^}]*)\}/);
  if (namedMatch) {
    for (const entry of namedMatch[1].split(',')) {
      const trimmed = entry.trim();
      // `{ type A }` / `{ type A as B }` — an inline type specifier, erased like the clause form.
      if (/^type\s+/.test(trimmed)) continue;
      const parts = trimmed.split(/\s+as\s+/);
      const local = (parts[1] ?? parts[0] ?? '').trim();
      if (/^[A-Za-z_$][\w$]*$/.test(local)) {
        names.push(local);
      }
    }
  }
  const namespaceMatch = clause.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
  if (namespaceMatch) {
    names.push(namespaceMatch[1]);
  }
  const defaultMatch = clause.match(/^\s*([A-Za-z_$][\w$]*)\s*(?:,|$)/);
  if (defaultMatch) {
    names.push(defaultMatch[1]);
  }
  return names;
}

async function findRequiredSourceImportFindings(root) {
  const findings = [];

  for (const check of REQUIRED_SOURCE_IMPORTS) {
    const contentsByFile = new Map();
    for (const file of await walkFiles(root, check.dir)) {
      contentsByFile.set(toPosixPath(file), await fs.readFile(path.join(root, file), 'utf8'));
    }

    const reachable = collectReachableModules(
      contentsByFile,
      check.entryPattern,
      check.moduleAliases ?? [],
    );
    const importingFiles = [];
    let wiredFile;
    let unwiredFile;

    for (const [file, content] of contentsByFile) {
      const usage = classifySpecifierUsage(content, check.importSpecifier);
      if (usage === 'absent') {
        continue;
      }
      importingFiles.push(file);
      if (usage === 'used' && reachable.has(file)) {
        wiredFile = file;
        break;
      }
      unwiredFile ??= { file, usage };
    }

    if (wiredFile !== undefined) {
      continue;
    }

    if (importingFiles.length === 0) {
      findings.push({ file: check.dir, type: check.type, detail: check.detail });
      continue;
    }

    const reason =
      unwiredFile.usage === 'imported-unused'
        ? `${unwiredFile.file} imports it without referencing the binding`
        : `${unwiredFile.file} is not reachable from an entry point`;
    findings.push({
      file: unwiredFile.file,
      type: check.unwiredType,
      detail: `${check.detail} ${check.importSpecifier} is imported but not wired: ${reason}. An import statement that nothing loads or calls does not satisfy this boundary.`,
    });
  }

  return findings;
}

async function findServerOwnershipFindings(root) {
  const findings = [];

  for (const file of await walkFiles(root, 'apps/agent-server/src')) {
    const content = await fs.readFile(path.join(root, file), 'utf8');
    for (const check of SERVER_FORBIDDEN_OWNERSHIP_PATTERNS) {
      if (!check.pattern.test(content)) {
        continue;
      }
      findings.push({
        file,
        type: check.type,
        detail: check.detail,
      });
    }
  }

  return findings;
}

async function findDocumentationFindings(root) {
  const findings = [];

  for (const check of REQUIRED_DOCUMENTATION) {
    const content = await readIfExists(root, check.file);
    if (content !== undefined && check.pattern.test(content)) {
      continue;
    }
    findings.push({
      file: check.file,
      type: check.type,
      detail: check.detail,
    });
  }

  return findings;
}

export async function findAgentServerBoundaryFindings(root = WORKSPACE_ROOT) {
  return [
    ...(await findPackageFindings(root)),
    ...(await findSourceImportFindings(root)),
    ...(await findRequiredSourceImportFindings(root)),
    ...(await findServerOwnershipFindings(root)),
    ...(await findDocumentationFindings(root)),
  ];
}

export async function main() {
  const findings = await findAgentServerBoundaryFindings(WORKSPACE_ROOT);
  if (findings.length === 0) {
    process.stdout.write('agent server boundary scan passed.\n');
    return;
  }

  process.stdout.write('agent server boundary scan failed:\n');
  for (const finding of findings) {
    process.stdout.write(`- [${finding.type}] ${finding.file}: ${finding.detail}\n`);
  }
  process.exitCode = 1;
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  void main();
}
