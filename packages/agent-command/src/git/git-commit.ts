/**
 * BEHAVIOR-2437: `/git commit [<subject>]` — the staged set, and only ever the staged set.
 *
 * No `-a`, no `add`, no paths. Nothing staged is answered with guidance that says why; the subject
 * is held to the Conventional Commits v1.0.0 MUST rules and nothing more (the commitlint conventions
 * are warnings, never refusals); the confirmation lists the message and exactly the files
 * `git diff --cached --name-status` reports; an absent `IUserInteraction` is a cancellation — the
 * `/doctor repair` precedent — never a guess. Only after "Yes" does `git commit -m <subject>` run.
 */
import { confirmAction, isConfirmed, textAction } from '@robota-sdk/agent-core';

import { gitFailureMessage } from './git-process.js';
import { parseStatusPorcelainV2, GIT_STATUS_ARGS } from './git-status.js';

import type { IGitProcessPort } from './git-process.js';
import type { IUserInteraction } from '@robota-sdk/agent-core';
import type { ICommandResult } from '@robota-sdk/agent-interface-command';

const GIT_COMMIT_CONVENTIONAL_TYPES: readonly string[] = [
  'build',
  'chore',
  'ci',
  'docs',
  'feat',
  'fix',
  'perf',
  'refactor',
  'revert',
  'style',
  'test',
];
const GIT_COMMIT_SUBJECT_LIMIT = 72;

export type TConventionalSubjectCheck =
  { ok: true; warnings: readonly string[] } | { ok: false; reason: string };

/** `<type>[(scope)][!]: <description>` — the MUST rules, and only those. */
const CONVENTIONAL_SUBJECT = /^([^\s():!]+)(\(([^\s()]+)\))?(!)?: (.*)$/;

export function validateConventionalSubject(subject: string): TConventionalSubjectCheck {
  if (subject.trim().length === 0) return { ok: false, reason: 'the subject is empty' };
  const separator = subject.indexOf(': ');
  if (separator === -1) {
    return {
      ok: false,
      reason:
        'the subject has no `: ` type separator — the form is `<type>[(scope)][!]: <description>`',
    };
  }
  const match = CONVENTIONAL_SUBJECT.exec(subject);
  if (!match) {
    return {
      ok: false,
      reason:
        'the part before `: ` must be a type word with an optional `(scope)` and `!` — the form is `<type>[(scope)][!]: <description>`',
    };
  }
  const type = match[1] ?? '';
  const description = match[5] ?? '';
  if (description.trim().length === 0) {
    return { ok: false, reason: 'the description after `: ` is empty' };
  }
  const warnings: string[] = [];
  if (!GIT_COMMIT_CONVENTIONAL_TYPES.includes(type)) {
    warnings.push(
      `type "${type}" is not one of the conventional types (${GIT_COMMIT_CONVENTIONAL_TYPES.join(', ')})`,
    );
  }
  if (subject.length > GIT_COMMIT_SUBJECT_LIMIT) {
    warnings.push(
      `the subject is ${subject.length} characters; ${GIT_COMMIT_SUBJECT_LIMIT} is the conventional limit`,
    );
  }
  if (subject.endsWith('.')) warnings.push('the subject ends with a period');
  return { ok: true, warnings };
}

/** The inline subject: an optional leading `-m`, then one matching pair of outer quotes stripped. */
export function normalizeCommitSubject(args: string): string {
  let subject = args.trim();
  if (subject === '-m') return '';
  if (subject.startsWith('-m ')) subject = subject.slice('-m '.length).trim();
  if (
    subject.length >= 2 &&
    (subject.startsWith('"') || subject.startsWith("'")) &&
    subject.endsWith(subject[0] ?? '')
  ) {
    subject = subject.slice(1, -1).trim();
  }
  return subject;
}

function cancelled(message: string): ICommandResult {
  return { success: false, message, data: { git: 'commit', committed: false } };
}

async function askSubject(ui: IUserInteraction): Promise<string | undefined> {
  const response = await ui.ask(
    textAction('git-commit-subject', 'Commit message', {
      description: 'Conventional Commits form: <type>[(scope)][!]: <description>',
      placeholder: 'feat: describe the change',
    }),
  );
  if (response.type !== 'answer') return undefined;
  const text = response.text ?? response.values[0] ?? '';
  return normalizeCommitSubject(text);
}

type TStagedCheck = { staged: true } | { staged: false; result: ICommandResult };

/** Step 1 — the staged set decides everything; exit 1 means something is staged. */
async function checkStaged(port: IGitProcessPort, cwd: string): Promise<TStagedCheck> {
  const staged = await port.run(['diff', '--cached', '--quiet'], { cwd });
  if (staged.kind === 'failed' || (staged.exitCode !== 0 && staged.exitCode !== 1)) {
    return {
      staged: false,
      result: {
        success: false,
        message: gitFailureMessage('diff --cached', staged) ?? 'git failed',
      },
    };
  }
  if (staged.exitCode === 1) return { staged: true };
  const status = await port.run(GIT_STATUS_ARGS, { cwd });
  const failure = gitFailureMessage('status', status);
  if (failure !== undefined || status.kind !== 'exited') {
    return { staged: false, result: { success: false, message: failure ?? 'git status failed' } };
  }
  const summary = parseStatusPorcelainV2(status.stdout);
  return {
    staged: false,
    result: {
      success: false,
      message: `Nothing is staged (${summary.unstaged.length} unstaged, ${summary.untracked.length} untracked). Stage files with \`git add\` or \`/shell git add ...\` and run \`/git commit\` again.`,
      data: {
        git: 'commit',
        committed: false,
        unstaged: summary.unstaged.length,
        untracked: summary.untracked.length,
      },
    },
  };
}

type TSubjectResolution = { subject: string } | { result: ICommandResult };

/** Step 2 — the subject: inline, or asked for as free text; then the MUST rules. */
async function resolveSubject(
  args: string,
  ui: IUserInteraction | undefined,
): Promise<TSubjectResolution> {
  let subject = normalizeCommitSubject(args);
  if (subject.length === 0) {
    if (ui === undefined) {
      return {
        result: cancelled(
          'Commit cancelled: a commit message was needed and none could be asked for (no interactive session). Run `/git commit <subject>`.',
        ),
      };
    }
    const asked = await askSubject(ui);
    if (asked === undefined || asked.length === 0)
      return { result: cancelled('Commit cancelled.') };
    subject = asked;
  }
  return { subject };
}

/** Step 3 — what is confirmed is what is committed: the listing comes from git, not from a guess. */
async function confirmCommit(
  port: IGitProcessPort,
  cwd: string,
  subject: string,
  warnings: readonly string[],
  ui: IUserInteraction | undefined,
): Promise<
  { confirmed: true; files: readonly string[] } | { confirmed: false; result: ICommandResult }
> {
  if (ui === undefined) {
    return {
      confirmed: false,
      result: cancelled(
        'Commit cancelled: a confirmation was needed and none could be asked for (no interactive session).',
      ),
    };
  }
  const listing = await port.run(['diff', '--cached', '--name-status'], { cwd });
  const listingFailure = gitFailureMessage('diff --cached --name-status', listing);
  if (listingFailure !== undefined || listing.kind !== 'exited') {
    return {
      confirmed: false,
      result: { success: false, message: listingFailure ?? 'git failed' },
    };
  }
  const files = listing.stdout
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => line.replace(/\t/g, ' '));
  const description = [
    `Message: ${subject}`,
    ...warnings.map((warning) => `Warning: ${warning}`),
    `Staged (${files.length}):`,
    ...files.map((file) => `  ${file}`),
  ].join('\n');
  const response = await ui.ask(
    confirmAction('git-commit', `Commit ${files.length} staged file(s)?`, {
      description,
      defaultYes: false,
    }),
  );
  if (!isConfirmed(response)) return { confirmed: false, result: cancelled('Commit cancelled.') };
  return { confirmed: true, files };
}

export async function executeGitCommit(
  port: IGitProcessPort,
  cwd: string,
  args: string,
  ui: IUserInteraction | undefined,
): Promise<ICommandResult> {
  const staged = await checkStaged(port, cwd);
  if (!staged.staged) return staged.result;

  const resolved = await resolveSubject(args, ui);
  if (!('subject' in resolved)) return resolved.result;
  const { subject } = resolved;
  const check = validateConventionalSubject(subject);
  if (!check.ok) {
    return {
      success: false,
      message: `Commit refused: ${check.reason}.`,
      data: { git: 'commit', committed: false, subject },
    };
  }

  const confirmation = await confirmCommit(port, cwd, subject, check.warnings, ui);
  if (!confirmation.confirmed) return confirmation.result;

  // Step 4 — exactly `commit -m <subject>`: never `-a`, never `add`.
  const commit = await port.run(['commit', '-m', subject], { cwd });
  const failure = gitFailureMessage('commit', commit);
  if (failure !== undefined || commit.kind !== 'exited') {
    return { success: false, message: failure ?? 'git commit failed' };
  }
  const firstLine = commit.stdout.split('\n').find((line) => line.trim().length > 0) ?? '';
  return {
    success: true,
    message: `Committed: ${firstLine.length > 0 ? firstLine : subject}`,
    data: { git: 'commit', committed: true, subject, files: confirmation.files },
  };
}
