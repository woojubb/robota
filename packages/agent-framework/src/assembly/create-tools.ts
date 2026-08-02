/**
 * Default tool set factory — creates the standard set of CLI tools.
 */

import {
  createAskUserQuestionTool,
  createShellTool,
  createBashTool,
  createReadTool,
  createWriteTool,
  createEditTool,
  createRetrievalTool,
  createComputerTool,
  createGlobTool,
  createGrepTool,
  webFetchTool,
  webSearchTool,
} from '@robota-sdk/agent-tools';

import type { IToolWithEventService } from '@robota-sdk/agent-core';
import type { ISandboxClient, IRetrievalAdapter, IComputerDriver } from '@robota-sdk/agent-tools';

/** Human-readable descriptions of the built-in tools (for system prompt) */
export const DEFAULT_TOOL_DESCRIPTIONS = [
  'Shell — execute host shell commands (OS-aware: bash/PowerShell)',
  'Bash — alias of Shell (model-familiar name)',
  'Read — read file contents with line numbers',
  'Write — write content to a file',
  'Edit — replace a string in a file',
  'Glob — find files matching a pattern',
  'Grep — search file contents with regex',
  'WebFetch — fetch URL content as text',
  'WebSearch — search the internet through the configured local tool',
  'AskUserQuestion — ask the user structured questions (options/multi-select/free text) mid-task',
];

/**
 * Create the default set of CLI tools.
 * Returns the standard tools as IToolWithEventService[].
 */
export interface ICreateDefaultToolsOptions {
  sandboxClient?: ISandboxClient;
  /**
   * The execution root every file tool is contained by. REQUIRED — ARCH-010.
   *
   * It was optional, and `child-process-subagent-worker.ts` called this factory with no argument at
   * all: `cwd` was `undefined`, the path guard was fail-open, and the subagent's `Read` returned
   * `/etc/hostname`. Requiring it means a construction site that forgets does not compile, which is
   * the only way a containment root stays a contract rather than a convention.
   */
  cwd: string;
  /** SELFHOST-003: when present, adds the adapter-gated `CodebaseRetrieval` tool (absent otherwise). */
  retrievalAdapter?: IRetrievalAdapter;
  /**
   * SELFHOST-010: when present, adds the adapter-gated `ComputerView` + `Computer` tools. Unlike the
   * shell tool's host `spawn` fallback, computer-use has NO host fallback — with no driver the tools are
   * simply ABSENT (there is no safe library-side "local" screen to fall back to).
   */
  computerDriver?: IComputerDriver;
}

export function createDefaultTools(options: ICreateDefaultToolsOptions): IToolWithEventService[] {
  return [
    createShellTool(options) as IToolWithEventService,
    createBashTool(options) as IToolWithEventService,
    createReadTool(options) as IToolWithEventService,
    createWriteTool(options) as IToolWithEventService,
    createEditTool(options) as IToolWithEventService,
    // SEC-007: built per call, NOT the module-level singletons. A singleton is context-free by
    // construction, so registering one meant `Glob`/`Grep` could enumerate outside the session's
    // working directory while `Read`/`Write`/`Edit` were contained.
    createGlobTool(options) as IToolWithEventService,
    createGrepTool(options) as IToolWithEventService,
    webFetchTool as IToolWithEventService,
    webSearchTool as IToolWithEventService,
    createAskUserQuestionTool() as IToolWithEventService,
    // Retrieval is adapter-gated: absent when no adapter is supplied (there is no host fallback).
    ...(options.retrievalAdapter
      ? [createRetrievalTool({ adapter: options.retrievalAdapter }) as IToolWithEventService]
      : []),
    // Computer-use is adapter-gated on the driver: absent when no driver is supplied. There is NO host
    // fallback (unlike the shell tool's host spawn) — no library-side "local" screen exists.
    ...(options.computerDriver
      ? (createComputerTool({ driver: options.computerDriver }) as IToolWithEventService[])
      : []),
  ];
}
