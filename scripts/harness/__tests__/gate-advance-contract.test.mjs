import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { vacantAdvanceDestination } from '../gate-advance-contract.mjs';
import { makeTemp } from './make-temp.mjs';

describe('gate advance destination contract', () => {
  it('returns a vacant target and refuses an existing destination without mutation', () => {
    const root = makeTemp('robota-gate-advance-contract-');
    const docPath = path.join(root, '.agents/spec-docs/todo/PROC-001.md');
    const target = path.join(root, '.agents/spec-docs/active/PROC-001.md');
    mkdirSync(path.dirname(docPath), { recursive: true });
    writeFileSync(docPath, 'source');

    expect(vacantAdvanceDestination(root, docPath, 'active')).toEqual({
      target,
      moved: true,
    });

    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, 'destination');
    expect(() => vacantAdvanceDestination(root, docPath, 'active')).toThrow(
      'refused: destination spec already exists: .agents/spec-docs/active/PROC-001.md',
    );
    expect(readFileSync(docPath, 'utf8')).toBe('source');
    expect(readFileSync(target, 'utf8')).toBe('destination');
  });
});
