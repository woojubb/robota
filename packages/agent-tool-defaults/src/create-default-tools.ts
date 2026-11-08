/**
 * The DEFAULT TOOL SET — a composition leaf.
 *
 * This lives outside `@robota-sdk/agent-framework`. It is a defaults aggregator, and
 * `.agents/project-structure.md` classifies that family as a composition leaf "imported only at
 * composition roots (entry-point-only)" — not something a mid-layer assembly library owns, publishes
 * and self-consumes.
 *
 * The move is what carries the guarantee. `agent-subagent-runner` may depend on `agent-framework`
 * (it needs `createSubagentSession` and friends) but has no manifest edge to THIS package, so
 * `import { createDefaultTools } from '@robota-sdk/agent-tool-defaults'` does not resolve there at
 * all. A neutral runner composing the product's tool surface is now a compile error rather than a
 * scan finding — the same shape as on the provider axis with
 * `@robota-sdk/agent-builtin-providers`.
 *
 * `DEFAULT_TOOL_DESCRIPTIONS` deliberately did NOT come along: its only consumer builds the system
 * prompt synchronously, and dragging it here would force either a static edge back into this leaf or
 * a second async hop through prompt building. It stays beside its consumer in `agent-framework`.
 */
import { createAskUserQuestionTool, routesFilesThroughSandbox } from '@robota-sdk/agent-tools';
import {
  createShellTool,
  createBashTool,
  createReadTool,
  createWriteTool,
  createEditTool,
  createGlobTool,
  createGrepTool,
  createWebFetchTool,
} from '@robota-sdk/agent-tools/node';

import type { FunctionTool } from '@robota-sdk/agent-core';
import type { IEditorFileAccess, ISandboxClient } from '@robota-sdk/agent-tools';

/**
 * Create the default set of CLI tools.
 * Returns the standard tools: only those that need no external service, credential or adapter. A
 * tool that does is built by the composition root that owns the adapter.
 */
export interface ICreateDefaultToolsOptions {
  sandboxClient?: ISandboxClient;
  /** Host-selected executable for Shell and Bash. */
  shellExecutable?: string;
  httpUserAgent?: string;
  /**
   * The execution root every file tool is contained by. REQUIRED.
   *
   * It was optional, and `child-process-subagent-worker.ts` called this factory with no argument at
   * all: `cwd` was `undefined`, the path guard was fail-open, and the subagent's `Read` returned
   * `/etc/hostname`. Requiring it means a construction site that forgets does not compile, which is
   * the only way a containment root stays a contract rather than a convention.
   */
  cwd: string;
  /**
   * An editor that has the workspace open, asked at each call. The host file tools read and write
   * through what it offers and the searches say they read the disk; commands never use it, and a
   * sandbox with its own filesystem keeps every file tool, since its files are not the editor's.
   */
  editorFiles?: () => IEditorFileAccess | undefined;
}

/**
 * Returns `FunctionTool[]`, which is what every factory below actually returns.
 *
 * An earlier revision cast each one to `IToolWithEventService` because session assembly consumes that
 * interface. The cast was lossy in the direction that mattered: `ICapabilityPack.tools` is
 * `readonly FunctionTool[]`, so a pack CONSUMING this set could not assign it without a second cast
 * back — one erasure creating the need for another. `FunctionTool` satisfies `IToolWithEventService`,
 * so session assembly is unaffected and no cast is needed at either end.
 */
export function createDefaultTools(options: ICreateDefaultToolsOptions): FunctionTool[] {
  // The sandbox's filesystem relation decides where file tools read and write. On a
  // SEPARATE filesystem every file tool goes through the sandbox — and `Glob`/`Grep`, which have no
  // sandbox path, are withheld, so a search can never read the host while an edit writes the
  // sandbox. On a SHARED filesystem (commands confined over the host's) file tools stay on the host
  // under the path guard, and only commands run through the sandbox.
  const separate = routesFilesThroughSandbox(options.sandboxClient);
  // An editor holds the host's files, so it reaches only the tools that work on them; commands keep
  // the agent's own sandbox.
  const { editorFiles: _hostFilesOnly, ...commandOptions } = options;
  const { sandboxClient: _commandsOnly, ...hostFileOptions } = options;
  const fileOptions = separate ? commandOptions : hostFileOptions;
  return [
    createShellTool(commandOptions),
    createBashTool(commandOptions),
    createReadTool(fileOptions),
    createWriteTool(fileOptions),
    createEditTool(fileOptions),
    // Built per call, NOT the module-level singletons. A singleton is context-free by
    // construction, so registering one meant `Glob`/`Grep` could enumerate outside the session's
    // working directory while `Read`/`Write`/`Edit` were contained.
    ...(separate ? [] : [createGlobTool(hostFileOptions), createGrepTool(hostFileOptions)]),
    // MUST 4: also built per call, for the same reason — `webFetchTool` is a module-level
    // singleton in `agent-tools`, so two concurrently open sessions built from this set (e.g. two
    // `sessionParticipant`s) shared it and tripped `resource-reused` even though nothing about a
    // WebFetch tool actually needs to be shared across sessions.
    createWebFetchTool({ userAgent: options.httpUserAgent }),
    createAskUserQuestionTool(),
  ];
}
