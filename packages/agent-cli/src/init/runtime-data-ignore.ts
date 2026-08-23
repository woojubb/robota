/**
 * `robota init` keeps runtime session data out of Git (SEC-020, issue #2021).
 *
 * Its own module rather than a helper inside the command, for two reasons that agree. It is a
 * separate responsibility — the command decides what a NEW project looks like, this decides what
 * must never be COMMITTED, and the second outlives the first because it runs again on every later
 * init. And folding it into the command took that file past its size ceiling, which is the
 * anti-monolith rule saying the same thing mechanically.
 */

import type {
  IWorkspaceProjectMutation,
  IWorkspaceProjectReader,
} from '@robota-sdk/agent-framework';

const IGNORE_PATH = '.robota/.gitignore';

const HEADER =
  '# Robota runtime session data — transcripts, tool output and machine-local settings.';

/**
 * The runtime data that must not be committed.
 *
 * Session records and logs carry prompts, model output, tool results and whatever a tool read out of
 * the working tree; `settings.local.json` is the machine-local override. None of it is reviewable
 * project configuration, and all of it is trivially committed by accident.
 *
 * `memory/` is deliberately NOT here, and the omission is a decision rather than an oversight.
 * Project memory is the same kind of artefact this repository checks in on purpose, and ignoring it
 * by default would make that choice for every user of the CLI. A user who wants it ignored adds one
 * line, which the merge below preserves.
 */
const RUNTIME_DATA_IGNORE_ENTRIES = [
  'sessions/',
  'logs/',
  'checkpoints/',
  'settings.local.json',
] as const;

/** What the write did, so the caller can say it without re-deriving it. */
export type TRuntimeDataIgnoreOutcome = 'created' | 'updated' | 'unchanged';

/**
 * Write `.robota/.gitignore` rather than touching the project's root `.gitignore`.
 *
 * Nested, so the patterns are relative to the directory they govern and live beside the data; git
 * reads it exactly the same way. Targeted, so `.robota/settings.json` and `.robota/agents/` stay
 * tracked — a blanket `.robota/` would hide reviewable project configuration along with the
 * transcripts. And a merge rather than an overwrite, so running `init` twice is a no-op and a line
 * the user added by hand survives.
 */
export function writeRuntimeDataIgnore(
  reader: IWorkspaceProjectReader,
  mutation: IWorkspaceProjectMutation,
): TRuntimeDataIgnoreOutcome {
  const existing = reader.readText(IGNORE_PATH, 'inspect runtime data ignore rules');
  const lines = existing === undefined ? [] : existing.split('\n');
  const present = new Set(lines.map((line) => line.trim()));
  const missing = RUNTIME_DATA_IGNORE_ENTRIES.filter((entry) => !present.has(entry));
  if (existing !== undefined && missing.length === 0) return 'unchanged';

  const body =
    existing === undefined
      ? [HEADER, ...RUNTIME_DATA_IGNORE_ENTRIES].join('\n')
      : [
          ...lines.filter((line, index) => index < lines.length - 1 || line !== ''),
          ...missing,
        ].join('\n');
  mutation.writeBytes(
    IGNORE_PATH,
    new TextEncoder().encode(`${body}\n`),
    'initialize runtime data ignore rules',
  );
  return existing === undefined ? 'created' : 'updated';
}
