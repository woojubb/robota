#!/usr/bin/env node

/**
 * Hook REGISTRATION floor (INFRA-078) — `.claude/settings.json` was read by nothing.
 *
 * `hooks-have-execution-coverage` enumerates `.claude/hooks/*.sh` and requires a test to EXECUTE
 * each one. Nothing enumerated the same directory against the file that decides whether the
 * deployment ever CALLS them, so two states stayed green:
 *
 *   A. a hook exists, is tested, and is registered to no event — it never fires in a real session;
 *   B. a matcher names a file that no longer exists — the event fires and nothing happens.
 *
 * MEASURED 2026-08-01 before this was written: the only assertion in the repository that read
 * `settings.json` checked one fact — that `check-forbidden-patterns` is registered for `MultiEdit`
 * (`hook-command-parsing.test.mjs:514`). Twelve hooks, eight matchers, one of them covered.
 *
 * This is PROC-003's third question — *is it reached?* — asked one step earlier than the execution
 * floor asks it. That floor proves a hook CAN run; this one proves the deployment calls it.
 *
 * THE NUANCE, which is the whole difficulty. `revert-detect.sh` is registered to no event and is not
 * dead: `eval-log-stop.sh` shells out to it. An exemption LIST is the obvious answer and the wrong
 * one — the next unregistered hook is appended to it, nobody re-derives whether the entry is still
 * true, and the exemption becomes the hole the floor was built to close. So the exemption is a
 * DECLARATION the hook carries in its own header, and the declaration is CHECKED against the caller
 * it names:
 *
 *     # invoked-by: eval-log-stop.sh
 *
 * An undeclared unregistered hook fails. A declared one whose named caller does not exist fails. A
 * declared one whose named caller does not reference it fails — the claim is verified against the
 * caller's body, so it cannot certify itself. And a chain of declarations that never lands on a
 * registered hook fails, because two hooks declaring each other are both unreached while each
 * excuses the other, which is the exemption list rebuilt out of headers.
 *
 * WHAT IT DOES NOT CLAIM. That a registered hook is CORRECT, or that its matcher names the events
 * it ought to name — `settings.json` says `Edit|Write|MultiEdit` and nothing here knows whether that
 * is the right set. That a hook reached only through a declared caller is reached on any particular
 * run: `eval-log-stop.sh` guards its call with `[ -f … ]`, and a guard that is never true is
 * invisible from here. Helper scripts under `.claude/hooks/lib/` are not hooks and are not
 * enumerated — the glob is the same non-recursive `*.sh` the execution-coverage floor uses, so the
 * two floors quantify over exactly the same set.
 *
 * Exit 0 = clean, 1 = findings.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { requireGovernedTree } from './governed-tree.mjs';
import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);
const HOOKS_DIR = '.claude/hooks';
const SETTINGS_FILE = '.claude/settings.json';

/** How far into a file a `# invoked-by:` line still counts as a HEADER rather than a remark. */
const HEADER_LINES = 15;

/**
 * The hook file a declaration names, or null.
 *
 * Bounded to the header block on purpose. A mention anywhere in a 137-line script would let an
 * incidental comment — or a line of documentation ABOUT this convention — silently excuse a hook
 * nothing calls, which is the exemption list again, spelled differently.
 */
export function declaredInvoker(text) {
  const header = String(text ?? '')
    .split('\n')
    .slice(0, HEADER_LINES);
  for (const line of header) {
    const match = /^#\s*invoked-by:\s*([A-Za-z0-9._-]+\.sh)\s*$/.exec(line.trim());
    if (match) return match[1];
  }
  return null;
}

/**
 * Every `.claude/hooks/*.sh` basename named by a matcher, and how many matcher entries were read.
 *
 * The command is a shell string — `"$CLAUDE_PROJECT_DIR"/.claude/hooks/task-tracking.sh start` —
 * so the file is extracted by path shape rather than by equality with a constructed string. Reading
 * it as an exact path would have missed the two argument-carrying registrations on this tree and
 * reported both hooks unregistered, and a floor that fires on correct work gets switched off.
 *
 * @returns {{files: Map<string, string[]>, matchers: number, registrations: number}}
 *   files: hook basename → the events that register it.
 */
export function registeredHookFiles(settings) {
  const files = new Map();
  let matchers = 0;
  let registrations = 0;
  const hooks = settings?.hooks;
  if (typeof hooks !== 'object' || hooks === null) return { files, matchers, registrations };

  for (const [event, entries] of Object.entries(hooks)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      matchers += 1;
      const commands = Array.isArray(entry?.hooks) ? entry.hooks : [];
      for (const command of commands) {
        const text = typeof command?.command === 'string' ? command.command : '';
        for (const match of text.matchAll(/\.claude\/hooks\/([A-Za-z0-9._-]+\.sh)/g)) {
          registrations += 1;
          const existing = files.get(match[1]);
          if (existing) existing.push(event);
          else files.set(match[1], [event]);
        }
      }
    }
  }
  return { files, matchers, registrations };
}

/**
 * Does `text` INVOKE `name`, rather than merely mention it?
 *
 * A substring test let a comment certify the declaration: `# related: helper.sh does the parsing` in
 * the claimed caller was enough, and a hook nothing runs would then be excused by a sibling's prose.
 * That is the described-but-not-reached shape this scan exists to close, occurring inside its own
 * exemption path — so the reference has to look like a spawn: the name preceded by an interpreter or
 * a source, after comments are stripped.
 */
function invokes(text, name) {
  const withoutComments = String(text ?? '')
    .split('\n')
    .map((line) => line.replace(/(^|\s)#.*$/, '$1'))
    .join('\n');
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:bash|sh|zsh|source|\\.)\\s[^\\n]{0,80}${escaped}`).test(withoutComments);
}

/**
 * Follow a hook's `invoked-by` chain until it reaches a registered hook.
 *
 * Returns `{ ok: true }`, or the reason it does not resolve. Cycle-terminated: `a` declaring `b`
 * while `b` declares `a` is not a resolution, it is two hooks nothing calls.
 */
function resolveDeclaration(name, { hookText, registered }) {
  const seen = new Set([name]);
  let current = name;
  for (;;) {
    const caller = declaredInvoker(hookText.get(current));
    if (caller === null) {
      return {
        ok: false,
        reason:
          current === name
            ? 'is registered to no event in .claude/settings.json and carries no `# invoked-by: <hook>.sh` header — it never fires'
            : `is reached only through \`${current}\`, which is itself unregistered and undeclared`,
      };
    }
    if (!hookText.has(caller)) {
      return { ok: false, reason: `declares \`# invoked-by: ${caller}\`, which does not exist` };
    }
    if (!invokes(hookText.get(caller), current)) {
      return {
        ok: false,
        reason: `declares \`# invoked-by: ${caller}\`, but ${caller} does not reference ${current}`,
      };
    }
    if (registered.has(caller)) return { ok: true };
    if (seen.has(caller)) {
      return {
        ok: false,
        reason: `has an \`invoked-by\` chain (${[...seen, caller].join(' → ')}) that never reaches a registered hook`,
      };
    }
    seen.add(caller);
    current = caller;
  }
}

export function collectHookRegistrationFindings(root = WORKSPACE_ROOT) {
  requireGovernedTree(root, [HOOKS_DIR, SETTINGS_FILE], {
    scan: 'hook-registration',
    why: 'The hook directory and the settings file are the two sides this scan compares; with either absent there is nothing to compare and no registration to verify.',
  });

  const findings = [];
  const hooksDir = path.join(root, HOOKS_DIR);
  const hookNames = readdirSync(hooksDir).filter((f) => f.endsWith('.sh'));
  const hookText = new Map(
    hookNames.map((name) => [name, readFileSync(path.join(hooksDir, name), 'utf8')]),
  );

  let settings;
  try {
    settings = JSON.parse(readFileSync(path.join(root, SETTINGS_FILE), 'utf8'));
  } catch (error) {
    // Not swallowed into a default: unreadable settings means the comparison did not happen, and
    // the scan's own subject is a file that decides whether guards run at all.
    throw new Error(`hook-registration: ${SETTINGS_FILE} is not valid JSON — ${error.message}`);
  }

  const { files: registered, matchers, registrations } = registeredHookFiles(settings);

  // B. A matcher naming a file that is not there. The event fires, the command is not found, and
  // the session carries on: the loudest possible no-op.
  for (const [name, events] of registered) {
    if (!hookText.has(name)) {
      findings.push(
        `${SETTINGS_FILE} registers \`${name}\` for ${events.join(', ')}, but ${HOOKS_DIR}/${name} does not exist — the event fires and nothing runs.`,
      );
    }
  }

  // A. A hook file no matcher names, minus the ones that declare — and prove — an indirect caller.
  for (const name of hookNames) {
    if (registered.has(name)) continue;
    const resolved = resolveDeclaration(name, { hookText, registered });
    if (!resolved.ok) findings.push(`${HOOKS_DIR}/${name} ${resolved.reason}.`);
  }

  // A run that examined nothing must not read as a run that found nothing. `requireGovernedTree`
  // covers the directory's absence; an EMPTY directory, or a settings file with no matcher, is the
  // same vacuity one level in.
  if (hookNames.length === 0) {
    findings.push(`${HOOKS_DIR} contains no *.sh — 0 hooks examined, which is not 0 findings.`);
  }
  if (matchers === 0) {
    findings.push(
      `${SETTINGS_FILE} declares no matcher — 0 matchers examined, so no hook in ${HOOKS_DIR} is reached by this deployment.`,
    );
  }

  return { findings, hooksExamined: hookNames.length, matchersExamined: matchers, registrations };
}

export function main() {
  const { findings, hooksExamined, matchersExamined, registrations } =
    collectHookRegistrationFindings();

  if (findings.length > 0) {
    console.error('hook-registration scan: FINDINGS');
    for (const f of findings) console.error('  - ' + f);
    console.error(
      `\nExamined ${hooksExamined} hook file(s) against ${matchersExamined} matcher(s) ` +
        `(${registrations} registration(s)) in ${SETTINGS_FILE}.\n` +
        'Fix: register the hook under the event it belongs to, delete it, or — if a sibling hook ' +
        'invokes it — add a `# invoked-by: <that-hook>.sh` header line, which is verified against ' +
        "that hook's body.",
    );
    process.exit(1);
  }

  console.log(`::examined:: ${hooksExamined} hook files`);
  console.log(
    `hook-registration scan passed: ${hooksExamined} hook file(s), ${matchersExamined} matcher(s), ` +
      `${registrations} registration(s) — every hook is reached and every matcher resolves.`,
  );
  process.exit(0);
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  main();
}
