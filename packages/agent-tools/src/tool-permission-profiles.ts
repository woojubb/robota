/**
 * What the permission system is told about the tools THIS package defines. CORE-030.
 *
 * The classification used to live in `@robota-sdk/agent-core`'s `permission-mode.ts`, as a matrix
 * keyed on a closed union of product tool names — a vendor-neutral foundation holding a product's
 * tool inventory, two layers below the code that defines it, with nothing coupling the two lists.
 * They drifted: `CodebaseRetrieval` is defined here and the matrix had never heard of it, so a
 * read-only retrieval prompted on every call and was refused outright in plan mode.
 *
 * A tool's own package declares what it does. The foundation decides what each MODE does about that
 * kind of action, and neither restates the other's half.
 *
 * `packages/agent-tools/src/__tests__/tool-permission-profiles.test.ts` asserts that every tool this
 * package produces appears here, so adding a tool without classifying it fails rather than silently
 * inheriting the prompt-on-every-call fallback.
 */

import { registerToolPermissionProfile, type IToolPermissionProfile } from '@robota-sdk/agent-core';

/**
 * Every tool this package defines, and what the permission system needs to know about it.
 *
 * `argumentKey` is which argument a pattern like `Read(/src/**)` is matched against. A tool without
 * one cannot be narrowed by an argument pattern at all — the gate treats such a pattern as
 * unevaluable and prompts rather than proceeding, which is why the ones that CAN be narrowed say so.
 */
export const AGENT_TOOL_PERMISSION_PROFILES: Readonly<Record<string, IToolPermissionProfile>> = {
  // Reads and searches: observe, change nothing.
  Read: { argument: { key: 'filePath', kind: 'path' }, riskClass: 'inspect' },
  Glob: { argument: { key: 'pattern', kind: 'text' }, riskClass: 'inspect' },
  Grep: { argument: { key: 'pattern', kind: 'text' }, riskClass: 'inspect' },
  WebFetch: { argument: { key: 'url', kind: 'url' }, riskClass: 'inspect' },
  WebSearch: { argument: { key: 'query', kind: 'text' }, riskClass: 'inspect' },
  // The tool that had no classification at all until now. It reads the codebase and returns
  // excerpts; treating it as unknown meant prompting for every search and refusing it in plan mode,
  // which is the mode where searching is the only thing you CAN do.
  CodebaseRetrieval: { riskClass: 'inspect' },
  // Asking the user changes nothing, and prompting for permission to prompt is not a decision
  // anyone wants to make.
  AskUserQuestion: { riskClass: 'inspect' },
  // SELFHOST-010: looking at the screen is perception, decided like a read.
  ComputerView: { riskClass: 'inspect' },

  // Workspace changes: what `acceptEdits` exists to stop asking about.
  Write: { argument: { key: 'filePath', kind: 'path' }, riskClass: 'modify' },
  Edit: { argument: { key: 'filePath', kind: 'path' }, riskClass: 'modify' },

  // Arbitrary execution, where the blast radius is not bounded by a path.
  Shell: { argument: { key: 'command', kind: 'command' }, riskClass: 'execute' },
  // TERM-008: a model-familiar alias of the same implementation, so the same classification.
  Bash: { argument: { key: 'command', kind: 'command' }, riskClass: 'execute' },
  // SELFHOST-010: a GUI mutation is not a file edit, so `acceptEdits` must not cover it — which is
  // exactly what classifying it as execution rather than modification says.
  Computer: { riskClass: 'execute' },
};

/**
 * Tell the permission system about every tool this package defines. Idempotent.
 *
 * Not exported: the one caller is the line below. A registration a consumer could choose to skip is
 * a registration that might not happen, which is the state this change exists to leave behind.
 */
function registerAgentToolPermissionProfiles(): void {
  for (const [toolName, profile] of Object.entries(AGENT_TOOL_PERMISSION_PROFILES)) {
    registerToolPermissionProfile(toolName, profile);
  }
}

// Registered on import of this module, and each tool module imports it, so a tool's classification
// exists exactly when the module that defines the tool has loaded. Putting this in the package
// index instead would tie it to the barrel rather than to the tools.
registerAgentToolPermissionProfiles();
