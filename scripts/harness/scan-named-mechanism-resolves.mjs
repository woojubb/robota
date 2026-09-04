#!/usr/bin/env node

/**
 * A document that names a mechanism as required must name one that exists.
 *
 * A rule saying "use X" where X is absent is worse than a rule with no mechanism at all. The
 * unmechanized rule is honestly prose and a reader treats it as judgement. The phantom one reads
 * as satisfiable, so a reader either believes the obligation was met or silently drops it — and
 * either way nothing distinguishes that from compliance afterwards.
 *
 * WHAT IT FLAGS: a mechanism named by identity in a rule or routing document, whose identity does
 * not resolve in this repository or its declared environment — a harness script, a hook, a package
 * script, an MCP server. Those are the marks of a named mechanism, and they are what a machine can
 * see.
 *
 * WHAT IT CANNOT SEE: a mechanism named descriptively rather than by identity ("verify in a
 * browser", "run the linter"). Prose that names no artifact is out of reach here; whether such an
 * obligation is reachable at all is a separate, human obligation, and this scan going green does
 * not discharge it.
 *
 * WHY BY IDENTITY AND NOT BY BEHAVIOUR: this scan asserts presence, never correctness. A hook that
 * exists and does nothing passes here — `guards-pass-silently` and `hooks-have-execution-coverage`
 * own that question. Presence is the floor beneath them: those scans cannot judge a file that is
 * not there.
 *
 * Usage: `node scripts/harness/scan-named-mechanism-resolves.mjs`
 * Exit 0 = clean, 1 = blocking findings.
 *
 * fail-direction: refuse — an empty document scope, an absent root manifest, or a missing
 * `run-all-scans.mjs` each THROW rather than reporting a clean pass over what could not be read.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);

/** Documents whose statements bind. Skills and tasks describe work; rules and routing bind it. */
const SCOPE = [{ dir: '.agents/rules', suffix: '.md' }, { file: 'AGENTS.md' }];

/**
 * Each matcher pairs a way of naming a mechanism with the question "does this exist?".
 * `kind` is only used to phrase the finding.
 */
export const MATCHERS = [
  {
    kind: 'harness script',
    pattern: /`?(scripts\/harness\/[\w.-]+\.mjs)`?/g,
    resolves: (name) => existsSync(path.join(WORKSPACE_ROOT, name)),
    hint: 'Add the script, or name the one that carries the obligation.',
  },
  {
    kind: 'hook',
    pattern: /`?(\.claude\/hooks\/[\w./-]+\.sh)`?/g,
    resolves: (name) => existsSync(path.join(WORKSPACE_ROOT, name)),
    hint: 'Add the hook, or name the one that carries the obligation.',
  },
  {
    kind: 'package script',
    // Both spellings (`pnpm run x` and the bare `pnpm x` shorthand), in both homes: inline
    // backticks anywhere, and BARE at line start — which is where fenced command blocks put
    // them, and where the most-load-bearing lists live (AGENTS.md's Harness Entrypoints, the
    // release runbooks). Bare mid-sentence stays unmatched, or prose like "this pnpm monorepo"
    // reads as a script name.
    // Package-manager BUILT-INS are not package scripts and are excluded, or `pnpm install`
    // would be flagged for not appearing in `scripts`. `test` and `start` are NOT in that list:
    // like `build`, they resolve through the scripts field, and excluding them would leave the
    // most ordinary commands documents name permanently unchecked.
    pattern:
      /(?:^\s*(?:pnpm|npm)(?: run)? (?!(?:run|install|add|remove|update|publish|exec|dlx|link|why|list|store|patch|import|prune|rebuild|audit|outdated|create|init|config|help|setup|whoami|login|logout|-)\b)([\w:-]+)(?=$|[^\w:-])|`(?:pnpm|npm)(?: run)? (?!(?:run|install|add|remove|update|publish|exec|dlx|link|why|list|store|patch|import|prune|rebuild|audit|outdated|create|init|config|help|setup|whoami|login|logout|-)\b)([\w:-]+)`)/g,
    resolves: (name) => {
      const pkg = path.join(WORKSPACE_ROOT, 'package.json');
      // No manifest means the question cannot be answered, and answering `true` made every
      // `pnpm run …` claim in every rule resolve by default — the scan reporting clean precisely
      // when it could see nothing.
      if (!existsSync(pkg)) {
        throw new Error(
          '[named-mechanism-resolves] no package.json at the workspace root, so no `pnpm run` ' +
            'claim can be checked. Refusing rather than resolving them all by default.',
        );
      }
      return Boolean(JSON.parse(readFileSync(pkg, 'utf8')).scripts?.[name]);
    },
    hint: 'Add the script to package.json, or name an existing one.',
  },
  {
    kind: 'MCP server',
    // "Playwright MCP", "the Foo MCP server" — an identity, not a description. A sentence-form
    // determiner in front of "MCP" ("This MCP server…", "Every MCP…") is grammar, not a name,
    // and reading it as one would fail the scan the moment a rule gains an idiomatic sentence.
    pattern:
      /\b(?!(?:This|That|The|These|Those|A|An|Any|Every|Each|No|Some|Its|Their|Our|Which|One)\b)([A-Z][\w-]*)\s+MCP(?:\s+server)?\b/g,
    resolves: (name) => {
      const declared = new Set();
      const mcpFile = path.join(WORKSPACE_ROOT, '.mcp.json');
      if (existsSync(mcpFile)) {
        for (const k of Object.keys(JSON.parse(readFileSync(mcpFile, 'utf8')).mcpServers ?? {})) {
          declared.add(k.toLowerCase());
        }
      }
      const settings = path.join(WORKSPACE_ROOT, '.claude/settings.json');
      if (existsSync(settings)) {
        for (const k of Object.keys(JSON.parse(readFileSync(settings, 'utf8')).mcpServers ?? {})) {
          declared.add(k.toLowerCase());
        }
      }
      return declared.has(name.toLowerCase());
    },
    hint:
      'Declare the server in .mcp.json or .claude/settings.json, or restate the obligation ' +
      'in terms of an outcome rather than a tool this repository does not configure.',
  },
];

function documents() {
  const out = [];
  for (const entry of SCOPE) {
    if (entry.file) {
      const full = path.join(WORKSPACE_ROOT, entry.file);
      if (existsSync(full)) out.push({ label: entry.file, full });
      continue;
    }
    const dir = path.join(WORKSPACE_ROOT, entry.dir);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).sort()) {
      if (!name.endsWith(entry.suffix)) continue;
      out.push({ label: `${entry.dir}/${name}`, full: path.join(dir, name) });
    }
  }
  return out;
}

export function collectNamedMechanismFindings() {
  const findings = [];
  const scope = documents();
  // The binding documents are mandatory in this repository, so an empty scope is a broken checkout
  // rather than a repository with nothing to check. Reporting "no findings" here would mean
  // "nothing was examined".
  if (scope.length === 0) {
    throw new Error(
      '[named-mechanism-resolves] no binding documents found (.agents/rules/*.md, AGENTS.md). ' +
        'Refusing rather than reporting a pass over nothing.',
    );
  }

  for (const doc of scope) {
    const text = readFileSync(doc.full, 'utf8');
    const lines = text.split('\n');

    lines.forEach((line, index) => {
      // A line that only links to a document is routing, not an obligation to run something.
      for (const matcher of MATCHERS) {
        matcher.pattern.lastIndex = 0;
        let match;
        while ((match = matcher.pattern.exec(line)) !== null) {
          const name = match[1] ?? match[2];
          if (matcher.resolves(name)) continue;
          findings.push(
            `${doc.label}:${index + 1} names the ${matcher.kind} \`${name}\`, which does not ` +
              `resolve. ${matcher.hint}`,
          );
        }
      }
    });
  }

  // A scan that is not registered cannot report that it is not registered.
  const runner = path.join(WORKSPACE_ROOT, 'scripts/harness/run-all-scans.mjs');
  // An `existsSync(runner) &&` guard stood here, which turned a missing runner into a silently
  // skipped registration check — the same shape the check itself is about.
  if (!existsSync(runner)) {
    throw new Error(
      '[named-mechanism-resolves] run-all-scans.mjs is missing, so registration cannot be ' +
        'checked. That is the condition this check exists to report, not one to skip it for.',
    );
  }
  if (!readFileSync(runner, 'utf8').includes('scan-named-mechanism-resolves.mjs')) {
    findings.push(
      'scan-named-mechanism-resolves.mjs is absent from run-all-scans.mjs — it would never run, ' +
        'which is the failure class it exists to catch.',
    );
  }

  if (findings.length > 0) {
    console.error('[named-mechanism-resolves] blocking findings:\n');
    for (const f of findings) console.error(`  - ${f}\n`);
    process.exitCode = 1;
    return findings;
  }

  console.log(`[named-mechanism-resolves] clean — ${scope.length} documents examined.`);
  return findings;
}

function main() {
  collectNamedMechanismFindings();
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  main();
}
