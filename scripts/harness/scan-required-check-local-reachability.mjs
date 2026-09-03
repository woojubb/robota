#!/usr/bin/env node

/**
 * A required check you cannot run is one you discover by being blocked by it.
 *
 * INFRA-066, the third invariant axis. Two floors already govern required status checks — whether
 * the local stages match the ruleset (`ci-mirror-map`), and whether a required context is able to
 * fail at all (`scan-main-required-checks`). Neither asks the question that costs the most:
 * **can I run it before it stops me?**
 *
 * Measured 2026-07-27. `protect-main`'s `release-grade verification` runs on no other branch, so its
 * verdict was unknowable until a promotion PR was already open. Two consecutive promotions failed on
 * it, each costing an open-PR → CI → diagnose → fix → re-promote round trip. The command that
 * reproduces it sat in `package.json` the whole time and was even named in a header comment. Writing
 * it down was not the missing piece; a connection between the command and the act was.
 *
 * So every required context answers one of two things, and BOTH are legitimate:
 *
 *   "local": { "entryPoint": "pnpm harness:verify:release" }
 *   "local": { "notRunnable": "<why no local run could produce this verdict>" }
 *
 * THE SECOND IS NOT A DODGE. `windows-shell` needs a Windows runner; `review-gate` reads a
 * code-scanning analysis that only exists once a real pull request has been analysed. Recorded, that
 * is an answer. Omitted, it is indistinguishable from nobody having looked — the distinction the
 * whole vacuous-green family of items is about.
 *
 * ## A named entry point must RESOLVE
 *
 * `pnpm <script>` is checked against `package.json`, and `node <path>` against the file system. A
 * field satisfied by a plausible string is the defect this repository keeps re-finding: the mistake
 * catalogue once named a scan that existed but was the wrong one, and passed, because only existence
 * was checked. Existence is still the weaker property — it is also the one a machine can decide.
 *
 * ## The excuse has ONE owner
 *
 * `ci-mirror-map.mjs` already carries a reason and a manual command for the develop-side contexts it
 * cannot mirror. This scan does not copy those reasons; it requires the two sources to AGREE — a
 * context excused there is excused here, and a context it does mirror must name an entry point. A
 * second copy of a reason is a fork that agrees on the day it is written, which is exactly how the
 * declared mirror `verify-like-ci` came to be described as CI-equivalent while having no caller.
 *
 * Exit 0 = every required context of every protected branch answers, and every named entry point
 * resolves to something that exists.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { NOT_MIRRORED } from './ci-mirror-map.mjs';
import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);
const DECLARATION = '.github/required-status-checks.json';

/** The branch whose contexts `ci-mirror-map` speaks for. Its `NOT_MIRRORED` says nothing about main. */
const MIRROR_MAP_BRANCH = 'develop';

/** A pointer at the reason's owner, rather than a second copy of the reason. */
export const DEFERS_TO_MIRROR_MAP = 'ci-mirror-map NOT_MIRRORED';

/**
 * Whether a command names something that exists.
 *
 * Injected so a case can describe a repository without building one.
 */
export function resolvesCommand(command, { scripts, fileExists }) {
  const pnpm = /^pnpm\s+([^\s]+)/.exec(command);
  if (pnpm) return Object.prototype.hasOwnProperty.call(scripts, pnpm[1]);
  const node = /^node\s+([^\s]+)/.exec(command);
  if (node) return fileExists(node[1]);
  // Neither shape. Refuse rather than pass: a command this cannot check is a command nobody checked.
  return false;
}

export function judgeContexts(branches, { scripts, fileExists, excusedByMirrorMap }) {
  const findings = [];
  let examined = 0;

  for (const [branch, contexts] of Object.entries(branches)) {
    for (const entry of contexts) {
      examined += 1;
      const local = entry.local;
      const where = `${branch} → ${entry.context}`;

      if (!local || (!local.entryPoint && !local.notRunnable)) {
        findings.push({
          where,
          kind: 'no-answer',
          detail:
            'declares neither a local entry point nor a reason it cannot have one. An unanswered ' +
            'context reads like an oversight, and is how an unrunnable gate stays undiscovered.',
        });
        continue;
      }

      if (local.entryPoint && local.notRunnable) {
        findings.push({
          where,
          kind: 'answers-both-ways',
          detail: 'names an entry point AND claims it cannot be run locally. Only one is true.',
        });
        continue;
      }

      if (local.entryPoint) {
        if (!resolvesCommand(local.entryPoint, { scripts, fileExists })) {
          findings.push({
            where,
            kind: 'entry-point-names-nothing',
            detail: `\`${local.entryPoint}\` resolves to no package script and no file. A field satisfied by a plausible string is not a reachable check.`,
          });
        }
        // A context the mirror map has already excused cannot also be locally runnable: one of the
        // two documents is then wrong, and which one is not decidable from here.
        if (branch === MIRROR_MAP_BRANCH && excusedByMirrorMap.has(entry.context)) {
          findings.push({
            where,
            kind: 'disagrees-with-the-mirror-map',
            detail:
              'names a local entry point while `ci-mirror-map` lists it as NOT mirrored. Fix whichever is stale — two sources disagreeing is worse than either answer.',
          });
        }
        continue;
      }

      // notRunnable
      if (local.notRunnable === DEFERS_TO_MIRROR_MAP) {
        if (!(branch === MIRROR_MAP_BRANCH && excusedByMirrorMap.has(entry.context))) {
          findings.push({
            where,
            kind: 'defers-to-an-owner-that-does-not-own-it',
            detail: `defers its reason to \`${DEFERS_TO_MIRROR_MAP}\`, which carries no entry for this context. A pointer at nothing is worse than no pointer.`,
          });
        }
        continue;
      }

      // A non-string here (`true`, a number, an object) would throw on `.trim()` — loud, but a crash
      // is not a verdict, and this file's whole subject is telling "I could not check" apart from
      // "I checked". It gets the same finding an empty reason does, because it is the same state:
      // the field was filled in without a reason in it.
      if (typeof local.notRunnable !== 'string' || local.notRunnable.trim().length === 0) {
        findings.push({
          where,
          kind: 'excused-without-a-reason',
          detail:
            'claims it cannot be run locally and says nothing about why. The reason is the decision.',
        });
      }
    }
  }

  return { findings, examined };
}

export function scanRequiredCheckLocalReachability(root = WORKSPACE_ROOT) {
  const file = path.join(root, DECLARATION);
  // Fail closed: a declaration that is not there has no unanswered contexts, and that is not a pass.
  if (!existsSync(file))
    throw new Error(
      `required-check-local-reachability: ${DECLARATION} does not exist under ${root}.`,
    );

  const declaration = JSON.parse(readFileSync(file, 'utf8'));
  const branches = Object.fromEntries(
    Object.entries(declaration.branches ?? {}).map(([branch, value]) => [
      branch,
      value.required_status_checks ?? [],
    ]),
  );
  const total = Object.values(branches).reduce((sum, list) => sum + list.length, 0);
  if (total === 0)
    throw new Error(`required-check-local-reachability: ${DECLARATION} declares no contexts.`);

  const scripts = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).scripts ?? {};

  return judgeContexts(branches, {
    scripts,
    fileExists: (relative) => existsSync(path.join(root, relative)),
    excusedByMirrorMap: new Set(NOT_MIRRORED.map((entry) => entry.context)),
  });
}

function main() {
  const { findings, examined } = scanRequiredCheckLocalReachability();
  console.log(`::examined:: ${examined} required status checks`);

  if (findings.length > 0) {
    console.error(`required-check-local-reachability scan failed: ${findings.length} context(s):`);
    for (const finding of findings) {
      console.error(`  - [${finding.kind}] ${finding.where}: ${finding.detail}`);
    }
    console.error(
      '\nEvery required context declares `local.entryPoint` (a command that reproduces it) or ' +
        '`local.notRunnable` (why no local run could produce the verdict). Both are answers; ' +
        'silence is not.',
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `required-check-local-reachability scan passed (${examined} required context(s); each names a ` +
      'local entry point or records why it has none).',
  );
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) main();
