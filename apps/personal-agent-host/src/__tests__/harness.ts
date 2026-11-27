import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { AccountStore } from '../accounts/store.js';
import { SecretStore } from '../accounts/secret-store.js';
import { AuditLog, type IAuditEntry } from '../audit.js';
import { type IHostConfig, loadConfig } from '../config.js';
import { ControlPlane, type IAddAccountInput } from '../control-plane.js';
import { FakeProxy } from '../proxy/fake.js';
import { FakeRuntime } from '../runtime/fake.js';

export const BASE_DOMAIN = 'agents.example.test';
export const KEY = 'sk-test-secret-9d41c7e05b2a';

const created: string[] = [];

/** Short temp paths: socket paths added later are length-limited on macOS. */
export async function tempDir(): Promise<string> {
  const dir = await mkdtemp('/tmp/pah-');
  created.push(dir);
  return dir;
}

export async function cleanTempDirs(): Promise<void> {
  await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
}

export function testConfig(stateDir: string, extra: Record<string, string> = {}): IHostConfig {
  return loadConfig({
    PERSONAL_AGENT_HOST_BASE_DOMAIN: BASE_DOMAIN,
    PERSONAL_AGENT_HOST_TLS: 'internal',
    PERSONAL_AGENT_HOST_UNIT_IMAGE: 'personal-agent:test',
    PERSONAL_AGENT_HOST_ALLOW_CONTAINER: 'true',
    PERSONAL_AGENT_HOST_STATE_DIR: stateDir,
    ...extra,
  });
}

export interface IHost {
  dir: string;
  config: IHostConfig;
  store: AccountStore;
  secrets: SecretStore;
  audit: AuditLog;
  runtime: FakeRuntime;
  proxy: FakeProxy;
  plane: ControlPlane;
  auditLines(): Promise<IAuditEntry[]>;
  auditText(): Promise<string>;
  clock: { now: number };
}

export async function makeHost(
  options: {
    dir?: string;
    runtime?: FakeRuntime;
    proxy?: FakeProxy;
    extra?: Record<string, string>;
  } = {},
): Promise<IHost> {
  const dir = options.dir ?? (await tempDir());
  const config = testConfig(dir, options.extra);
  const store = await AccountStore.open(dir);
  const secrets = await SecretStore.open(dir);
  const audit = await AuditLog.open(join(dir, 'audit.log'));
  const runtime = options.runtime ?? new FakeRuntime();
  const proxy = options.proxy ?? new FakeProxy();
  const clock = { now: Date.UTC(2026, 0, 1) };
  const plane = new ControlPlane({
    config,
    store,
    secrets,
    audit,
    runtime,
    proxy,
    now: () => clock.now,
    backoff: { baseMs: 1_000, maxMs: 8_000 },
  });
  const auditText = async (): Promise<string> => {
    try {
      return await readFile(join(dir, 'audit.log'), 'utf8');
    } catch {
      return '';
    }
  };
  return {
    dir,
    config,
    store,
    secrets,
    audit,
    runtime,
    proxy,
    plane,
    clock,
    auditText,
    auditLines: async () =>
      (await auditText())
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as IAuditEntry),
  };
}

export function addInput(id: string, extra: Partial<IAddAccountInput> = {}): IAddAccountInput {
  return {
    id,
    backend: 'container',
    provider: { type: 'anthropic', model: 'test-model' },
    keySource: 'account',
    apiKey: KEY,
    ...extra,
  };
}
