/**
 * Permission mode definitions.
 *
 * A permission mode answers one question — how much does this session do without asking? — and it
 * answers it about a KIND of action, not about a named product tool.
 *
 * CORE-030: this file used to enumerate `TKnownToolName`
 * (`'Shell' | 'Bash' | 'Read' | 'Write' | 'Edit' | …`) and key the policy matrix on it. That put a
 * product's tool inventory in the vendor-neutral foundation, two layers below the packages that
 * define those tools, with nothing coupling the two lists — and the drift was not hypothetical:
 * `Agent`, `BackgroundProcess`, `CodebaseRetrieval` and `ExecuteCommand` were all produced tools the
 * matrix had never heard of. A read-only retrieval tool therefore prompted on every call and was
 * refused outright in plan mode, because "unknown" is the only thing the foundation could say about
 * it.
 *
 * The foundation now owns the POLICY (what each mode does about each kind of action) and each tool
 * owns its own CLASSIFICATION (which kind it is), declared where the tool is defined. Neither can
 * drift from the other, because neither restates the other's half.
 *
 * The modes themselves are Claude Code-compatible:
 * - plan: inspect freely, change nothing
 * - default: safe reads proceed, changes and command execution need approval
 * - acceptEdits: reads and workspace edits proceed, command execution still needs approval
 * - bypassPermissions: everything proceeds
 */

import type { TPermissionMode, TPermissionDecision } from './types.js';

/**
 * What kind of action a tool performs, from the permission system's point of view.
 *
 * These are the only distinctions the modes actually make, derived from the matrix this replaced:
 *
 * - `inspect` — observes without changing anything the user would want to approve. Reading a file,
 *   searching, fetching a page, looking at the screen. Asking the user a question is here too: it
 *   changes nothing, and prompting for permission to prompt is not a decision anyone wants to make.
 * - `modify` — changes the user's workspace. Writing and editing files. This is the distinction
 *   `acceptEdits` exists for: it is the class that mode stops asking about.
 * - `execute` — runs an arbitrary command, or acts outside the workspace where the blast radius is
 *   not bounded by a path. Shell, and a GUI action that clicks something real. `acceptEdits`
 *   deliberately does NOT cover this: accepting edits is not accepting execution.
 *
 * A tool that fits none of these is not a new class by default — it takes the unclassified fallback
 * below, which prompts. Adding a class means a mode has to say something new about it.
 */
export type TToolRiskClass = 'inspect' | 'modify' | 'execute';

/**
 * Permission mode → risk class → decision.
 *
 * `'auto'` proceeds silently, `'approve'` asks the user, `'deny'` refuses (see `./types.js`).
 */
export const RISK_CLASS_POLICY: Record<
  TPermissionMode,
  Record<TToolRiskClass, TPermissionDecision>
> = {
  plan: {
    inspect: 'auto',
    modify: 'deny',
    execute: 'deny',
  },
  default: {
    inspect: 'auto',
    modify: 'approve',
    execute: 'approve',
  },
  acceptEdits: {
    inspect: 'auto',
    // The whole point of this mode.
    modify: 'auto',
    // And the whole point of it stopping here.
    execute: 'approve',
  },
  bypassPermissions: {
    inspect: 'auto',
    modify: 'auto',
    execute: 'auto',
  },
};

/**
 * Decision for a tool whose owner has not declared a risk class.
 *
 * Fail-safe rather than fail-open: `'approve'` asks the user, it does not proceed. `plan` refuses,
 * because a mode whose promise is "change nothing" cannot keep that promise about an action it
 * cannot classify.
 */
export const UNCLASSIFIED_TOOL_FALLBACK: Record<TPermissionMode, TPermissionDecision> = {
  plan: 'deny',
  default: 'approve',
  acceptEdits: 'approve',
  bypassPermissions: 'auto',
};
