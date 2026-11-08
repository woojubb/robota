/**
 * How a run's command line and terminal become the startup resume decision, and how that decision
 * reaches the terminal UI. Kept apart from `cli-core.ts` so what makes a "yes" work — who can
 * be asked, and the accepted digest reaching the session — is one tested place.
 */

import type { IStartupResumeInput, TStartupResume } from './startup-resume.js';
import type { IInteractiveSessionStore } from '@robota-sdk/agent-interface-session';

/** The run's surface and terminal, as far as asking a person before the session starts goes. */
export interface IStartupAskSurface {
  /** `-p`, `--goal`, `--serve`, MCP serve or ACP: surfaces with no one at a terminal to ask. */
  readonly printMode: boolean;
  readonly goal: boolean;
  readonly serve: boolean;
  readonly mcpServe: boolean;
  readonly acp: boolean;
  readonly stdinIsTTY: boolean;
  readonly stdoutIsTTY: boolean;
  readonly stderrIsTTY: boolean;
}

/**
 * Whether a person at a terminal can answer the startup question: only the terminal UI, and only
 * when the question's own streams are a terminal — it is written on stderr and answered on stdin —
 * as is stdout, which the UI then draws on. Anywhere else the run refuses instead of waiting on a
 * question nobody sees.
 */
export function canAskAtStartup(surface: IStartupAskSurface): boolean {
  return (
    !(surface.printMode || surface.goal || surface.serve || surface.mcpServe || surface.acp) &&
    surface.stdinIsTTY &&
    surface.stderrIsTTY &&
    surface.stdoutIsTTY
  );
}

/** What the run asked for, from its command line. */
export interface IStartupResumeRequest {
  readonly continueMode: boolean;
  readonly resumeId: string | undefined;
  readonly noSessionPersistence: boolean;
}

/** The startup resume input for this run. */
export function startupResumeInput(options: {
  readonly store: IInteractiveSessionStore | undefined;
  readonly cwd: string;
  readonly request: IStartupResumeRequest;
  readonly surface: IStartupAskSurface;
  readonly confirm: IStartupResumeInput['confirm'];
  readonly write: IStartupResumeInput['write'];
}): IStartupResumeInput {
  return {
    store: options.store,
    cwd: options.cwd,
    continueMode: options.request.continueMode,
    resumeId: options.request.resumeId,
    // A served/daemon runtime's own launch reuses an existing empty session of this
    // workspace instead of adding another one — nothing else can be bound to anything yet.
    reuseEmptySession: options.surface.serve && !options.request.noSessionPersistence,
    interactive: canAskAtStartup(options.surface),
    confirm: options.confirm,
    write: options.write,
  };
}

/** What the terminal UI is told of the session the run starts in. */
export interface IStartupResumeRenderOptions {
  readonly resumeSessionId?: string;
  /** The digest of the bytes the person accepted, which the session checks its claim's read against. */
  readonly acceptedDigest?: string;
  readonly showSessionPickerOnStart: boolean;
}

/** The startup decision as the terminal UI's options. */
export function startupResumeRenderOptions(
  resume: Extract<TStartupResume, { kind: 'start' }>,
): IStartupResumeRenderOptions {
  return {
    ...(resume.resumeSessionId !== undefined ? { resumeSessionId: resume.resumeSessionId } : {}),
    ...(resume.acceptedDigest !== undefined ? { acceptedDigest: resume.acceptedDigest } : {}),
    showSessionPickerOnStart: resume.showSessionPicker === true,
  };
}
