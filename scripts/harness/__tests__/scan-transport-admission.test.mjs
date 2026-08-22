/**
 * SEC-008 — the parity check that makes a transport answer the admission question.
 *
 * The point of this scan is that fixing three transports leaves the DECISION un-owned: the next
 * transport re-decides it, and nothing notices. So the cases below are about what the scan does with
 * a transport it has never seen — including the one shape that matters most, a root where there is
 * nothing to examine at all.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import { findAdmissionFindings, transportPackages } from '../scan-transport-admission.mjs';

let root;

/** A transport package with the given source text and SPEC content. */
function makeTransport(name, { source, spec } = {}) {
  const dir = path.join(root, 'packages', name);
  mkdirSync(path.join(dir, 'src'), { recursive: true });
  writeFileSync(path.join(dir, 'src', 'index.ts'), source ?? '// nothing about admission\n');
  if (spec !== undefined) {
    mkdirSync(path.join(dir, 'docs'), { recursive: true });
    writeFileSync(path.join(dir, 'docs', 'SPEC.md'), spec);
  }
  return dir;
}

beforeEach(() => {
  root = makeTemp('transport-admission-');
  mkdirSync(path.join(root, 'packages'), { recursive: true });
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('a transport with no admission answer', () => {
  it('is reported', () => {
    makeTransport('agent-transport-newthing');

    expect(findAdmissionFindings(root).map((f) => f.package)).toEqual(['agent-transport-newthing']);
  });

  it('is cleared by referencing the seam', () => {
    makeTransport('agent-transport-newthing', {
      source: "import { resolveAdmission } from '@robota-sdk/agent-transport-protocol';\n",
    });

    expect(findAdmissionFindings(root)).toEqual([]);
  });

  it('is cleared by declaring it has no peer, WITH a reason', () => {
    makeTransport('agent-transport-local', {
      spec: '# Local\n\ntransport-admission: none — the peer is this process’s own terminal.\n',
    });

    expect(findAdmissionFindings(root)).toEqual([]);
  });

  it('is NOT cleared by a declaration with no reason', () => {
    // Without this, the escape hatch is a phrase rather than a decision — which is the state the
    // whole change exists to remove.
    makeTransport('agent-transport-local', { spec: '# Local\n\ntransport-admission: none\n' });

    expect(findAdmissionFindings(root).map((f) => f.package)).toEqual(['agent-transport-local']);
  });

  it('is NOT cleared by naming the seam without the package that owns it', () => {
    // A local function called `resolveAdmission` is not the shared decision. Matching the name alone
    // would let a transport satisfy this by re-implementing exactly what it must stop re-deciding.
    makeTransport('agent-transport-newthing', {
      source: 'function resolveAdmission() {\n  return { token: null };\n}\n',
    });

    expect(findAdmissionFindings(root).map((f) => f.package)).toEqual(['agent-transport-newthing']);
  });
});

describe('what the scan considers its subject', () => {
  it('discovers transports rather than reading a list', () => {
    makeTransport('agent-transport-one');
    makeTransport('agent-transport-two');
    makeTransport('agent-session'); // not a transport

    expect(
      transportPackages(root)
        .map((dir) => path.basename(dir))
        .sort(),
    ).toEqual(['agent-transport-one', 'agent-transport-two']);
  });

  it('REFUSES a root with no packages tree rather than reporting it clean', () => {
    // The failure this exists for. Over a root with no `packages/` there is no transport to ask, and
    // "nobody failed to answer" reads exactly like "everybody answered" — the vacuous pass that let
    // three transports ship with no trust boundary in the first place.
    const bare = makeTemp('transport-admission-bare-');

    expect(() => findAdmissionFindings(bare)).toThrow(/packages missing from/);

    rmSync(bare, { recursive: true, force: true });
  });
});
