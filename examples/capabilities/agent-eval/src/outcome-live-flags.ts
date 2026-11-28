import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { parseMicros } from './outcome-coding-pricing.js';
import type { TJsonObject } from './outcome-coding-protocol.js';
import { DriverConfigError, type IDriverConfig } from './outcome-live-driver.js';
import type { TArm } from './outcome-live-decision.js';

/** Defaults a dry run fills in, because it talks to the loopback gateway and not to a configured one. */
export const DRY_RUN_MODEL = 'dry-run-model';
export const DRY_RUN_PROVIDER = 'dry-run-route';

export interface IBuildFlags {
  readonly source: string;
  readonly revision: string;
  readonly nodeImage: string;
  readonly verifierImage: string;
}

export interface IParsedFlags {
  readonly config: IDriverConfig;
  readonly build: IBuildFlags;
}

const OPTIONS = {
  arms: { type: 'string' },
  'trial-cap': { type: 'string' },
  'call-cap': { type: 'string' },
  'ceiling-usd': { type: 'string' },
  evidence: { type: 'string' },
  'credential-file': { type: 'string' },
  'credential-name': { type: 'string' },
  'decision-rule': { type: 'string' },
  model: { type: 'string' },
  endpoint: { type: 'string' },
  provider: { type: 'string' },
  'route-options': { type: 'string' },
  'basis-prompt-usd-per-million': { type: 'string' },
  'basis-completion-usd-per-million': { type: 'string' },
  resume: { type: 'boolean', default: false },
  reconcile: { type: 'boolean', default: false },
  'dry-run': { type: 'boolean', default: false },
  source: { type: 'string' },
  revision: { type: 'string', default: 'HEAD' },
  'node-image': { type: 'string', default: 'node:22-bookworm-slim' },
  'verifier-image': { type: 'string' },
  base: { type: 'string', default: homedir() },
} as const;

function integer(value: string | undefined, name: string): number {
  if (value === undefined || !/^[1-9][0-9]*$/.test(value)) {
    throw new DriverConfigError(`--${name} must be a positive integer`);
  }
  return Number(value);
}

function arms(value: string | undefined): TArm[] {
  if (value === undefined) throw new DriverConfigError('--arms is required');
  const list = value.split(',').map((part) => part.trim());
  const valid = list.every((arm) => arm === 'delegation' || arm === 'control');
  if (!valid || list.length === 0) {
    throw new DriverConfigError('--arms is delegation, or delegation,control');
  }
  return list as TArm[];
}

function ratePerMillion(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  // Dollars per million tokens is micro-dollars per million tokens times 1e-6: parse as a dollar amount.
  const micros = parseMicros(value);
  if (micros === undefined || micros === 0) {
    throw new DriverConfigError(`--${name} must be a positive dollar amount per million tokens`);
  }
  return micros;
}

function routeOptions(value: string | undefined): TJsonObject | undefined {
  if (value === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as TJsonObject;
    }
  } catch {
    // fall through to the refusal below
  }
  throw new DriverConfigError('--route-options must be a JSON object');
}

/** Turns command-line arguments into a driver configuration, refusing anything missing or malformed. */
export function parseDriverFlags(argv: readonly string[], defaultSource: string): IParsedFlags {
  const { values } = parseArgs({ args: [...argv], options: OPTIONS, allowPositionals: false });
  const dryRun = values['dry-run'] === true;
  const ceiling =
    values['ceiling-usd'] === undefined ? undefined : parseMicros(values['ceiling-usd'], 'down');
  if (ceiling === undefined || ceiling === 0) {
    throw new DriverConfigError('--ceiling-usd must be a positive dollar amount');
  }
  if (values.evidence === undefined) throw new DriverConfigError('--evidence is required');
  const model = values.model ?? (dryRun ? DRY_RUN_MODEL : undefined);
  const provider = values.provider ?? (dryRun ? DRY_RUN_PROVIDER : undefined);
  const endpoint = values.endpoint ?? (dryRun ? 'http://127.0.0.1/v1/chat/completions' : undefined);
  if (model === undefined) throw new DriverConfigError('--model is required');
  if (provider === undefined) throw new DriverConfigError('--provider is required');
  if (endpoint === undefined) throw new DriverConfigError('--endpoint is required');
  const promptRate = ratePerMillion(
    values['basis-prompt-usd-per-million'],
    'basis-prompt-usd-per-million',
  );
  const completionRate = ratePerMillion(
    values['basis-completion-usd-per-million'],
    'basis-completion-usd-per-million',
  );
  if ((promptRate === undefined) !== (completionRate === undefined)) {
    throw new DriverConfigError('The two basis rate flags go together');
  }
  const options = routeOptions(values['route-options']);
  const nodeImage = values['node-image'];
  const config: IDriverConfig = {
    arms: arms(values.arms),
    trialCap: integer(values['trial-cap'], 'trial-cap'),
    callCap: integer(values['call-cap'], 'call-cap'),
    ceilingMicros: ceiling,
    evidenceDir: resolve(values.evidence),
    ...(values['credential-file'] === undefined
      ? {}
      : { credentialFile: resolve(values['credential-file']) }),
    ...(values['credential-name'] === undefined
      ? {}
      : { credentialName: values['credential-name'] }),
    model,
    endpoint,
    provider,
    ...(options === undefined ? {} : { routeOptions: options }),
    ...(promptRate === undefined || completionRate === undefined
      ? {}
      : {
          basis: {
            promptMicrosPerMillionTokens: promptRate,
            completionMicrosPerMillionTokens: completionRate,
          },
        }),
    ...(values['decision-rule'] === undefined ? {} : { decisionRuleUrl: values['decision-rule'] }),
    resume: values.resume === true,
    reconcile: values.reconcile === true,
    dryRun,
    baseDir: resolve(values.base),
  };
  return {
    config,
    build: {
      source: resolve(values.source ?? defaultSource),
      revision: values.revision,
      nodeImage,
      verifierImage: values['verifier-image'] ?? nodeImage,
    },
  };
}
