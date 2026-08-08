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
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');

/** Documents whose statements bind. Skills and tasks describe work; rules and routing bind it. */
const SCOPE = [{ dir: '.agents/rules', suffix: '.md' }, { file: 'AGENTS.md' }];

/**
 * Each matcher pairs a way of naming a mechanism with the question "does this exist?".
 * `kind` is only used to phrase the finding.
 */
const MATCHERS = [
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
    pattern: /`(?:pnpm|npm) run ([\w:-]+)`/g,
    resolves: (name) => {
      const pkg = path.join(WORKSPACE_ROOT, 'package.json');
      if (!existsSync(pkg)) return true;
      return Boolean(JSON.parse(readFileSync(pkg, 'utf8')).scripts?.[name]);
    },
    hint: 'Add the script to package.json, or name an existing one.',
  },
  {
    kind: 'MCP server',
    // "Playwright MCP", "the Foo MCP server" — an identity, not a description.
    pattern: /\b([A-Z][\w-]*)\s+MCP(?:\s+server)?\b/g,
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

  for (const doc of documents()) {
    const text = readFileSync(doc.full, 'utf8');
    const lines = text.split('\n');

    lines.forEach((line, index) => {
      // A line that only links to a document is routing, not an obligation to run something.
      for (const matcher of MATCHERS) {
        matcher.pattern.lastIndex = 0;
        let match;
        while ((match = matcher.pattern.exec(line)) !== null) {
          const name = match[1];
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
  if (
    existsSync(runner) &&
    !readFileSync(runner, 'utf8').includes('scan-named-mechanism-resolves.mjs')
  ) {
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

  console.log(`[named-mechanism-resolves] clean — ${documents().length} documents examined.`);
  return findings;
}

function main() {
  collectNamedMechanismFindings();
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  main();
}
