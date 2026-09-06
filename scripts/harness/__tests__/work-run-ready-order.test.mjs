import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';
import { assertWorkRunReadyOrder } from '../work-run-ready-order.mjs';

const taskName = 'INFRA-150-work-run-receipt-closure-and-task-completion-form-a-circular-full-scan-dependenc.md';

function fixture({ taskFolder = 'completed', taskStatus = 'done', specFolder = 'done' } = {}) {
  const root = makeTemp('robota-ready-order-');
  const task = path.join(root, '.agents/tasks', taskFolder, taskName);
  mkdirSync(path.dirname(task), { recursive: true });
  writeFileSync(
    task,
    `---\ntitle: 'INFRA-150: lifecycle order'\nstatus: ${taskStatus}\ncompleted: 2026-09-06\n---\n`,
  );
  if (specFolder !== null) {
    const spec = path.join(root, '.agents/spec-docs', specFolder, taskName);
    mkdirSync(path.dirname(spec), { recursive: true });
    writeFileSync(spec, `---\ntitle: 'INFRA-150: lifecycle order'\nstatus: done\n---\n`);
  }
  return root;
}

describe('Work-Run ready lifecycle ordering', () => {
  it('requires the Task to be terminalized and archived before ready', () => {
    expect(() => assertWorkRunReadyOrder(fixture({ taskFolder: '', taskStatus: 'todo' }), 'INFRA-150'))
      .toThrow(/terminalized before Work-Run ready/);
  });

  it('requires a paired spec to be terminalized before ready', () => {
    expect(() => assertWorkRunReadyOrder(fixture({ specFolder: 'active' }), 'INFRA-150'))
      .toThrow(/spec INFRA-150 to be terminalized/);
  });

  it('accepts the terminal Task/spec pair before receipt creation', () => {
    expect(() => assertWorkRunReadyOrder(fixture())).not.toThrow();
  });

  it('leaves work IDs without a repository Task compatible', () => {
    expect(() => assertWorkRunReadyOrder(makeTemp('robota-ready-order-empty-'), 'EXTERNAL-1'))
      .not.toThrow();
  });
});
