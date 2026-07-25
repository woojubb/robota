export type TSelfHostingVerificationPhase =
  'checkpoint' | 'edit' | 'handoff' | 'verify' | 'recover';

export type TSelfHostingLoopState =
  | 'idle'
  | 'checkpointed'
  | 'editing'
  | 'verifying'
  | 'passed'
  | 'failed'
  | 'rolled_back'
  | 'cancelled';

export type TSelfHostingLoopEvent =
  | 'checkpoint_created'
  | 'edits_started'
  | 'edits_applied'
  | 'verify_passed'
  | 'verify_failed'
  | 'rollback_completed'
  | 'cancelled';

/**
 * Repo-process command templates injected by the composition root (NEUT-001).
 *
 * The library ships NO default commands: which package manager, verification
 * commands, or CI-like gate a repository uses is the host project's policy.
 * Placeholders: `{scope}` in `packageVerify` templates is replaced with each
 * package scope; `{baseRef}` in the `repoVerify` template is replaced with the
 * plan's base ref.
 */
export interface ISelfHostingCommandTemplates {
  /** Per-scope verification commands, applied to every package scope in order. */
  packageVerify: readonly { name: string; template: string }[];
  /** Optional repo-wide verification gate appended after the per-scope steps. */
  repoVerify?: { description: string; template: string };
}

export interface ISelfHostingVerificationPlanInput {
  changedFiles: readonly string[];
  packageScopes?: readonly string[];
  /** Base git ref to verify against. Required — the library has no repo-specific default. */
  baseRef: string;
  /** Verification command templates. Required — the library has no repo-specific default. */
  commandTemplates: ISelfHostingCommandTemplates;
}

export interface ISelfHostingVerificationStep {
  id: string;
  phase: TSelfHostingVerificationPhase;
  description: string;
  required: boolean;
  command?: string;
}

export interface ISelfHostingVerificationPlan {
  changedFiles: readonly string[];
  packageScopes: readonly string[];
  baseRef: string;
  steps: readonly ISelfHostingVerificationStep[];
}

const TRANSITIONS: Record<
  TSelfHostingLoopState,
  Partial<Record<TSelfHostingLoopEvent, TSelfHostingLoopState>>
> = {
  idle: {
    checkpoint_created: 'checkpointed',
    cancelled: 'cancelled',
  },
  checkpointed: {
    edits_started: 'editing',
    cancelled: 'cancelled',
  },
  editing: {
    edits_applied: 'verifying',
    verify_failed: 'failed',
    cancelled: 'cancelled',
  },
  verifying: {
    verify_passed: 'passed',
    verify_failed: 'failed',
    cancelled: 'cancelled',
  },
  passed: {},
  failed: {
    rollback_completed: 'rolled_back',
    cancelled: 'cancelled',
  },
  rolled_back: {},
  cancelled: {},
};

function normalizePackageScopes(packageScopes: readonly string[] | undefined): readonly string[] {
  if (!packageScopes) {
    return [];
  }
  return Array.from(new Set(packageScopes.map((scope) => scope.trim()).filter(Boolean)));
}

function packageVerificationSteps(
  packageScopes: readonly string[],
  commandTemplates: ISelfHostingCommandTemplates,
): ISelfHostingVerificationStep[] {
  return packageScopes.flatMap((scope) =>
    commandTemplates.packageVerify.map(({ name, template }): ISelfHostingVerificationStep => ({
      id: `package-${name}:${scope}`,
      phase: 'verify',
      description: `Run ${name} for ${scope} in a child process against the new on-disk tree.`,
      required: true,
      command: template.replaceAll('{scope}', scope),
    })),
  );
}

function preVerificationSteps(): ISelfHostingVerificationStep[] {
  return [
    {
      id: 'checkpoint',
      phase: 'checkpoint',
      description: 'Create a recoverable turn-level checkpoint before the first mutation.',
      required: true,
    },
    {
      id: 'atomic-edit',
      phase: 'edit',
      description:
        'Apply Write/Edit mutations through same-directory temp files and atomic rename.',
      required: true,
    },
    {
      id: 'handoff',
      phase: 'handoff',
      description:
        'Keep the current process on already-loaded code and run verification child processes against disk.',
      required: true,
    },
  ];
}

function repoVerificationStep(
  baseRef: string,
  repoVerify: NonNullable<ISelfHostingCommandTemplates['repoVerify']>,
): ISelfHostingVerificationStep {
  return {
    id: 'repo-verify',
    phase: 'verify',
    description: repoVerify.description,
    required: true,
    command: repoVerify.template.replaceAll('{baseRef}', baseRef),
  };
}

function rollbackRecoveryStep(): ISelfHostingVerificationStep {
  return {
    id: 'rollback-on-failure',
    phase: 'recover',
    description: 'Use the existing edit checkpoint restore path if verification fails.',
    required: true,
  };
}

export function planSelfHostingVerification(
  input: ISelfHostingVerificationPlanInput,
): ISelfHostingVerificationPlan {
  if (input.changedFiles.length === 0) {
    throw new Error('Self-hosting verification requires at least one changed file.');
  }

  const { baseRef, commandTemplates } = input;
  const packageScopes = normalizePackageScopes(input.packageScopes);
  const steps: ISelfHostingVerificationStep[] = [
    ...preVerificationSteps(),
    ...packageVerificationSteps(packageScopes, commandTemplates),
    ...(commandTemplates.repoVerify
      ? [repoVerificationStep(baseRef, commandTemplates.repoVerify)]
      : []),
    rollbackRecoveryStep(),
  ];

  return {
    changedFiles: [...input.changedFiles],
    packageScopes,
    baseRef,
    steps,
  };
}

export function transitionSelfHostingLoop(
  state: TSelfHostingLoopState,
  event: TSelfHostingLoopEvent,
): TSelfHostingLoopState {
  const nextState = TRANSITIONS[state][event];
  if (!nextState) {
    throw new Error(`Invalid self-hosting loop transition: ${state} -> ${event}`);
  }
  return nextState;
}
