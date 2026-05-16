export type TSelfHostingVerificationPhase =
  | 'checkpoint'
  | 'edit'
  | 'handoff'
  | 'verify'
  | 'recover';

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

export interface ISelfHostingVerificationPlanInput {
  changedFiles: readonly string[];
  packageScopes?: readonly string[];
  baseRef?: string;
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

const DEFAULT_BASE_REF = 'origin/develop';
const PACKAGE_VERIFY_COMMANDS = ['test', 'typecheck', 'build'] as const;

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
): ISelfHostingVerificationStep[] {
  return packageScopes.flatMap((scope) =>
    PACKAGE_VERIFY_COMMANDS.map(
      (commandName): ISelfHostingVerificationStep => ({
        id: `package-${commandName}:${scope}`,
        phase: 'verify',
        description: `Run ${commandName} for ${scope} in a child process against the new on-disk tree.`,
        required: true,
        command: `pnpm --filter ${scope} ${commandName}`,
      }),
    ),
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

function harnessVerificationStep(baseRef: string): ISelfHostingVerificationStep {
  return {
    id: 'harness-verify',
    phase: 'verify',
    description: 'Run Robota harness verification as the local CI-like gate.',
    required: true,
    command: `pnpm harness:verify -- --base-ref ${baseRef} --skip-record-check`,
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

  const baseRef = input.baseRef ?? DEFAULT_BASE_REF;
  const packageScopes = normalizePackageScopes(input.packageScopes);
  const steps: ISelfHostingVerificationStep[] = [
    ...preVerificationSteps(),
    ...packageVerificationSteps(packageScopes),
    harnessVerificationStep(baseRef),
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
