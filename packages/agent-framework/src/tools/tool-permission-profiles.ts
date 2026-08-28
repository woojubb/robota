/**
 * What the permission system is told about the tools THIS package defines. CORE-030.
 *
 * These three were the sharpest evidence that the old arrangement could not work: they are produced
 * here, the classification lived in `@robota-sdk/agent-core`'s hardcoded matrix, and that matrix had
 * never heard of any of them. Two of them run commands.
 *
 * `packages/agent-framework/src/tools/__tests__/tool-permission-profiles.test.ts` asserts that every
 * tool this package produces appears here.
 */

import { registerToolPermissionProfile, type IToolPermissionProfile } from '@robota-sdk/agent-core';

/** Every tool this package defines, and what the permission system needs to know about it. */
export const FRAMEWORK_TOOL_PERMISSION_PROFILES: Readonly<Record<string, IToolPermissionProfile>> =
  {
    /**
     * Starts a shell command that outlives the call. Execution, not modification — `acceptEdits`
     * accepting file edits is not the user accepting a background process.
     */
    BackgroundProcess: { argument: { key: 'command', kind: 'command' }, riskClass: 'execute' },

    /**
     * Runs a slash command on the user's behalf. A command can do anything the CLI can do, so the
     * blast radius is not bounded by a path.
     */
    ExecuteCommand: { argument: { key: 'command', kind: 'command' }, riskClass: 'execute' },

    /**
     * Spawns a subagent, which then runs with its own tools and its own permission policy.
     *
     * Classified as execution because that is the honest upper bound: what the subagent will do is
     * not knowable here, and a class is a statement about the worst case rather than the usual one.
     * The subagent's own calls are gated separately by its policy (CORE-025), so this is not the only
     * check between a spawned agent and the user's machine.
     */
    Agent: { riskClass: 'execute' },
  };

/**
 * Tell the permission system about every tool this package defines. Idempotent.
 *
 * Not exported: the one caller is the line below. A registration a consumer could choose to skip is
 * a registration that might not happen, which is the state this change exists to leave behind.
 */
function registerFrameworkToolPermissionProfiles(): void {
  for (const [toolName, profile] of Object.entries(FRAMEWORK_TOOL_PERMISSION_PROFILES)) {
    registerToolPermissionProfile(toolName, profile);
  }
}

// Registered on import of this module, and each tool module imports it, so a tool's classification
// exists exactly when the module that defines the tool has loaded. Putting this in the package
// index instead would tie it to the barrel rather than to the tools.
registerFrameworkToolPermissionProfiles();
