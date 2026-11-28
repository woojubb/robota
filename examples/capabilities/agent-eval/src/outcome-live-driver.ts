import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import {
  countLeaksInPath,
  countLeaksInTexts,
  holdCredential,
  readCredentialLine,
  redactSecret,
  type ICredential,
} from './outcome-coding-credential.js';
import { createLedgerGate } from './outcome-coding-gate.js';
import {
  catalogListsModel,
  checkCredits,
  createGatewayUpstream,
  fetchEndpointListing,
  type IGatewayLocation,
  lookupGeneration,
} from './outcome-coding-gateway.js';
import {
  DEFAULT_TEMPLATE_ALLOWANCE_TOKENS,
  LedgerError,
  SpendLedger,
  type ILedgerHeader,
  type ILedgerState,
} from './outcome-coding-ledger.js';
import {
  basisCovers,
  maxCallCostMicros,
  parseEndpointListing,
  parseReceipt,
  type IRates,
} from './outcome-coding-pricing.js';
import type { TJson, TJsonObject } from './outcome-coding-protocol.js';
import {
  createScriptedUpstream,
  type IRelayGate,
  type IScriptedStep,
} from './outcome-coding-relay.js';
import { BASELINE_SETTINGS } from './outcome-coding-settings.js';
import { CODING_TASKS, type ICodingTask } from './outcome-coding-tasks.js';
import { ALL_CODING_TASKS } from './outcome-coding-tasks-repository.js';
import {
  MAX_BODY_BYTES,
  runTrial,
  type ILaunchInput,
  type ITrialRecord,
  type ITrialSpec,
  type IWorkerLaunch,
} from './outcome-coding-trial.js';
import type { ICodingObservation } from './outcome-coding-verify.js';
import { COUNTED_TRIALS_PER_TASK, type TArm } from './outcome-live-decision.js';
import type { IFakeGateway } from './outcome-live-gateway-fake.js';
import {
  assertCredentialPath,
  assertEvidencePath,
  type IPathPolicy,
} from './outcome-live-paths.js';
import {
  classifyTrial,
  danglingStarts,
  nextTrial,
  planSlots,
  slotKey,
  summarizeRun,
  trialIdOf,
  type IHalt,
  type IRunSummary,
  type ISlot,
  type ITrialEnd,
  type THaltKind,
  type TDriverEvent,
} from './outcome-live-plan.js';

/**
 * The paid-run driver: ties the ledger, the gateway client, the credential reader, the trial
 * runner and the delegation arm into one run, in the order the plan fixes, and writes everything a
 * report needs into an evidence folder outside the repository. This module makes no choice about
 * where a model or an endpoint lives (both arrive in the configuration) and never writes the
 * credential anywhere; the only place its value is used is the upstream client the relay calls.
 */

/** A configuration the driver refuses before touching anything. */
export class DriverConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DriverConfigError';
  }
}

export interface IDriverConfig {
  readonly arms: readonly TArm[];
  /** Most calls one trial may make, equal for both arms. */
  readonly trialCap: number;
  /** Most calls the whole run may make; written into the ledger header. */
  readonly callCap: number;
  readonly ceilingMicros: number;
  /** Durable folder for the ledger, observations and summary; outside the repository. */
  readonly evidenceDir: string;
  readonly credentialFile?: string;
  readonly credentialName?: string;
  readonly model: string;
  /** The chat-completions URL the relay may name. */
  readonly endpoint: string;
  /** The provider route the ledger pins; every receipt must name it. */
  readonly provider: string;
  readonly routeOptions?: TJsonObject;
  /** Basis rates chosen by the caller; they must cover the listing. Default: the listing's highest. */
  readonly basis?: IRates;
  /** The posted decision rule's comment, fixed before the first call; required for a real run. */
  readonly decisionRuleUrl?: string;
  readonly resume: boolean;
  readonly reconcile: boolean;
  readonly dryRun: boolean;
  /** Host directory the container daemon can mount; the trials' working directory is made in it. */
  readonly baseDir: string;
  readonly deadlineMs?: number;
}

export interface IDockerSnapshot {
  readonly containers: readonly string[];
  readonly images: readonly string[];
  readonly networks: readonly string[];
  readonly volumes: readonly string[];
}

export interface IDockerOps {
  available(): boolean;
  /** Identifiers of the containers (the harness's own), images, networks and volumes now present. */
  snapshot(): IDockerSnapshot;
}

/** What a trial needs to run: the launcher, the independent verifier, and the way to clean up. */
export interface IRuntime {
  /** The commit the worker image was built from; pinned in the ledger header. */
  readonly commit: string;
  readonly launch: (input: ILaunchInput) => IWorkerLaunch;
  readonly verify: (task: ICodingTask, tree: string) => Promise<ICodingObservation>;
  dispose(): Promise<void> | void;
}

export interface IDriverDeps {
  /** The example's directory, used to find the repository for the path guard. */
  readonly exampleDir: string;
  /** Tests may keep evidence under the temporary directory; a real run may not. */
  readonly allowTemporaryPaths: boolean;
  readonly docker: IDockerOps;
  prepareRuntime(context: { readonly workDir: string }): Promise<IRuntime>;
  /** Replaces the trial runner (tests); the default is the real one. */
  readonly runTrial?: (spec: ITrialSpec) => Promise<ITrialRecord>;
  /** Test hook: fewer tasks or trials than the rule's six tasks and three trials. */
  readonly plan?: { readonly tasks?: readonly ICodingTask[]; readonly trialsPerTask?: number };
  /** Dry run: the loopback gateway and the scripted replies each trial gets (no upstream call). */
  readonly dryRun?: {
    readonly gateway: IFakeGateway;
    replyFor(task: ICodingTask, arm: TArm, projectDir: string): readonly IScriptedStep[];
  };
  readonly log?: (line: string) => void;
}

export interface IPreflightCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly detail?: Readonly<Record<string, unknown>>;
}

export interface ICleanupCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly detail?: Readonly<Record<string, unknown>>;
}

export interface IDriverSummary extends IRunSummary {
  readonly config: Readonly<Record<string, unknown>>;
  readonly commit: string | null;
  readonly preflight: readonly IPreflightCheck[];
  readonly ledger: Readonly<Record<string, unknown>> | null;
  /** The total bound against the approved ceiling. */
  readonly bound: Readonly<Record<string, unknown>> | null;
  readonly reconciled: readonly { readonly id: number; readonly reason: string }[];
  readonly cleanup: readonly ICleanupCheck[];
  /** How many times the credential value appears in the evidence folder; never the value. */
  readonly leakScan: {
    readonly leaks: number;
    readonly filesScanned: number;
    readonly unreadable: number;
  } | null;
  readonly halt: IHalt | null;
}

export interface IDriverResult {
  readonly exitCode: 0 | 1;
  readonly summary: IDriverSummary;
  readonly summaryPath: string;
}

const EVENTS_FILE = 'events.jsonl';
const LEDGER_FILE = 'ledger.jsonl';
const PREFLIGHT_FILE = 'preflight.json';
const SUMMARY_FILE = 'summary.json';
const OBSERVATIONS_DIR = 'observations';
const CHAT_SUFFIX = '/chat/completions';
const DECISION_RULE = /^https:\/\/[^\s#]+#issuecomment-(\d+)$/;
const WORK_PREFIXES = ['.coding-trial-', '.coding-live-'];

/** A short description for a refused configuration, never including a credential. */
function validateConfig(config: IDriverConfig): void {
  const fail = (message: string): never => {
    throw new DriverConfigError(message);
  };
  if (
    config.arms.length === 0 ||
    config.arms.some((arm) => arm !== 'delegation' && arm !== 'control')
  ) {
    fail('The arms must be delegation, or delegation and control');
  }
  if (!config.arms.includes('delegation')) fail('The delegation arm is required');
  if (new Set(config.arms).size !== config.arms.length) fail('An arm is listed twice');
  const positive = (value: number, name: string): void => {
    if (!Number.isSafeInteger(value) || value <= 0) fail(`The ${name} must be a positive integer`);
  };
  positive(config.trialCap, 'trial cap');
  positive(config.callCap, 'call cap');
  positive(config.ceilingMicros, 'ceiling');
  if (config.model.trim() === '') fail('The model is required');
  if (config.provider.trim() === '') fail('The provider route is required');
  if (!config.endpoint.endsWith(CHAT_SUFFIX)) {
    fail(`The endpoint must end with ${CHAT_SUFFIX}`);
  }
  if (config.reconcile && !config.resume) fail('--reconcile only applies with --resume');
  if (!config.dryRun) {
    if (config.decisionRuleUrl === undefined || !DECISION_RULE.test(config.decisionRuleUrl)) {
      fail(
        'A real run needs --decision-rule with the URL of the posted rule comment (ending in #issuecomment-<id>), so the rule is fixed before the first call',
      );
    }
    if (config.credentialFile === undefined || config.credentialName === undefined) {
      fail('A real run needs --credential-file and --credential-name');
    }
  }
  if ((config.credentialFile === undefined) !== (config.credentialName === undefined)) {
    fail('--credential-file and --credential-name go together');
  }
}

/** Per-trial bookkeeping the gate keeps: what the receipts cost and which calls had none. */
interface ITally {
  admitted: number;
  costMicros: number;
  withoutReceipt: number;
  readonly refusals: string[];
}

/** The generation id a chat reply carries: `generationId`, else `id`. */
function generationIdOf(body: TJson): string | undefined {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return undefined;
  const { generationId, id } = body as TJsonObject;
  if (typeof generationId === 'string') return generationId;
  return typeof id === 'string' ? id : undefined;
}

function tallyGate(
  inner: IRelayGate,
  tally: ITally,
  ledger: SpendLedger,
  records: ReadonlyMap<string, TJsonObject>,
): IRelayGate {
  return {
    admit(request) {
      const admission = inner.admit(request);
      if (!admission.ok) {
        tally.refusals.push(admission.detail);
        // A refused admission stops the run at once, in the ledger too.
        ledger.stop(`admission refused: ${admission.detail}`);
        return admission;
      }
      tally.admitted += 1;
      return {
        ok: true,
        async settle(answer) {
          const verdict = await admission.settle(answer);
          const id = answer === undefined ? undefined : generationIdOf(answer.body);
          const receipt =
            answer === undefined
              ? undefined
              : parseReceipt(answer.body, id === undefined ? undefined : records.get(id));
          const usable =
            answer !== undefined &&
            answer.status >= 200 &&
            answer.status < 300 &&
            receipt?.costMicros !== undefined;
          if (usable) tally.costMicros += receipt.costMicros as number;
          else tally.withoutReceipt += 1;
          return verdict;
        },
      };
    },
  };
}

function readEvents(path: string): TDriverEvent[] {
  if (!existsSync(path)) return [];
  const events: TDriverEvent[] = [];
  const lines = readFileSync(path, 'utf8').split('\n');
  for (const [index, line] of lines.entries()) {
    if (line === '') continue;
    try {
      events.push(JSON.parse(line) as TDriverEvent);
    } catch {
      throw new DriverConfigError(`The events file has an unreadable line ${index + 1}`);
    }
  }
  return events;
}

function listWorkEntries(baseDir: string): string[] {
  try {
    return readdirSync(baseDir).filter((name) => WORK_PREFIXES.some((p) => name.startsWith(p)));
  } catch {
    return [];
  }
}

const added = (before: readonly string[], after: readonly string[]): string[] =>
  after.filter((item) => !before.includes(item));

export interface ICleanupInput {
  readonly before: IDockerSnapshot;
  readonly after: IDockerSnapshot;
  readonly workDir: string | undefined;
  readonly baseDir: string;
  readonly workEntriesBefore: readonly string[];
  readonly secret: string | undefined;
}

/** The end-of-run checks: nothing the run created is still present, and no copy of the credential is. */
export function verifyCleanup(input: ICleanupInput): ICleanupCheck[] {
  const checks: ICleanupCheck[] = [];
  const dockerKinds = ['containers', 'images', 'networks', 'volumes'] as const;
  for (const kind of dockerKinds) {
    const left = added(input.before[kind], input.after[kind]);
    checks.push({
      name: `no ${kind.slice(0, -1)} left behind`,
      ok: left.length === 0,
      detail: {
        added: left,
        ...(kind === 'images'
          ? {
              note: 'the image build does not refresh a base image but pulls one that is missing, so base images must be present before the run',
            }
          : {}),
      },
    });
  }
  const workDirGone = input.workDir === undefined || !existsSync(input.workDir);
  checks.push({ name: 'working directory removed', ok: workDirGone });
  const leftover = added(input.workEntriesBefore, listWorkEntries(input.baseDir));
  checks.push({
    name: 'no trial or working directory left in the base directory',
    ok: leftover.length === 0,
    detail: { count: leftover.length },
  });
  // Scan what could still hold a copy: the working directory and any trial folder left behind.
  const places = [
    ...(input.workDir === undefined ? [] : [input.workDir]),
    ...leftover.map((name) => join(input.baseDir, name)),
  ].filter((place) => existsSync(place));
  const copies =
    input.secret === undefined
      ? 0
      : places.reduce(
          (sum, place) => sum + countLeaksInPath(input.secret as string, place).leaks,
          0,
        );
  checks.push({
    name: 'no credential copy left',
    ok: copies === 0,
    detail: { copies, placesScanned: places.length },
  });
  return checks;
}

function boundOf(ledger: ILedgerState, header: ILedgerHeader): Record<string, unknown> {
  return {
    ceilingMicros: header.ceilingMicros,
    committedMicros: ledger.committedMicros,
    settledMicros: ledger.settledMicros,
    reservedMicros: ledger.reservedMicros,
    remainingMicros: header.ceilingMicros - ledger.committedMicros,
    withinCeiling: ledger.committedMicros <= header.ceilingMicros,
    callsAdmitted: ledger.callsAdmitted,
    callCap: header.callCap,
  };
}

/** Runs the plan. Throws `DriverConfigError` or `PathGuardError` before touching anything for a refused request. */
export async function runDriver(config: IDriverConfig, deps: IDriverDeps): Promise<IDriverResult> {
  const log = deps.log ?? ((): void => undefined);
  const endpoint = deps.dryRun?.gateway.endpoint ?? config.endpoint;
  validateConfig({ ...config, endpoint });
  const policy: IPathPolicy = {
    exampleDir: deps.exampleDir,
    allowTemporary: deps.allowTemporaryPaths,
  };
  const evidenceDir = assertEvidencePath(config.evidenceDir, 'evidence folder', policy);
  const baseDir = assertEvidencePath(config.baseDir, 'working directory', {
    ...policy,
    allowTemporary: true,
  });
  const credentialPath =
    config.credentialFile === undefined
      ? undefined
      : assertCredentialPath(config.credentialFile, policy);
  const ledgerPath = join(evidenceDir, LEDGER_FILE);
  const eventsPath = join(evidenceDir, EVENTS_FILE);
  const ledgerExists = existsSync(ledgerPath);
  if (config.resume && !ledgerExists) {
    throw new DriverConfigError(
      '--resume needs the ledger of the earlier run in the evidence folder',
    );
  }
  if (!config.resume && ledgerExists) {
    throw new DriverConfigError(
      'The evidence folder already holds a ledger; use --resume, or a new folder for a new run',
    );
  }

  // A dry run's ledger and events are never carried on by a real run, and the other way round.
  for (const earlier of readEvents(eventsPath)) {
    if (earlier.type === 'note' && typeof earlier.dryRun === 'boolean') {
      if (earlier.dryRun !== config.dryRun) {
        throw new DriverConfigError(
          `The evidence folder belongs to a ${earlier.dryRun ? 'dry' : 'real'} run; a ${config.dryRun ? 'dry' : 'real'} run cannot use it`,
        );
      }
    }
  }
  if (
    config.resume &&
    !readEvents(eventsPath).some((e) => e.type === 'note' && e.dryRun !== undefined)
  ) {
    throw new DriverConfigError('The evidence folder records no run mode; it cannot be resumed');
  }

  mkdirSync(join(evidenceDir, OBSERVATIONS_DIR), { recursive: true });
  const record = (event: TDriverEvent): void => {
    appendFileSync(eventsPath, `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`);
  };

  const tasks = deps.plan?.tasks ?? ALL_CODING_TASKS;
  const trialsPerTask = deps.plan?.trialsPerTask ?? COUNTED_TRIALS_PER_TASK;
  const taskIds = tasks.map((task) => task.id);
  const sharedIds = new Set(CODING_TASKS.map((task) => task.id));
  const sharedTaskIds = taskIds.filter((id) => sharedIds.has(id));
  const slots: ISlot[] = planSlots({
    arms: config.arms,
    taskIds,
    trialsPerTask,
    smokeTaskId: (tasks[0] as ICodingTask).id,
  });

  const preflight: IPreflightCheck[] = [];
  const reconciled: { id: number; reason: string }[] = [];
  let events: TDriverEvent[] = readEvents(eventsPath);
  let ledger: SpendLedger | undefined;
  let runtime: IRuntime | undefined;
  let workDir: string | undefined;
  let credential: ICredential | undefined;
  const stopped: { halt?: IHalt } = {};
  let commit: string | null = null;
  let dockerBefore: IDockerSnapshot | undefined;
  const workEntriesBefore = listWorkEntries(baseDir);

  const redact = (text: string): string =>
    credential === undefined ? text : redactSecret(credential.reveal(), text);
  const stopRun = (kind: THaltKind, reason: string, trialId?: string): void => {
    const event: IHalt = {
      type: 'halt',
      kind,
      reason,
      ...(ledger === undefined ? {} : { ledger: ledger.state() }),
      ...(trialId === undefined ? {} : { trialId }),
    };
    stopped.halt = event;
    record(event);
    events = [...events, event];
    log(`STOP ${kind}: ${reason}`);
  };
  const check = (
    name: string,
    ok: boolean,
    detail?: Record<string, unknown>,
    kind: THaltKind = 'preflight',
  ): boolean => {
    preflight.push({ name, ok, ...(detail === undefined ? {} : { detail }) });
    log(`${ok ? 'ok  ' : 'FAIL'} ${name}`);
    if (!ok) stopRun(kind, `preflight failed: ${name}`);
    return ok;
  };

  try {
    record({
      type: 'note',
      note: config.resume ? 'resume' : 'start',
      arms: config.arms,
      dryRun: config.dryRun,
    });

    // 1. Preflight, each result recorded in the evidence.
    check('evidence and working paths are outside the repository', true, {
      evidenceOutsideRepository: true,
      temporaryDirectoryRefused: !deps.allowTemporaryPaths,
    });
    if (!config.dryRun) {
      const id = DECISION_RULE.exec(config.decisionRuleUrl as string)?.[1];
      check('decision rule fixed before the first call', true, {
        url: config.decisionRuleUrl,
        commentId: id,
      });
    }
    let ok = check('docker available', deps.docker.available());
    if (ok) {
      if (credentialPath !== undefined) {
        try {
          credential = readCredentialLine(credentialPath, config.credentialName as string);
          ok = check('credential present', true, { credential: 'present' });
        } catch (error) {
          ok = check('credential present', false, {
            reason: error instanceof Error ? error.message : 'unreadable',
          });
        }
      } else {
        credential = holdCredential('dry-run-fake-credential');
        ok = check('credential present', true, { credential: 'fake, dry run' });
      }
    }
    const location: IGatewayLocation = {
      baseUrl: endpoint.slice(0, -CHAT_SUFFIX.length),
      timeoutMs: 15_000,
    };
    if (ok && config.resume) {
      try {
        ledger = SpendLedger.open(ledgerPath);
      } catch (error) {
        ok = check('ledger opens and its chain verifies', false, {
          reason: error instanceof LedgerError ? error.message : 'unreadable',
        });
      }
    }
    let listedRates: IRates | undefined;
    if (ok) {
      try {
        const listed = await catalogListsModel(location, config.model);
        ok = check('catalog lists the pinned model', listed, undefined, 'catalog');
      } catch (error) {
        ok = check(
          'catalog lists the pinned model',
          false,
          { reason: redact(error instanceof Error ? error.message : 'failed') },
          'catalog',
        );
      }
    }
    if (ok) {
      try {
        const listing = parseEndpointListing(
          await fetchEndpointListing(location, config.model),
          config.provider,
        );
        listedRates = listing.rates;
        ok = check('endpoint listing parses', true, {
          listed: listing.rates,
          pricedEntries: listing.pricedEntries,
        });
      } catch (error) {
        ok = check(
          'endpoint listing parses',
          false,
          { reason: redact(error instanceof Error ? error.message : 'failed') },
          'catalog',
        );
      }
    }
    let basis: IRates | undefined;
    if (ok) {
      basis = ledger?.header.basis ?? config.basis ?? listedRates;
      ok = check(
        'ledger basis covers the listed rates',
        basis !== undefined && listedRates !== undefined && basisCovers(basis, listedRates),
        { basis, listed: listedRates },
        'catalog',
      );
    }
    const requiredMicros =
      basis === undefined
        ? 0
        : maxCallCostMicros(basis, {
            requestBytes: MAX_BODY_BYTES,
            templateAllowanceTokens:
              ledger?.header.templateAllowanceTokens ?? DEFAULT_TEMPLATE_ALLOWANCE_TOKENS,
            maxOutputTokens: BASELINE_SETTINGS.maxTokens,
          });
    let creditsError: string | undefined;
    const creditsOk = async (): Promise<boolean> => {
      try {
        const credits = await checkCredits(location, credential as ICredential, requiredMicros);
        return credits.sufficient;
      } catch (error) {
        creditsError = redact(error instanceof Error ? error.message : String(error));
        return false;
      }
    };
    if (ok) {
      creditsError = undefined;
      ok = check(
        'credits cover the next reservation',
        await creditsOk(),
        { requiredMicros, ...(creditsError === undefined ? {} : { error: creditsError }) },
        'credits',
      );
    }
    if (ok) {
      dockerBefore = deps.docker.snapshot();
      workDir = mkdtempSync(join(baseDir, '.coding-live-'));
      chmodSync(workDir, 0o755);
      try {
        runtime = await deps.prepareRuntime({ workDir });
        commit = runtime.commit;
        ok = check('worker image built and free of solutions and verifiers', true, { commit });
      } catch (error) {
        ok = check('worker image built and free of solutions and verifiers', false, {
          reason: redact(error instanceof Error ? error.message : 'failed'),
        });
      }
    }

    // 2. The ledger: created fresh with a header that cannot change, or opened and resumed.
    if (ok) {
      const expected: ILedgerHeader = {
        ceilingMicros: config.ceilingMicros,
        callCap: config.callCap,
        basis: basis as IRates,
        commit: runtime?.commit as string,
        route: { provider: config.provider, model: config.model },
        maxOutputTokens: BASELINE_SETTINGS.maxTokens,
        templateAllowanceTokens: DEFAULT_TEMPLATE_ALLOWANCE_TOKENS,
      };
      try {
        if (ledger === undefined) {
          ledger = SpendLedger.create(ledgerPath, expected);
        } else {
          const have = ledger.header;
          const same =
            have.ceilingMicros === expected.ceilingMicros &&
            have.callCap === expected.callCap &&
            have.commit === expected.commit &&
            have.route.provider === expected.route.provider &&
            have.route.model === expected.route.model &&
            have.maxOutputTokens === expected.maxOutputTokens;
          if (!same) {
            ok = check('ledger header matches this run', false, undefined);
          }
        }
      } catch (error) {
        ok = check('ledger created', false, {
          reason: error instanceof LedgerError ? error.message : 'failed',
        });
      }
    }
    if (ok && config.resume && ledger !== undefined) {
      const unsettled = ledger.state().unsettledIds;
      if (unsettled.length > 0 && !config.reconcile) {
        ok = check('no unsettled ledger entries', false, { unsettled });
      } else {
        for (const id of unsettled) {
          const reason = 'reconciled at its reservation by --reconcile';
          ledger.reconcile(id, { reason });
          reconciled.push({ id, reason });
          record({ type: 'note', note: 'reconcile', id, reason });
        }
        if (ledger.state().stopReason !== undefined) ledger.resume('resumed by --resume');
        // A trial that never ended was cut off in the middle: an infrastructure stop.
        for (const start of danglingStarts(events)) {
          const slot = slots.find((candidate) => slotKey(candidate) === start.slotKey);
          if (slot === undefined) continue;
          const end: ITrialEnd = {
            type: 'trial-end',
            trialId: start.trialId,
            slotKey: start.slotKey,
            kind: slot.kind,
            arm: slot.arm,
            taskId: slot.taskId,
            round: slot.round,
            attempt: start.attempt,
            outcome: 'infra-stop',
            stopKind: 'interrupted',
            stopReason: 'the process ended before the trial did',
            failures: [],
            costMicros: 0,
            callsAdmitted: 0,
            callsWithoutReceipt: 0,
            wallMs: 0,
            upstreamAttempts: 0,
            capReached: false,
            ledger: ledger.state(),
          };
          record(end);
          events = [...events, end];
        }
        ok = check('ledger resumed', true, { reconciled: reconciled.length });
      }
    }
    writeFileSync(join(evidenceDir, PREFLIGHT_FILE), `${JSON.stringify(preflight, null, 2)}\n`);

    // 3. The trials, in order; any stop ends the run here.
    if (ok && ledger !== undefined && runtime !== undefined && workDir !== undefined) {
      const run = deps.runTrial ?? runTrial;
      const upstream = createGatewayUpstream({ endpoint, credential: credential as ICredential });
      const records = new Map<string, TJsonObject>();
      const baseGate = createLedgerGate(ledger, async (body) => {
        const id = generationIdOf(body);
        if (id === undefined) return undefined;
        const record = await lookupGeneration(location, credential as ICredential, id);
        if (record !== undefined) records.set(id, record);
        return record;
      });
      let first = true;
      for (;;) {
        const next = nextTrial(slots, events);
        if (next === undefined) break;
        if (!first && !(await creditsOk())) {
          stopRun('credits', 'the credits no longer cover the next reservation');
          break;
        }
        first = false;
        const { slot, attempt } = next;
        const task = tasks.find((candidate) => candidate.id === slot.taskId) as ICodingTask;
        const trialId = trialIdOf(slot, attempt);
        const started = Date.now();
        record({
          type: 'trial-start',
          trialId,
          slotKey: slotKey(slot),
          attempt,
          at: new Date(started).toISOString(),
        });
        log(`trial ${trialId}`);
        const tally: ITally = { admitted: 0, costMicros: 0, withoutReceipt: 0, refusals: [] };
        const activeRuntime = runtime;
        const spec: ITrialSpec = {
          task,
          model: config.model,
          endpoint,
          ...(config.routeOptions === undefined ? {} : { routeOptions: config.routeOptions }),
          upstream,
          gate: tallyGate(baseGate, tally, ledger as SpendLedger, records),
          launch: (input) => {
            const launched = activeRuntime.launch(input);
            if (deps.dryRun !== undefined) {
              deps.dryRun.gateway.source = createScriptedUpstream(
                deps.dryRun.replyFor(task, slot.arm, launched.paths.projectDir),
              );
            }
            return launched;
          },
          verify: activeRuntime.verify,
          baseDir: workDir,
          ...(config.deadlineMs === undefined ? {} : { deadlineMs: config.deadlineMs }),
          maxCalls: config.trialCap,
          ...(slot.arm === 'delegation' ? { delegation: {} } : {}),
          evidenceFile: join(evidenceDir, OBSERVATIONS_DIR, `${trialId}.json`),
          trialName: `robota-eval-live-${trialId}-${process.pid}`,
        };
        let trialRecord: ITrialRecord | undefined;
        let thrown: string | undefined;
        try {
          trialRecord = await run(spec);
        } catch (error) {
          thrown = redact(error instanceof Error ? error.message : String(error));
        }
        const verdict = classifyTrial({
          ...(thrown === undefined ? {} : { thrown }),
          ...(trialRecord === undefined ? {} : { record: trialRecord }),
          admissionRefusals: tally.refusals,
        });
        const end: ITrialEnd = {
          type: 'trial-end',
          trialId,
          slotKey: slotKey(slot),
          kind: slot.kind,
          arm: slot.arm,
          taskId: slot.taskId,
          round: slot.round,
          attempt,
          outcome: verdict.outcome,
          failures: trialRecord?.score.failures ?? [],
          ...(verdict.stopKind === undefined ? {} : { stopKind: verdict.stopKind }),
          ...(verdict.reason === undefined ? {} : { stopReason: redact(verdict.reason) }),
          costMicros: tally.costMicros,
          callsAdmitted: tally.admitted,
          callsWithoutReceipt: tally.withoutReceipt,
          wallMs: trialRecord?.measures.wallMs ?? Date.now() - started,
          upstreamAttempts: trialRecord?.upstreamAttempts ?? 0,
          capReached: trialRecord?.capReached ?? false,
          ...(trialRecord === undefined ? {} : { measures: trialRecord.measures }),
          ...(trialRecord === undefined ? {} : { diagnostics: trialRecord.diagnostics }),
          ...(thrown === undefined ? {} : { error: thrown }),
          ...(trialRecord?.cleanupError === undefined
            ? {}
            : { cleanupError: trialRecord.cleanupError }),
          ledger: ledger.state(),
        };
        record(end);
        events = [...events, end];
        if (verdict.halt !== undefined) {
          stopRun(verdict.halt, verdict.reason ?? 'the trial was stopped', trialId);
          break;
        }
      }
    }
  } catch (error) {
    // Anything unforeseen ends the run like a stop; cleanup and the summary still happen.
    stopRun('internal', redact(error instanceof Error ? error.message : String(error)));
  }

  // 4. Cleanup and the summary: always, whatever stopped the run.

  const ledgerState = ledger?.state() ?? null;
  const ledgerHeader = ledger?.header ?? null;
  ledger?.close();
  let disposeError: string | undefined;
  try {
    await runtime?.dispose();
  } catch (error) {
    disposeError = error instanceof Error ? error.message : String(error);
  }
  if (workDir !== undefined) rmSync(workDir, { recursive: true, force: true });
  const secret = credential?.reveal();
  const cleanup: ICleanupCheck[] =
    dockerBefore === undefined
      ? []
      : verifyCleanup({
          before: dockerBefore,
          after: deps.docker.snapshot(),
          workDir,
          baseDir,
          workEntriesBefore,
          secret,
        });
  if (disposeError !== undefined) {
    cleanup.push({ name: 'runtime disposed', ok: false, detail: { reason: redact(disposeError) } });
  }

  const run = summarizeRun({ arms: config.arms, taskIds, sharedTaskIds, slots, events });
  const draft: IDriverSummary = {
    ...run,
    config: {
      arms: config.arms,
      trialCap: config.trialCap,
      callCap: config.callCap,
      ceilingMicros: config.ceilingMicros,
      model: config.model,
      provider: config.provider,
      endpoint,
      decisionRuleUrl: config.decisionRuleUrl ?? null,
      dryRun: config.dryRun,
      resume: config.resume,
      tasks: taskIds,
      trialsPerTask,
      credential: credential === undefined ? 'absent' : 'present',
    },
    commit,
    preflight,
    ledger:
      ledgerState === null || ledgerHeader === null
        ? null
        : { header: ledgerHeader, state: ledgerState },
    bound:
      ledgerState === null || ledgerHeader === null ? null : boundOf(ledgerState, ledgerHeader),
    reconciled,
    cleanup,
    leakScan: null,
    halt: stopped.halt ?? null,
  };
  // The leak scan covers the whole evidence folder and the summary text itself, and reports a count.
  let leakScan: IDriverSummary['leakScan'] = null;
  if (secret !== undefined) {
    const folder = countLeaksInPath(secret, evidenceDir);
    const own = countLeaksInTexts(secret, [JSON.stringify(draft)]);
    leakScan = {
      leaks: folder.leaks + own,
      filesScanned: folder.filesScanned,
      unreadable: folder.unreadable,
    };
  }
  const summary: IDriverSummary = { ...draft, leakScan };
  const summaryPath = join(evidenceDir, SUMMARY_FILE);
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  const clean =
    stopped.halt === undefined &&
    summary.finished &&
    cleanup.every((entry) => entry.ok) &&
    (leakScan === null || leakScan.leaks === 0);
  return { exitCode: clean ? 0 : 1, summary, summaryPath };
}
