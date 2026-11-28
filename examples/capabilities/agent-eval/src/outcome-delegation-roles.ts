import { createHash } from 'node:crypto';

import type { IDelegationRoleInit, TJson } from './outcome-coding-protocol.js';

/**
 * The roles of the delegation arm and how a request is attributed to one. Shared by the host's
 * relay and the worker, so it holds no task, solution or verifier text.
 *
 * A role is recognized by its system message. The runtime assembles a child's system message
 * itself (the role's prompt plus framework text), so the host cannot know its bytes in advance:
 * each role's prompt carries a marker instead, and the first time a system message is seen its
 * hash is bound to the one role whose marker it contains. From then on the hash alone decides.
 * A message with no marker or several markers, a changed message for a bound role, and a hash
 * already bound to another role are all unattributed, and the relay stops the run on one.
 */

/** The model-visible name the runtime gives the subagent command. */
export const DELEGATION_TOOL = 'command_agent';

/** Most child jobs one delegation trial may start. */
export const MAX_CHILD_JOBS = 3;

export const PARENT_ROLE = 'parent';
export const IMPLEMENTER_ROLE = 'implementer';
export const REVIEWER_ROLE = 'reviewer';

/** The roles that are child jobs. */
export const CHILD_ROLES: readonly string[] = [IMPLEMENTER_ROLE, REVIEWER_ROLE];

/** The roles whose calls count as coordination rather than as the work itself. */
export const COORDINATION_ROLES: readonly string[] = [PARENT_ROLE, REVIEWER_ROLE];

export const roleMarker = (name: string): string => `[eval-role:${name}]`;

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** The text of a request body's system message, when it has exactly one. */
export function systemMessageOf(body: TJson | undefined): string | undefined {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return undefined;
  const messages = (body as { readonly messages?: TJson }).messages;
  if (!Array.isArray(messages)) return undefined;
  const systems = messages.filter(
    (message) =>
      message !== null &&
      typeof message === 'object' &&
      !Array.isArray(message) &&
      (message as { readonly role?: TJson }).role === 'system',
  );
  if (systems.length !== 1) return undefined;
  const content = (systems[0] as { readonly content?: TJson }).content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const texts = content.map((part) =>
      part !== null && typeof part === 'object' && !Array.isArray(part)
        ? (part as { readonly text?: TJson }).text
        : undefined,
    );
    return texts.every((text) => typeof text === 'string') ? texts.join('') : undefined;
  }
  return undefined;
}

export type TAttribution =
  | { readonly ok: true; readonly role: string; readonly hash: string }
  | { readonly ok: false; readonly detail: string };

export interface IRoleRegistry {
  attribute(body: TJson | undefined): TAttribution;
  /** Tools a role's requests may declare or call; empty for an unknown role. */
  toolsOf(role: string): readonly string[];
  /** Role name to the hash bound so far. */
  readonly bound: () => Readonly<Record<string, string>>;
}

export function createRoleRegistry(roles: readonly IDelegationRoleInit[]): IRoleRegistry {
  const byHash = new Map<string, string>();
  const byRole = new Map<string, string>();
  return {
    toolsOf: (role) => roles.find((candidate) => candidate.name === role)?.tools ?? [],
    bound: () => Object.fromEntries(byRole),
    attribute(body) {
      const text = systemMessageOf(body);
      if (text === undefined) {
        return { ok: false, detail: 'the request has no single text system message' };
      }
      const hash = sha256Hex(text);
      const known = byHash.get(hash);
      if (known !== undefined) return { ok: true, role: known, hash };
      const matching = roles.filter((role) => text.includes(role.marker));
      if (matching.length !== 1) {
        return {
          ok: false,
          detail:
            matching.length === 0
              ? 'the system message carries no role marker'
              : 'the system message carries more than one role marker',
        };
      }
      const role = (matching[0] as IDelegationRoleInit).name;
      if (byRole.has(role)) {
        return { ok: false, detail: `the system message of role ${role} changed during the trial` };
      }
      byHash.set(hash, role);
      byRole.set(role, hash);
      return { ok: true, role, hash };
    },
  };
}

/** The role a system message names by its marker, for the worker's own trimming of a request. */
export function roleByMarker(
  roles: readonly IDelegationRoleInit[],
  body: TJson | undefined,
): IDelegationRoleInit | undefined {
  const text = systemMessageOf(body);
  if (text === undefined) return undefined;
  const matching = roles.filter((role) => text.includes(role.marker));
  return matching.length === 1 ? matching[0] : undefined;
}

const PARENT_TOOLS = ['Read', 'Glob', 'Grep', DELEGATION_TOOL] as const;
const IMPLEMENTER_TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep'] as const;
const REVIEWER_TOOLS = ['Read', 'Glob', 'Grep'] as const;

/** The three roles for a project directory (where the worker sees the task tree). */
export function delegationRoles(projectDir: string): IDelegationRoleInit[] {
  return [
    {
      name: PARENT_ROLE,
      marker: roleMarker(PARENT_ROLE),
      description: 'Coordinates the work; reads files and delegates, never writes.',
      systemPrompt: [
        roleMarker(PARENT_ROLE),
        `You coordinate a coding task in ${projectDir}. You can read files (Read, Glob, Grep) and delegate, but you cannot change any file yourself.`,
        `Delegate with the ${DELEGATION_TOOL} tool, one job at a time, and wait for each result before the next: the args are parallel --wait LABEL=AGENT:"PROMPT" where AGENT is implementer or reviewer and the prompt holds no double quotes.`,
        'Give a job everything it needs in its prompt: it sees none of this conversation. Judge the final state by what the reviewer reports, not by what anyone claims.',
        'Test execution is performed independently after your answer.',
      ].join('\n'),
      tools: [...PARENT_TOOLS],
      maxTurns: 8,
    },
    {
      name: IMPLEMENTER_ROLE,
      marker: roleMarker(IMPLEMENTER_ROLE),
      description: 'Makes the requested change in the project files.',
      systemPrompt: [
        roleMarker(IMPLEMENTER_ROLE),
        `You are the implementer working in ${projectDir}. Use only Read, Write, Edit, Glob and Grep on this project.`,
        'Inspect relevant files, complete the requested change, and briefly state what changed. Do not edit tests or unrelated files. Do not run shell commands or access network services.',
        'Test execution is performed independently after your answer.',
      ].join('\n'),
      tools: [...IMPLEMENTER_TOOLS],
      maxTurns: 8,
    },
    {
      name: REVIEWER_ROLE,
      marker: roleMarker(REVIEWER_ROLE),
      description: 'Reads the project and judges a finished change; never writes.',
      systemPrompt: [
        roleMarker(REVIEWER_ROLE),
        `You are the reviewer of a change in ${projectDir}. Use only Read, Glob and Grep; you cannot change files.`,
        'Read the files the task concerns and decide whether the requested change is complete and correct. Answer with APPROVED or CHANGES NEEDED on the first line, then the reasons in a few sentences.',
      ].join('\n'),
      tools: [...REVIEWER_TOOLS],
      maxTurns: 4,
    },
  ];
}

/** The union of every role's tools: the session's allow-list; each request is trimmed to its role. */
export function unionTools(roles: readonly IDelegationRoleInit[]): string[] {
  return [...new Set(roles.flatMap((role) => role.tools))];
}

/** What the parent is asked to do for a task: the task text, the procedure and the job limit. */
export function delegationParentPrompt(taskPrompt: string, maxJobs: number): string {
  return [
    'Get the following task done by delegating it. Do not claim it is done until the work has been delegated and reviewed.',
    '',
    'Procedure:',
    '1. Start one implementer job and give it the complete task text below.',
    '2. When it finishes, start one reviewer job that reads the changed files and judges the result.',
    '3. If the reviewer says CHANGES NEEDED, start one more implementer job with the reviewer reasons; do not start any other job.',
    `4. You may start at most ${maxJobs} jobs in total. Then answer with a short statement of what was done.`,
    '',
    'Task text:',
    taskPrompt,
  ].join('\n');
}
