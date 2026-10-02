import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import {
  createFileMcpSkillApprovalStore,
  resolveMcpSkillApprovalStore,
} from '../mcp-skill-approval-file-store.js';
import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';

const roots: string[] = [];
function root() {
  const value = mkdtempSync(join(tmpdir(), 'mcp-skill-consent-'));
  roots.push(value);
  return value;
}
afterEach(() => {
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true });
});
const approval = {
  scope: 'workspace-a',
  serverId: 'docs',
  uri: 'skill://docs/demo/SKILL.md',
  namespace: 'origin-a',
  fingerprint: 'a'.repeat(64),
};

it('persists exact content consent and withdrawal across independent process stores', () => {
  const path = join(root(), 'approvals.json');
  const first = createFileMcpSkillApprovalStore(path);
  first.put(approval);
  const next = createFileMcpSkillApprovalStore(path);
  expect(next.list()).toEqual([approval]);
  next.put({ ...approval, namespace: 'origin-b' });
  first.remove('origin-a');
  expect(next.list()).toEqual([{ ...approval, namespace: 'origin-b' }]);
  if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600);
});

it.each(['{', '{"version":2,"records":[]}', '{"version":1,"records":[{}]}'])(
  'withholds and preserves invalid stores: %s',
  (content) => {
    const path = join(root(), 'approvals.json');
    writeFileSync(path, content);
    const store = createFileMcpSkillApprovalStore(path);
    expect(store.list()).toEqual([]);
    expect(() => store.put(approval)).toThrow(/Refusing to write/);
    expect(() => store.remove('origin-a')).toThrow(/Refusing to write/);
    expect(readFileSync(path, 'utf8')).toBe(content);
  },
);

it('refuses a competing writer without restoring withdrawn consent', () => {
  const path = join(root(), 'approvals.json');
  const store = createFileMcpSkillApprovalStore(path);
  store.put(approval);
  store.remove(approval.namespace);
  const before = readFileSync(path, 'utf8');
  writeFileSync(`${path}.lock`, '', { flag: 'wx' });
  expect(() => store.put(approval)).toThrow(/another writer/);
  expect(readFileSync(path, 'utf8')).toBe(before);
});

it('uses the selected product state and does not share consent between products', () => {
  const home = root();
  const first = createTestProductRuntime('first-agent', { HOME: home });
  const second = createTestProductRuntime('second-agent', { HOME: home });
  resolveMcpSkillApprovalStore(first).put(approval);
  expect(resolveMcpSkillApprovalStore(first).list()).toEqual([approval]);
  expect(resolveMcpSkillApprovalStore(second).list()).toEqual([]);
});
