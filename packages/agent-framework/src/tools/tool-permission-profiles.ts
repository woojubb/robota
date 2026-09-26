/**
 * What the permission system is told about the tools THIS package defines. CORE-030.
 *
 * The first three were the sharpest evidence that the old arrangement could not work: they are produced
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

    /**
     * Asks a second model for advice. It changes nothing on this machine, so it is an inspection;
     * where the conversation may be sent is governed by the organization's provider allowlist and
     * the user's per-vendor consent, which the advisor checks itself.
     */
    Advisor: { riskClass: 'inspect' },

    /**
     * Not a model tool: the user's `/cd`, judged by the same rules so `deny: ["Cd(/secrets/**)"]` can
     * keep a session out of a directory (issue #3081). Moving changes nothing by itself — the new
     * session's own rules and trust decision govern what happens there — so it is an inspection.
     */
    Cd: { argument: { key: 'path', kind: 'path' }, riskClass: 'inspect' },

    /**
     * Answers the peer session that drove the current turn, and exists only in a peer turn. It sends
     * text off this machine, so it declares no risk class: every mode treats it as an action it cannot
     * vouch for — it asks, plan mode refuses it, bypass lets it through — and rules and remembered
     * consent decide it as they would any call.
     */
    peer_reply: { argument: { key: 'text', kind: 'text' }, repliesToPeer: true },

    /**
     * Sends a copy of a workspace file to another of the operator's sessions. The tool asks the
     * operator itself on every call, showing the file and where it goes, and no mode, rule or
     * remembered consent answers that question; so the gate treats the call as the read it is here
     * rather than asking twice. A deny rule still removes it, and a turn a peer's message started
     * never reaches it.
     */
    /**
     * The goal loop's signal and the self-paced loop's decision: each records the agent's own
     * assessment for the loop that asked for it and changes nothing else. They are inspections, as
     * asking the user for leave to report is pointless — and plan mode must not refuse the call that
     * lets a goal finish.
     */
    report_goal_status: { riskClass: 'inspect' },
    report_loop_decision: { riskClass: 'inspect' },

    peer_send_file: {
      argument: { key: 'path', kind: 'path' },
      riskClass: 'inspect',
      notInPeerTurn: true,
    },
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
