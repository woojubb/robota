#!/usr/bin/env node

/**
 * Skill REGISTRATION floor — `.claude/skills/` was read by nothing.
 *
 * Counterpart to `scan-hook-registration.mjs` (INFRA-078), one layer up. That scan closed the same
 * hole for hooks: a directory of capabilities, a separate file that decides whether anything ever
 * CALLS them, and nothing comparing the two. Skills had the identical gap and it stayed open.
 *
 * Measured on session 50cb28dd (34.6 days, 26,068 turns) before this scan existed:
 *   - `.agents/skills/` held 53 skills; `.claude/skills/` held 5 symlinks, 3 of them DANGLING.
 *   - Two hooks named skills imperatively on every UserPromptSubmit
 *     (`spec-first-gate.sh:64,70`, `correction-detect.sh:45`).
 *   - Every project-skill invocation failed: `Unknown skill` ×13 (lesson-to-harness 6,
 *     backlog-writer 3, backlog-pipeline 3, user-request-gate 1).
 *   - `learning-loop.md:8` names `lesson-to-harness` as THE procedure for turning a repeated
 *     lesson into an enforced rule. The repo's learning loop had a 0% invocation success rate.
 *
 * Four states this refuses, each one live at the time it was written:
 *
 *   A. a registration resolves to nothing — the name is offered and cannot load;
 *   B. a hook or skill body orders a skill by name that is not registered — an instruction that
 *      cannot succeed, re-issued on every prompt;
 *   C. a skill declares `invocable: true` but is not registered, or is registered without
 *      declaring it — the declaration and the wiring disagree;
 *   D. the registered descriptions exceed the context budget — every one is loaded into every
 *      session, so this grows silently one PR at a time.
 *
 * `invocable: true` is a declaration each SKILL.md carries in its own frontmatter, cross-checked
 * against the registry. It is deliberately NOT an exemption list — per the lesson recorded in
 * `scan-hook-registration.mjs`, an exemption list is the hole the floor was built to close.
 *
 * Usage: `node scripts/harness/scan-skill-registration.mjs`
 * Exit 0 = clean, 1 = blocking findings.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { asScalar, frontmatterObject } from './frontmatter.mjs';
import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);
const SOURCE_DIR = path.join(WORKSPACE_ROOT, '.agents/skills');
const REGISTRY_DIR = path.join(WORKSPACE_ROOT, '.claude/skills');
const HOOKS_DIR = path.join(WORKSPACE_ROOT, '.claude/hooks');

/**
 * Every registered description is loaded into every session, so this only ever ratchets DOWN.
 *
 * These are the measured totals on the day the floor landed, not a design target. Nine of the
 * twelve descriptions carry a procedure summary and a policy statement after their trigger
 * clause — material that belongs in the body, which is loaded only on invocation. Trimming them
 * is a content change for the skill owners; this floor exists so the number cannot grow while
 * that is pending. **Lower these as descriptions are trimmed. Never raise them.**
 */
const DESCRIPTION_BUDGET_BYTES = 5720;
const SINGLE_DESCRIPTION_MAX_BYTES = 872;

export function collectSkillRegistrationFindings() {
  const findings = [];

  /**
   * `frontmatter.mjs` is the single owner of frontmatter parsing for harness scripts (HARNESS-046).
   * A per-line regex here would be a fifth fork of the same single-line assumption.
   */
  function frontmatter(file) {
    if (!existsSync(file)) return null;
    const parsed = frontmatterObject(readFileSync(file, 'utf8'));
    return {
      description: asScalar(parsed.description),
      invocable: asScalar(parsed.invocable).toLowerCase() === 'true',
    };
  }

  function listDirs(dir) {
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((name) => !name.startsWith('.'))
      .sort();
  }

  // ── A. every registration resolves ───────────────────────────────────────────
  const registered = listDirs(REGISTRY_DIR);
  const resolved = [];
  for (const name of registered) {
    const entry = path.join(REGISTRY_DIR, name);
    const skillFile = path.join(entry, 'SKILL.md');
    if (!existsSync(entry) || !existsSync(skillFile)) {
      findings.push(
        `A. .claude/skills/${name} does not resolve to a SKILL.md — the name is offered to the ` +
          `Skill tool and cannot load. Remove the entry or restore its target.`,
      );
      continue;
    }
    if (!statSync(entry).isDirectory()) {
      findings.push(`A. .claude/skills/${name} is not a directory.`);
      continue;
    }
    resolved.push(name);
  }

  // ── B. nothing orders a skill that is not registered ─────────────────────────
  // Imperative shapes only. A markdown link to a SKILL.md path is satisfied by Read and is fine.
  const ORDER_PATTERNS = [
    /Use skill:\s*`([a-z0-9-]+)`/g,
    /invoke the ([a-z0-9-]+) skill/gi,
    /Run gate pipeline:\s*`([a-z0-9-]+)`/g,
    /Invoke\s+`([a-z0-9-]+)`\s+skill/gi,
    /`([a-z0-9-]+)`\s+skill\s+\(Skill tool\)/gi,
  ];

  const orderSites = [];
  function scanForOrders(file, label) {
    const text = readFileSync(file, 'utf8');
    for (const pattern of ORDER_PATTERNS) {
      pattern.lastIndex = 0;
      let m;
      while ((m = pattern.exec(text)) !== null) {
        const line = text.slice(0, m.index).split('\n').length;
        orderSites.push({ skill: m[1], where: `${label}:${line}` });
      }
    }
  }

  for (const name of existsSync(HOOKS_DIR) ? readdirSync(HOOKS_DIR) : []) {
    if (!name.endsWith('.sh')) continue;
    scanForOrders(path.join(HOOKS_DIR, name), `.claude/hooks/${name}`);
  }
  for (const name of listDirs(SOURCE_DIR)) {
    const file = path.join(SOURCE_DIR, name, 'SKILL.md');
    if (existsSync(file)) scanForOrders(file, `.agents/skills/${name}/SKILL.md`);
  }

  const registeredSet = new Set(resolved);
  for (const site of orderSites) {
    if (registeredSet.has(site.skill)) continue;
    if (!existsSync(path.join(SOURCE_DIR, site.skill, 'SKILL.md'))) continue; // not one of ours
    findings.push(
      `B. ${site.where} orders \`${site.skill}\` by name, but it is not in .claude/skills/. ` +
        `The Skill tool will answer "Unknown skill" every time this fires.`,
    );
  }

  // ── C. declaration and wiring agree ──────────────────────────────────────────
  for (const name of listDirs(SOURCE_DIR)) {
    const meta = frontmatter(path.join(SOURCE_DIR, name, 'SKILL.md'));
    if (meta === null) continue;
    const isRegistered = registeredSet.has(name);
    if (meta.invocable && !isRegistered) {
      findings.push(
        `C. .agents/skills/${name}/SKILL.md declares \`invocable: true\` but is not registered ` +
          `in .claude/skills/. Register it, or drop the declaration.`,
      );
    }
    if (!meta.invocable && isRegistered) {
      findings.push(
        `C. .claude/skills/${name} is registered but its SKILL.md does not declare ` +
          `\`invocable: true\`. Add the declaration so the intent is readable at the source.`,
      );
    }
  }

  // ── D. the listing cannot silently re-inflate ────────────────────────────────
  let total = 0;
  for (const name of resolved) {
    const meta = frontmatter(path.join(REGISTRY_DIR, name, 'SKILL.md'));
    const size = Buffer.byteLength(meta?.description ?? '', 'utf8');
    total += size;
    if (size > SINGLE_DESCRIPTION_MAX_BYTES) {
      findings.push(
        `D. ${name}: description is ${size} B (max ${SINGLE_DESCRIPTION_MAX_BYTES}). A description ` +
          `is loaded into every session; the procedure belongs in the body, which is not. ` +
          `Trim it to the trigger.`,
      );
    }
  }
  if (total > DESCRIPTION_BUDGET_BYTES) {
    findings.push(
      `D. registered descriptions total ${total} B (budget ${DESCRIPTION_BUDGET_BYTES}). ` +
        `Every byte is paid on every turn of every session. Trim or deregister.`,
    );
  }

  // ── this scan proves its own wiring ──────────────────────────────────────────
  // Same trick `check-test-coverage-scripts` uses: a scan that is not registered cannot report
  // that it is not registered, so it asserts its own presence in the runner.
  const runner = path.join(WORKSPACE_ROOT, 'scripts/harness/run-all-scans.mjs');
  if (existsSync(runner) && !readFileSync(runner, 'utf8').includes('scan-skill-registration.mjs')) {
    findings.push(
      `scan-skill-registration.mjs is not registered in run-all-scans.mjs — it would never run, ` +
        `which is the exact failure class it exists to catch.`,
    );
  }

  if (findings.length > 0) {
    console.error('[skill-registration] blocking findings:\n');
    for (const f of findings) console.error(`  - ${f}\n`);
    console.error(
      `[skill-registration] ${resolved.length} registered / ${listDirs(SOURCE_DIR).length} on disk / ` +
        `${total} B of description.`,
    );
    process.exitCode = 1;
    return findings;
  }

  // HARNESS-057: the size of the subject, on the channel the runner reads. TWO subjects, so two
  // lines: the skills ON DISK are what the walk reads, and the REGISTERED entries are the other
  // side this scan reconciles them against — a single number would have to misreport one of them,
  // and the registered count is the smaller of the two (12 against 55 on the real tree).
  const onDisk = listDirs(SOURCE_DIR).length;
  console.log(`::examined:: ${onDisk} skill directories`);
  console.log(`::examined:: ${resolved.length} registered skill entries`);
  console.log(
    `[skill-registration] clean — ${resolved.length} registered, ` +
      `${onDisk} on disk, ${total} B of description ` +
      `(budget ${DESCRIPTION_BUDGET_BYTES}).`,
  );

  return findings;
}

function main() {
  const findings = collectSkillRegistrationFindings();
  if (findings.length === 0) return;
  process.exitCode = 1;
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  main();
}
