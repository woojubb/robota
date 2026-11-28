import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CODING_TASKS, type ICodingTask } from './outcome-coding-tasks.js';
import type { ITrialRecord, ITrialSpec } from './outcome-coding-trial.js';
import { measureTrial } from './outcome-delegation-measures.js';
import type {
  IDockerOps,
  IDockerSnapshot,
  IDriverConfig,
  IDriverDeps,
  IRuntime,
} from './outcome-live-driver.js';
import { startFakeGateway, type IFakeGateway } from './outcome-live-gateway-fake.js';

/** Shared fixtures for the driver's tests: a loopback gateway, a fake credential file, stub trials. */

export const SECRET = 'fake-key-live-driver-0123456789';
export const MODEL = 'pinned-model';
export const PROVIDER = 'route-a';
export const CREDENTIAL_NAME = 'GATEWAY_KEY';
export const RULE_URL = 'https://example.test/owner/repo/issues/1#issuecomment-123456';
const exampleDir = join(dirname(fileURLToPath(import.meta.url)), '..');

export interface IHarness {
  readonly dir: string;
  readonly evidence: string;
  readonly base: string;
  readonly credentialFile: string;
  readonly gateway: IFakeGateway;
  readonly docker: { leftover: boolean } & IDockerOps;
  config(patch?: Partial<IDriverConfig>): IDriverConfig;
  deps(patch?: Partial<IDriverDeps>): IDriverDeps;
  close(): Promise<void>;
}

const EMPTY_SNAPSHOT: IDockerSnapshot = {
  containers: [],
  images: ['image-a'],
  networks: ['network-a'],
  volumes: [],
};

export async function makeHarness(
  options: { credentialText?: string; tasks?: readonly ICodingTask[] } = {},
): Promise<IHarness> {
  const gateway = await startFakeGateway({ model: MODEL, provider: PROVIDER });
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'live-driver-test-'));
  const base = join(dir, 'base');
  mkdirSync(base);
  const credentialFile = join(dir, 'credentials.txt');
  writeFileSync(
    credentialFile,
    options.credentialText ?? `OTHER=do-not-keep\n${CREDENTIAL_NAME}=${SECRET}\n`,
    { mode: 0o600 },
  );
  let snapshots = 0;
  const docker = {
    leftover: false,
    available: () => true,
    snapshot: (): IDockerSnapshot => {
      snapshots += 1;
      return snapshots > 1 && docker.leftover
        ? { ...EMPTY_SNAPSHOT, containers: ['leftover-container'] }
        : EMPTY_SNAPSHOT;
    },
  };
  const runtime: IRuntime = {
    commit: 'abc123',
    launch: () => {
      throw new Error('the stub trial runner never launches a worker');
    },
    verify: async () => {
      throw new Error('the stub trial runner never verifies');
    },
    dispose: () => undefined,
  };
  const tasks = options.tasks ?? CODING_TASKS.slice(0, 2);
  return {
    dir,
    evidence: join(dir, 'evidence'),
    base,
    credentialFile,
    gateway,
    docker,
    config: (patch = {}) => ({
      arms: ['delegation', 'control'],
      trialCap: 20,
      callCap: 400,
      ceilingMicros: 2_000_000,
      evidenceDir: join(dir, 'evidence'),
      credentialFile,
      credentialName: CREDENTIAL_NAME,
      model: MODEL,
      endpoint: gateway.endpoint,
      provider: PROVIDER,
      decisionRuleUrl: RULE_URL,
      resume: false,
      reconcile: false,
      dryRun: false,
      baseDir: base,
      ...patch,
    }),
    deps: (patch = {}) => ({
      exampleDir,
      allowTemporaryPaths: true,
      docker,
      prepareRuntime: async () => runtime,
      plan: { tasks, trialsPerTask: 3 },
      ...patch,
    }),
    close: async () => {
      await gateway.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export interface ICallScript {
  /** Cost in dollars the receipt reports. */
  readonly cost?: number;
  readonly provider?: string;
  readonly model?: string;
  /** The call gets no answer at all. */
  readonly noAnswer?: boolean;
  readonly status?: number;
}

export interface ITrialScript {
  readonly calls?: readonly ICallScript[];
  /** The trial throws before it writes an observation (a container or verifier error). */
  readonly throws?: string;
  /** Scoring failures; none means the trial passes. */
  readonly failures?: readonly string[];
  readonly capReached?: boolean;
  readonly wallMs?: number;
  /** A relay stop that is not the spend gate's, for example an unattributed call. */
  readonly relayStop?: string;
  readonly run?: () => void;
}

export interface ISeenTrial {
  readonly trialName: string;
  readonly taskId: string;
  readonly arm: 'delegation' | 'control';
  readonly maxCalls: number | undefined;
  readonly admissions: readonly ('admitted' | string)[];
}

const OBSERVATION = {
  exitCode: 0,
  timedOut: false,
  protectedFilesUnchanged: true,
  changedProtectedFiles: [],
  noUnexpectedFiles: true,
  unexpectedFiles: [],
  noEscapes: true,
  escapes: [],
  manifest: [],
} as const;

/** A trial runner that drives the spend gate with scripted calls and returns a scripted record. */
export function stubTrials(
  scriptFor: (index: number, spec: ITrialSpec) => ITrialScript = () => ({}),
): {
  readonly run: (spec: ITrialSpec) => Promise<ITrialRecord>;
  readonly seen: ISeenTrial[];
} {
  const seen: ISeenTrial[] = [];
  const run = async (spec: ITrialSpec): Promise<ITrialRecord> => {
    const index = seen.length;
    const script = scriptFor(index, spec);
    const admissions: string[] = [];
    seen.push({
      trialName: spec.trialName,
      taskId: spec.task.id,
      arm: spec.delegation === undefined ? 'control' : 'delegation',
      maxCalls: spec.maxCalls,
      admissions,
    });
    script.run?.();
    if (script.throws !== undefined) throw new Error(script.throws);
    const role = spec.delegation === undefined ? 'agent' : 'implementer';
    const log: ITrialRecord['relayLog'][number][] = [];
    let stopReason: string | undefined = script.relayStop;
    let id = 0;
    for (const call of script.calls ?? []) {
      if (stopReason !== undefined) break;
      id += 1;
      const gate = spec.gate as NonNullable<typeof spec.gate>;
      const admission = gate.admit({ id, encoded: 'x', bytes: 200, body: { max_tokens: 8192 } });
      if (!admission.ok) {
        admissions.push(admission.detail);
        log.push({
          id,
          outcome: 'refused',
          code: 'admission',
          status: 403,
          requestBytes: 0,
          upstreamAttempts: 0,
          role,
        });
        break;
      }
      admissions.push('admitted');
      const answer = call.noAnswer
        ? undefined
        : {
            status: call.status ?? 200,
            body: {
              model: call.model ?? spec.model,
              provider: call.provider ?? PROVIDER,
              usage: { cost: call.cost ?? 0.001, prompt_tokens: 10, completion_tokens: 5 },
            },
          };
      const verdict = admission.settle(answer);
      log.push({
        id,
        outcome: verdict.stop === undefined ? 'forwarded' : 'stopped',
        status: answer?.status ?? 502,
        requestBytes: 200,
        upstreamAttempts: 1,
        role,
        latencyMs: 5,
        promptTokens: 10,
        completionTokens: 5,
      });
      if (verdict.stop !== undefined) stopReason = verdict.stop;
    }
    const failures = [...(script.failures ?? [])];
    const wallMs = script.wallMs ?? 100;
    return {
      taskId: spec.task.id,
      report: { completed: true, interrupted: false, toolCalls: 1 },
      score: { passed: failures.length === 0, failures },
      observation: { taskId: spec.task.id, ...OBSERVATION },
      result: undefined,
      relayLog: log,
      upstreamAttempts: log.filter((entry) => entry.upstreamAttempts === 1).length,
      capReached: script.capReached ?? false,
      measures: measureTrial(log, undefined, wallMs),
      ...(stopReason === undefined ? {} : { stopReason }),
      elapsedMs: wallMs,
      diagnostics: [],
    };
  };
  return { run, seen };
}
