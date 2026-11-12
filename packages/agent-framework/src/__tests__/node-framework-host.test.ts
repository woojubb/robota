import { AsyncLocalStorage } from 'node:async_hooks';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeCanonicalTempDir } from '../testing/canonical-temp-dir.js';
import * as MainEntry from '../index.js';
import * as NodeEntry from '../node.js';
import { createNodeFrameworkHost } from '../node.js';
import { createTestFrameworkHost } from '../testing/framework-host.js';
import { createNodeWorkspaceIdentityResolver } from '../workspace-trust/node-host-workspace-trust.js';

import type { IFrameworkHost } from '../host/framework-host.js';
import type { IToolWithEventService } from '@robota-sdk/agent-core';

/** Every member of the host. Typed over the keys, so a member added to the port fails to compile here. */
const MEMBERS: Record<keyof IFrameworkHost, true> = {
  homeDirectory: true,
  createWorkspacePathResolver: true,
  canonicalizePath: true,
  registerExitFlush: true,
  env: true,
  files: true,
  git: true,
  readGitRemotes: true,
  createHookExecutors: true,
  createBackgroundTaskRunners: true,
  createDefaultTools: true,
  reportObserverFailure: true,
  createAsyncScope: true,
  supportsProjectMutation: true,
  validateSessionReplayLog: true,
};

let root: string;
beforeEach(() => {
  root = makeCanonicalTempDir('node-framework-host-');
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('createNodeFrameworkHost', () => {
  const host = createNodeFrameworkHost({ createDefaultTools: () => [] });

  it('fills every member of the host', () => {
    for (const name of Object.keys(MEMBERS) as (keyof IFrameworkHost)[]) {
      expect(host[name], name).toBeDefined();
    }
    expect(Object.keys(host).sort()).toEqual(Object.keys(MEMBERS).sort());
  });

  it('reports the Node home directory and project-mutation support', () => {
    expect(host.homeDirectory).toBe(homedir());
    expect(host.supportsProjectMutation).toBe(process.platform === 'linux');
  });

  it('resolves symlinks to a real path and throws on a missing directory', () => {
    const workspace = join(root, 'ws');
    mkdirSync(workspace);
    symlinkSync(workspace, join(root, 'alias'));
    expect(host.canonicalizePath?.(join(root, 'alias'))).toBe(workspace);
    expect(() => host.canonicalizePath?.(join(root, 'missing'))).toThrow();
  });

  it('spells a directory the way the workspace identity does', () => {
    const workspace = join(root, 'ws');
    mkdirSync(workspace);
    execFileSync('git', ['init', '--quiet', workspace], { stdio: 'ignore' });
    symlinkSync(workspace, join(root, 'alias'));
    for (const spelled of [workspace, join(root, 'alias')]) {
      const { worktreeRoot } = createNodeWorkspaceIdentityResolver().resolve(spelled);
      expect(host.canonicalizePath?.(spelled)).toBe(worktreeRoot);
      expect(host.files?.sync.realpathSync(spelled)).toBe(worktreeRoot);
    }
  });

  it('builds a workspace resolver that follows symlinks and refuses a path that leaves the root', () => {
    const workspace = join(root, 'ws');
    mkdirSync(workspace);
    writeFileSync(join(workspace, 'note.txt'), 'note');
    writeFileSync(join(root, 'secret'), 'secret');
    symlinkSync(join(root, 'secret'), join(workspace, 'link'));
    const resolve = host.createWorkspacePathResolver?.(workspace);
    expect(resolve?.(undefined, 'note.txt')).toBe(join(workspace, 'note.txt'));
    expect(resolve?.(undefined, 'link')).toBeUndefined();
  });

  it('reads the process environment by name', () => {
    vi.stubEnv('ROBOTA_HOST_PROBE', 'present');
    expect(host.env?.('ROBOTA_HOST_PROBE')).toBe('present');
    expect(host.env?.('ROBOTA_HOST_PROBE_UNSET')).toBeUndefined();
  });

  it('reads and writes real files and decides containment on resolved paths', async () => {
    const file = join(root, 'a.txt');
    host.files?.sync.writeFileSync(file, 'sync');
    expect(host.files?.sync.readFileSync(file, 'utf8')).toBe('sync');
    await host.files?.async.writeFile(file, 'async', 'utf8');
    expect(await host.files?.async.readFile(file, 'utf8')).toBe('async');
    mkdirSync(join(root, 'inside'));
    symlinkSync(root, join(root, 'inside', 'out'));
    expect(host.files?.isPathInside(root, join(root, 'inside'))).toBe(true);
    expect(host.files?.isPathInside(join(root, 'inside'), join(root, 'a.txt'))).toBe(false);
    expect(
      host.files?.isPathInside(join(root, 'inside'), join(root, 'inside', 'out', 'a.txt')),
    ).toBe(false);
  });

  it('runs git as a process', async () => {
    const outcome = await host.git?.run(['--version'], { cwd: root });
    expect(outcome?.kind === 'exited' ? outcome.stdout : outcome).toMatch(/^git version /);
  });

  it('lists the remotes of a repository once each, and none outside one', async () => {
    const repo = join(root, 'repo');
    mkdirSync(repo);
    execFileSync('git', ['init', '--quiet'], { cwd: repo });
    execFileSync('git', ['remote', 'add', 'origin', 'https://example.test/a.git'], { cwd: repo });
    execFileSync('git', ['remote', 'add', 'mirror', 'https://example.test/a.git'], { cwd: repo });
    expect(await host.readGitRemotes?.(repo)).toEqual(['https://example.test/a.git']);
    expect(await host.readGitRemotes?.(root)).toEqual([]);
  });

  it('reads remotes in the environment a judged push runs in, where `git` runs scrubbed', async () => {
    const repo = join(root, 'elsewhere');
    const outside = join(root, 'outside');
    mkdirSync(repo);
    mkdirSync(outside);
    execFileSync('git', ['init', '--quiet'], { cwd: repo });
    execFileSync('git', ['remote', 'add', 'origin', 'https://example.test/b.git'], { cwd: repo });
    vi.stubEnv('GIT_DIR', join(repo, '.git'));
    // A `git push` run from `outside` would reach the repository GIT_DIR names, so those are the
    // remotes the classifier has to be told; the host's own runner drops GIT_DIR and sees none.
    expect(await host.readGitRemotes?.(outside)).toEqual(['https://example.test/b.git']);
    const scrubbed = await host.git?.run(['remote', '-v'], { cwd: outside });
    expect(scrubbed?.kind === 'exited' ? scrubbed.exitCode : scrubbed).not.toBe(0);
  });

  it('builds the command and HTTP hook executors, the default runners and an async scope', async () => {
    expect(host.createHookExecutors?.({}).map((executor) => executor.type)).toEqual([
      'command',
      'http',
    ]);
    const kinds = host.createBackgroundTaskRunners?.().map((runner) => runner.kind);
    expect(kinds?.length).toBeGreaterThan(0);
    // The shell a product chose reaches the command runners, as it does for `agent-cli`.
    expect(host.createBackgroundTaskRunners?.('/bin/sh').map((runner) => runner.kind)).toEqual(
      kinds,
    );
    const scope = host.createAsyncScope?.<string>();
    expect(scope).toBeInstanceOf(AsyncLocalStorage);
    expect(scope?.getStore()).toBeUndefined();
    await scope?.run('inside', async () => {
      await Promise.resolve();
      expect(scope.getStore()).toBe('inside');
    });
    expect(scope?.getStore()).toBeUndefined();
  });

  it('reports an observer failure as a process warning and registers an exit flush', () => {
    const warning = vi.spyOn(process, 'emitWarning').mockImplementation(() => undefined);
    host.reportObserverFailure?.(
      { event: { type: 'x' }, error: new Error('boom'), observerIndex: 0 },
      'CODE',
    );
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('boom'), { code: 'CODE' });
    const on = vi.spyOn(process, 'on').mockImplementation(() => process);
    const flush = (): void => undefined;
    host.registerExitFlush?.(flush);
    expect(on).toHaveBeenCalledWith('exit', flush);
  });

  it('hands the session the default tools the root named, with the session context', () => {
    const tools: IToolWithEventService[] = [];
    const createDefaultTools = vi.fn(() => tools);
    const named = createNodeFrameworkHost({ createDefaultTools });
    expect(named.createDefaultTools?.({ cwd: root })).toBe(tools);
    expect(createDefaultTools).toHaveBeenCalledWith({ cwd: root });
  });

  it('refuses a root that names no default tools', () => {
    expect(() => createNodeFrameworkHost({} as never)).toThrow(
      /requires `createDefaultTools`[\s\S]*@robota-sdk\/agent-tools\/defaults/,
    );
  });
});

describe('createTestFrameworkHost', () => {
  it('is the Node host with the real default tools', () => {
    const host = createTestFrameworkHost();
    expect(Object.keys(host).sort()).toEqual(Object.keys(MEMBERS).sort());
    const names = host.createDefaultTools?.({ cwd: root }).map((tool) => tool.getName());
    expect(names).toEqual(expect.arrayContaining(['Read', 'Write', 'Edit']));
  });

  it('lets a test replace a member or remove it with an explicit undefined', () => {
    const git = { run: vi.fn() };
    const host = createTestFrameworkHost({ git, env: undefined });
    expect(host.git).toBe(git);
    expect('env' in host && host.env === undefined).toBe(true);
  });
});

describe('framework entry surfaces', () => {
  it('builds the Node host on ./node and leaves it off the main entry', () => {
    expect(Object.keys(NodeEntry)).toContain('createNodeFrameworkHost');
    expect(Object.keys(MainEntry)).not.toContain('createNodeFrameworkHost');
  });

  it('keeps the subagent transcript, a Node log file, on ./node alone', () => {
    const names = [
      'createSubagentLogger',
      'migrateSubagentTranscripts',
      'readSubagentTranscriptPage',
      'resolveSubagentLogDir',
      'resolveSubagentLogSessionId',
      'resolveSubagentTranscriptPath',
    ];
    expect(Object.keys(NodeEntry)).toEqual(expect.arrayContaining(names));
    for (const name of names) expect(Object.keys(MainEntry), name).not.toContain(name);
  });
});
