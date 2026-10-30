import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  mkdirSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { mintWorkspaceProjectAuthority } from './workspace-authority.js';
import { prepareWorkflowJsonMutation } from './project-mutation.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const container = realpathSync(mkdtempSync(join(tmpdir(), 'robota-workflow-write-')));
  roots.push(container);
  const root = join(container, 'project');
  mkdirSync(root);
  const identity = {
    repositoryKey: 'same-git-common-directory',
    displayPath: root,
    worktreeRoot: root,
  };
  let live = true;
  const authority = mintWorkspaceProjectAuthority(
    identity,
    { resolve: () => identity },
    () => live,
  );
  return {
    container,
    root,
    authority,
    revoke: () => {
      live = false;
    },
  };
}

describe.runIf(process.platform !== 'win32')('approved workflow JSON mutation', () => {
  it('writes only approved JSON under workflows and closes after the invocation', () => {
    const f = fixture();
    const request = prepareWorkflowJsonMutation(f.authority);
    const mutation = request.approve({ status: 'approved', purpose: 'save workflow' });
    mutation.writeBytes('.workflows/example.json', Buffer.from('{"ok":true}'), 'save workflow');
    expect(JSON.parse(readFileSync(join(f.root, '.workflows/example.json'), 'utf8'))).toEqual({
      ok: true,
    });
    expect(() => mutation.writeBytes('outside.json', Buffer.from('{}'), 'save')).toThrow();
    expect(() =>
      mutation.writeBytes('.workflows/../outside.json', Buffer.from('{}'), 'save'),
    ).toThrow();
    expect(() => mutation.writeBytes('.workflows/no.txt', Buffer.from('{}'), 'save')).toThrow();
    expect(() =>
      mutation.writeBytes('.workflows/invalid.json', Buffer.from([0xff]), 'save'),
    ).toThrow();
    expect(() =>
      mutation.writeBytes('.workflows/invalid.json', Buffer.from('not json'), 'save'),
    ).toThrow();
    expect(() => mutation.deleteFile('.workflows/example.json', 'delete')).toThrow();
    request.close();
    expect(() =>
      mutation.writeBytes('.workflows/example.json', Buffer.from('{}'), 'save'),
    ).toThrow();
  });
  it('refuses when the named root is swapped before approval, even for the same git identity', () => {
    const f = fixture();
    const request = prepareWorkflowJsonMutation(f.authority);
    renameSync(f.root, join(f.container, 'original'));
    mkdirSync(f.root);
    expect(() => request.approve({ status: 'approved', purpose: 'save workflow' })).toThrow();
    request.close();
  });
  it('refuses when the named root is swapped after approval', () => {
    const f = fixture();
    const request = prepareWorkflowJsonMutation(f.authority);
    const mutation = request.approve({ status: 'approved', purpose: 'save workflow' });
    renameSync(f.root, join(f.container, 'original'));
    mkdirSync(f.root);
    expect(() =>
      mutation.writeBytes('.workflows/example.json', Buffer.from('{}'), 'save'),
    ).toThrow();
    request.close();
  });
  it('refuses a symlinked workflow directory and revoked authority', () => {
    const f = fixture();
    const outside = join(f.container, 'outside');
    mkdirSync(outside);
    symlinkSync(outside, join(f.root, '.workflows'));
    const request = prepareWorkflowJsonMutation(f.authority);
    const mutation = request.approve({ status: 'approved', purpose: 'save workflow' });
    expect(() =>
      mutation.writeBytes('.workflows/example.json', Buffer.from('{}'), 'save'),
    ).toThrow();
    f.revoke();
    expect(() =>
      mutation.writeBytes('.workflows/example.json', Buffer.from('{}'), 'save'),
    ).toThrow();
    request.close();
  });
});
