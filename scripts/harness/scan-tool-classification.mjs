#!/usr/bin/env node

/**
 * CORE-030 — every tool a package produces must declare what the permission system should do with it.
 *
 * The risk classification used to live in `@robota-sdk/agent-core`'s permission matrix, keyed on a
 * closed union of product tool names. Nothing coupled that list to the tools actually produced, and
 * they had drifted: `Agent`, `BackgroundProcess`, `CodebaseRetrieval` and `ExecuteCommand` were all
 * defined in the workspace and unknown to the matrix. An unclassified tool takes the fail-safe
 * fallback, which prompts on every call and is refused in plan mode — so a read-only tool became
 * unusable in the one mode where reading is all you can do.
 *
 * Moving the declaration next to the tool removes the two-list problem but not the possibility of
 * forgetting. This scan is what makes forgetting fail:
 *
 *   PRODUCED  — every `createZodFunctionTool('Name', …)` in `packages/<pkg>/src`
 *   DECLARED  — every key of a `*_TOOL_PERMISSION_PROFILES` record in `packages/<pkg>/src`
 *
 * A produced name with no declaration is a finding. The reverse is NOT: a package may reasonably
 * declare a profile for a tool a host supplies, and a declaration that classifies nothing is inert
 * rather than dangerous.
 *
 * Exit 0 = clean, 1 = findings.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { listSourceFiles } from './workspace-packages.mjs';
import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);
const SCAN_DIRS = ['packages'];

const PRODUCED_RE = /createZodFunctionTool\(\s*'([A-Za-z_][A-Za-z0-9_]*)'/g;
const PROFILES_BLOCK_RE = /[A-Z_]*TOOL_PERMISSION_PROFILES[^=]*=\s*\{/g;
const PROFILE_KEY_RE = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*\{/gm;

/** Read the balanced `{ … }` that starts at `braceIndex`. */
function objectLiteralAt(source, braceIndex) {
  let depth = 0;
  for (let i = braceIndex; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(braceIndex, i + 1);
    }
  }
  return source.slice(braceIndex);
}

/** Tool names a source file produces. @internal */
export function producedToolNames(source) {
  return [...source.matchAll(PRODUCED_RE)].map((m) => m[1]);
}

/** Tool names a source file declares a permission profile for. @internal */
export function declaredToolNames(source) {
  const names = [];
  for (const match of source.matchAll(PROFILES_BLOCK_RE)) {
    const literal = objectLiteralAt(source, match.index + match[0].length - 1);
    for (const key of literal.matchAll(PROFILE_KEY_RE)) {
      names.push(key[1]);
    }
  }
  return names;
}

/** Findings for one already-collected pair of sets. @internal */
export function findUnclassifiedTools(produced, declared) {
  const declaredSet = new Set(declared.map((entry) => entry.name));
  return produced
    .filter((entry) => !declaredSet.has(entry.name))
    .map((entry) => ({
      tool: entry.name,
      file: entry.file,
      text:
        `\`${entry.name}\` is produced here but no package declares its permission profile, so it ` +
        'takes the unclassified fallback: a prompt on every call, and refused in plan mode',
    }));
}

/** How many produced tool names the last collection read. See measurement-provenance.md. */
let examinedProducedTools = 0;

/**
 * The size this scan declares, readable by a test.
 *
 * A `::examined::` line nobody can check is a claim rather than a measurement — the same shape as a
 * green that means nothing.
 */
export function examinedProducedToolCount() {
  return examinedProducedTools;
}

/** Walk the governed tree and collect both sets. @internal */
export function collectToolClassification(root = WORKSPACE_ROOT) {
  const missing = SCAN_DIRS.filter((dir) => !existsSync(path.join(root, dir)));
  if (missing.length > 0) {
    // FAIL-CLOSED: a classification floor announcing a pass over source it never opened is worse
    // than no floor, because it reads as evidence.
    throw new Error(
      `governed tree(s) absent under ${root}: ${missing.join(', ')}. This scan will not report a ` +
        'pass over source it could not read.',
    );
  }
  examinedProducedTools = 0;
  const produced = [];
  const declared = [];
  for (const dir of SCAN_DIRS) {
    // `listSourceFiles(dir, options)` takes OPTIONS second, not a root. Passing `root` there made
    // this walk the process's own tree whatever root it was handed — so the fail-closed check
    // guarded a root the scan then ignored. Caught by the fixture case in this scan's tests, which
    // is the reason that case reads against a temporary workspace rather than the live one.
    for (const file of listSourceFiles(path.join(root, dir))) {
      const rel = path.relative(root, file);
      if (!rel.includes(`${path.sep}src${path.sep}`)) continue;
      if (rel.includes('__tests__') || rel.endsWith('.test.ts')) continue;
      const source = readFileSync(file, 'utf8');
      for (const name of producedToolNames(source)) {
        produced.push({ name, file: rel });
        examinedProducedTools += 1;
      }
      for (const name of declaredToolNames(source)) declared.push({ name, file: rel });
    }
  }
  return { produced, declared };
}

function main() {
  const { produced, declared } = collectToolClassification();
  const findings = findUnclassifiedTools(produced, declared);
  console.log(
    `::examined:: ${examinedProducedToolCount()} produced tool name(s), ${declared.length} declared`,
  );

  if (findings.length === 0) {
    console.log(
      `tool-classification scan passed (${produced.length} produced tool(s), all classified).`,
    );
    process.exit(0);
  }

  console.error('tool-classification scan FAILED — a produced tool has no permission profile:');
  for (const finding of findings) {
    console.error(`  ${finding.file}: ${finding.text}`);
  }
  console.error(
    '\nCORE-030: a tool declares what it does; the foundation decides what each mode does about\n' +
      "that kind of action. Add the tool to its package's `*_TOOL_PERMISSION_PROFILES` record.",
  );
  process.exit(1);
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  main();
}
