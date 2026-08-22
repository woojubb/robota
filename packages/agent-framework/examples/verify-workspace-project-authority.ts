import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createScriptedProvider } from '@robota-sdk/agent-core/testing';

import {
  WorkspaceTrustService,
  createAgentRuntime,
  createContributionSourcesForProjectAccess,
  createWorkspaceProjectSettingsSources,
  getWorkspaceProjectReader,
  readSettingsSourceText,
} from '../src/index.js';

import type {
  IWorkspaceIdentity,
  IWorkspaceIdentityResolver,
  IWorkspaceTrustStore,
  IWorkspaceTrustStoreSnapshot,
  TWorkspaceProjectAccess,
} from '../src/index.js';

const CONTEXT_CANARY = 'ARCH_042_CONTEXT_CANARY';
const SETTINGS_CANARY = 'ARCH_042_SETTINGS_CANARY';

function assertCondition(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

class GitWorkspaceIdentityResolver implements IWorkspaceIdentityResolver {
  resolve(cwd: string): IWorkspaceIdentity {
    const worktreeRoot = realpathSync(
      execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], {
        encoding: 'utf8',
      }).trim(),
    );
    const repositoryKey = realpathSync(
      execFileSync('git', ['-C', cwd, 'rev-parse', '--absolute-git-dir'], {
        encoding: 'utf8',
      }).trim(),
    );
    return { repositoryKey, displayPath: worktreeRoot, worktreeRoot };
  }
}

class FileWorkspaceTrustStore implements IWorkspaceTrustStore {
  constructor(private readonly file: string) {}

  async inspect(identity: IWorkspaceIdentity): Promise<IWorkspaceTrustStoreSnapshot> {
    return this.read()[identity.repositoryKey] ?? { state: 'untrusted', generation: 0 };
  }

  async grant(
    identity: IWorkspaceIdentity,
    expectedGeneration: number,
  ): Promise<IWorkspaceTrustStoreSnapshot> {
    return this.transition(identity, expectedGeneration, 'trusted');
  }

  async revoke(
    identity: IWorkspaceIdentity,
    expectedGeneration: number,
  ): Promise<IWorkspaceTrustStoreSnapshot> {
    return this.transition(identity, expectedGeneration, 'revoked');
  }

  private transition(
    identity: IWorkspaceIdentity,
    expectedGeneration: number,
    state: 'trusted' | 'revoked',
  ): IWorkspaceTrustStoreSnapshot {
    const entries = this.read();
    const current = entries[identity.repositoryKey] ?? { state: 'untrusted', generation: 0 };
    assertCondition(
      current.generation === expectedGeneration,
      'trust-store generation changed during the scenario',
    );
    const next: IWorkspaceTrustStoreSnapshot = {
      state,
      generation: current.generation + 1,
      ...(state === 'trusted' ? { grantedAt: '2026-08-22T00:00:00.000Z' } : {}),
    };
    entries[identity.repositoryKey] = next;
    mkdirSync(join(this.file, '..'), { recursive: true });
    writeFileSync(this.file, `${JSON.stringify(entries, null, 2)}\n`, { mode: 0o600 });
    return next;
  }

  private read(): Record<string, IWorkspaceTrustStoreSnapshot> {
    if (!existsSync(this.file)) return {};
    return JSON.parse(readFileSync(this.file, 'utf8')) as Record<
      string,
      IWorkspaceTrustStoreSnapshot
    >;
  }
}

function initializeGitProject(root: string): void {
  mkdirSync(root, { recursive: true });
  execFileSync('git', ['init', '--quiet', root]);
}

function observeCanaries(projectAccess: TWorkspaceProjectAccess, userHome: string): string[] {
  const observed: string[] = [];
  for (const source of createContributionSourcesForProjectAccess(projectAccess, userHome)) {
    const text = source.readText('AGENTS.md', 'run ARCH-042 public authority scenario');
    if (text?.includes(CONTEXT_CANARY) === true) observed.push(CONTEXT_CANARY);
  }
  if (projectAccess.status === 'trusted') {
    const reader = getWorkspaceProjectReader(projectAccess.authority);
    for (const source of createWorkspaceProjectSettingsSources(reader)) {
      const text = readSettingsSourceText(source, 'run ARCH-042 public authority scenario');
      if (text?.includes(SETTINGS_CANARY) === true) observed.push(SETTINGS_CANARY);
    }
  }
  return observed;
}

async function main(): Promise<void> {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'arch-042-authority-'));
  const projectRoot = join(temporaryRoot, 'project');
  const otherProjectRoot = join(temporaryRoot, 'other-project');
  const hostStateRoot = join(temporaryRoot, 'host-state');
  const userHome = join(hostStateRoot, 'home');
  const trustStore = new FileWorkspaceTrustStore(join(hostStateRoot, 'trust.json'));
  const trustService = new WorkspaceTrustService({
    identityResolver: new GitWorkspaceIdentityResolver(),
    store: trustStore,
  });
  const scripted = createScriptedProvider([]);
  let granted = false;
  let result:
    | {
        scenario: 'ARCH-042';
        restricted: {
          status: 'restricted';
          reason: 'WorkspaceAuthorityRequired';
          observedCanaries: string[];
        };
        authorized: { status: 'trusted'; observedCanaries: string[] };
      }
    | undefined;

  try {
    initializeGitProject(projectRoot);
    initializeGitProject(otherProjectRoot);
    mkdirSync(join(projectRoot, '.robota'), { recursive: true });
    mkdirSync(userHome, { recursive: true });
    writeFileSync(join(projectRoot, 'AGENTS.md'), `# ${CONTEXT_CANARY}\n`, 'utf8');
    writeFileSync(
      join(projectRoot, '.robota', 'settings.json'),
      `${JSON.stringify({ canary: SETTINGS_CANARY })}\n`,
      'utf8',
    );

    const restrictedRuntime = createAgentRuntime({ cwd: projectRoot, provider: scripted.provider });
    assertCondition(
      restrictedRuntime.projectAccess.status === 'restricted',
      'capabilityless runtime construction was not Restricted',
    );
    const restrictedCanaries = observeCanaries(restrictedRuntime.projectAccess, userHome);
    assertCondition(restrictedCanaries.length === 0, 'Restricted construction observed a canary');

    const authorizedAccess = await trustService.grant(projectRoot);
    granted = true;
    assertCondition(
      authorizedAccess.status === 'trusted',
      'explicit project grant was not trusted',
    );
    const authorizedRuntime = createAgentRuntime({
      cwd: projectRoot,
      provider: scripted.provider,
      projectAccess: authorizedAccess,
    });
    const authorizedCanaries = observeCanaries(authorizedRuntime.projectAccess, userHome);
    assertCondition(
      authorizedCanaries.join(',') === `${CONTEXT_CANARY},${SETTINGS_CANARY}`,
      'authorized construction did not observe exactly both project canaries',
    );

    const otherAccess = await trustService.inspect(otherProjectRoot);
    assertCondition(
      otherAccess.status === 'restricted',
      'a grant for one repository was accepted for a different root',
    );
    assertCondition(scripted.requests.length === 0, 'the offline scenario made a provider request');

    result = {
      scenario: 'ARCH-042',
      restricted: {
        status: 'restricted',
        reason: restrictedRuntime.projectAccess.reason,
        observedCanaries: restrictedCanaries,
      },
      authorized: { status: 'trusted', observedCanaries: authorizedCanaries },
    };
  } finally {
    if (granted) await trustService.revoke(projectRoot);
    rmSync(temporaryRoot, { recursive: true, force: true });
  }

  assertCondition(result !== undefined, 'scenario did not produce a result');
  assertCondition(!existsSync(projectRoot), 'scenario cleanup left the temporary project behind');
  assertCondition(!existsSync(hostStateRoot), 'scenario cleanup left host trust state behind');
  process.stdout.write(`${JSON.stringify({ ...result, cleanupRemoved: true })}\n`);
}

await main();
