import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

import { appendWorkRunEvent, createInitialWorkRun, reduceWorkRun } from './work-run-contract.mjs';
import { atomicJson, immutableJson, readJson, sameJson } from './work-run-json-store.mjs';
import {
  assertSafeOwnedParent,
  ensureOwnedDirectory,
  workRunLockPath,
  workRunReceiptPath,
  workRunStatePath,
} from './work-run-paths.mjs';
import {
  exclusionReceipt,
  readyReceipt,
  reconcileExclusionReceipt,
  reconcileReceipt,
} from './work-run-receipts.mjs';

export { projectLocalTerminalWorkRun } from './work-run-receipts.mjs';

export const WORK_RUN_LOCAL_DIR = '.agents/evals/local-metrics/work-runs';
export const WORK_RUN_RECEIPT_DIR = '.agents/evals/work-runs';
const MAX_EVENTS = 10_000;
const LOCK_TIMEOUT_MS = 2_000;
const LOCK_WAIT_MS = 20;

function branchKey(branch) {
  return createHash('sha256').update(branch).digest('hex');
}

export class WorkRunStore {
  constructor({ root, gitCommonDir, now = () => new Date().toISOString(), persistenceHooks = {} }) {
    this.root = root;
    this.gitCommonDir = gitCommonDir;
    this.now = now;
    this.persistenceHooks = persistenceHooks;
    this.stateDir = path.join(root, WORK_RUN_LOCAL_DIR);
    this.receiptDir = path.join(root, WORK_RUN_RECEIPT_DIR);
    this.lockDir = path.join(gitCommonDir, 'robota-work-runs', 'locks');
  }

  statePath(runId) {
    return workRunStatePath(this.stateDir, runId);
  }

  pointerPath(branch) {
    return path.join(
      this.gitCommonDir,
      'robota-work-runs',
      'branches',
      `${branchKey(branch)}.json`,
    );
  }

  receiptPath(runId, generation, revision) {
    return workRunReceiptPath(this.receiptDir, runId, generation, revision);
  }

  withLock(runId, action) {
    ensureOwnedDirectory(this.gitCommonDir, this.lockDir);
    const lock = workRunLockPath(this.lockDir, runId);
    const deadline = Date.now() + LOCK_TIMEOUT_MS;
    let acquired = false;
    while (!acquired) {
      try {
        assertSafeOwnedParent(this.gitCommonDir, lock);
        mkdirSync(lock);
        ensureOwnedDirectory(this.gitCommonDir, lock);
        acquired = true;
      } catch (error) {
        if (error.code !== 'EEXIST' || Date.now() >= deadline) {
          throw new Error(`timed out acquiring work-run lock for ${runId}`);
        }
        Atomics.wait(
          new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)),
          0,
          0,
          LOCK_WAIT_MS,
        );
      }
    }
    try {
      return action();
    } finally {
      rmSync(lock, { recursive: true, force: true });
    }
  }

  claim({ branch, at = this.now() }) {
    return this.withLock(`branch-${branchKey(branch)}`, () => {
      const pointer = this.pointerPath(branch);
      if (existsSync(pointer)) {
        const existing = readJson(pointer, this.gitCommonDir);
        if (existsSync(this.statePath(existing.runId))) {
          const run = this.read(existing.runId);
          if (!['abandoned', 'excluded'].includes(reduceWorkRun(run.events).status)) return run;
        }
      }
      const runId = randomUUID();
      const run = createInitialWorkRun({ runId, at, branch });
      atomicJson(this.statePath(runId), run, this.root);
      atomicJson(pointer, { branch, runId }, this.gitCommonDir);
      return run;
    });
  }

  read(runId) {
    const run = readJson(this.statePath(runId), this.root);
    reduceWorkRun(run.events);
    return run;
  }

  append(runId, event) {
    return this.withLock(runId, () => {
      const current = this.read(runId);
      if (current.events.length >= MAX_EVENTS) throw new Error('work-run event limit is 10000');
      const next = appendWorkRunEvent(current, event);
      atomicJson(this.statePath(runId), next, this.root);
      return next;
    });
  }

  reopen({
    runId,
    at = this.now(),
    ground,
    generation = null,
    authorization = undefined,
    rebaseProof = undefined,
  }) {
    const current = this.read(runId);
    const state = reduceWorkRun(current.events);
    return this.append(runId, {
      type: 'work.reopened',
      at,
      data: {
        ground,
        generation: generation ?? state.generation,
        revision: generation === null ? state.revision + 1 : 0,
        ...(authorization === undefined ? {} : { authorization: structuredClone(authorization) }),
        ...(rebaseProof === undefined ? {} : { rebaseProof: structuredClone(rebaseProof) }),
      },
    });
  }

  ready({ runId, identity, at = this.now() }) {
    return this.withLock(runId, () => {
      let run = this.read(runId);
      let state = reduceWorkRun(run.events);
      if (state.status === 'ready') {
        const existingPath = this.receiptPath(runId, state.generation, state.revision);
        if (existsSync(existingPath)) {
          const existing = readJson(existingPath, this.root);
          if (sameJson(existing, readyReceipt(run, state, identity)))
            return { receiptPath: existingPath, receipt: existing };
        }
        throw new Error('ready run identity changed; reopen it before another receipt');
      }
      const receiptPath = this.receiptPath(runId, state.generation, state.revision);
      if (existsSync(receiptPath)) {
        const recovered = reconcileReceipt({
          current: run,
          receiptPath,
          identity,
          generation: state.generation,
          revision: state.revision,
          ownerDirectory: this.root,
        });
        this.persistenceHooks.afterReceiptPersist?.({ receiptPath, receipt: recovered.receipt });
        atomicJson(this.statePath(runId), recovered.run, this.root);
        return { receiptPath, receipt: recovered.receipt };
      }
      run = appendWorkRunEvent(run, {
        type: 'work.ready',
        at,
        data: { generation: state.generation, revision: state.revision },
      });
      state = reduceWorkRun(run.events);
      const receipt = readyReceipt(run, state, identity);
      immutableJson(receiptPath, receipt, this.root);
      this.persistenceHooks.afterReceiptPersist?.({ receiptPath, receipt });
      atomicJson(this.statePath(runId), run, this.root);
      return { receiptPath, receipt };
    });
  }

  exclude({ runId, identity, reason, at = this.now() }) {
    return this.withLock(runId, () => {
      let run = this.read(runId);
      let state = reduceWorkRun(run.events);
      const receiptPath = this.receiptPath(runId, state.generation, state.revision);
      if (state.status === 'excluded') {
        const existing = readJson(receiptPath, this.root);
        const expected = exclusionReceipt(run, state, identity);
        if (expected.reason !== reason || !sameJson(existing, expected)) {
          throw new Error(`immutable work-run receipt conflict: ${receiptPath}`);
        }
        return { receiptPath, receipt: existing };
      }
      if (existsSync(receiptPath)) {
        const recovered = reconcileExclusionReceipt({
          current: run,
          receiptPath,
          identity,
          reason,
          ownerDirectory: this.root,
        });
        this.persistenceHooks.afterReceiptPersist?.({
          receiptPath,
          receipt: recovered.receipt,
        });
        atomicJson(this.statePath(runId), recovered.run, this.root);
        return { receiptPath, receipt: recovered.receipt };
      }
      run = appendWorkRunEvent(run, {
        type: 'work.excluded',
        at,
        data: { reason },
      });
      state = reduceWorkRun(run.events);
      const receipt = exclusionReceipt(run, state, identity);
      immutableJson(receiptPath, receipt, this.root);
      this.persistenceHooks.afterReceiptPersist?.({ receiptPath, receipt });
      atomicJson(this.statePath(runId), run, this.root);
      return { receiptPath, receipt };
    });
  }

  recoverStateLost({ runId, identity }) {
    const branch = identity?.branch;
    if (!branch) throw new Error('state-lost recovery requires a branch identity');
    return this.withLock(`branch-${branchKey(branch)}`, () =>
      this.withLock(runId, () => {
        if (existsSync(this.statePath(runId))) {
          throw new Error(`work-run state still exists for ${runId}`);
        }

        const pointerPath = this.pointerPath(branch);
        if (existsSync(pointerPath)) {
          let pointer;
          try {
            pointer = readJson(pointerPath, this.gitCommonDir);
          } catch {
            throw new Error(`work-run branch pointer is unreadable for ${branch}`);
          }
          if (typeof pointer.runId !== 'string' || pointer.runId.length === 0) {
            throw new Error(`work-run branch pointer is invalid for ${branch}`);
          }
          if (existsSync(this.statePath(pointer.runId))) {
            let pointedRun;
            try {
              pointedRun = this.read(pointer.runId);
            } catch {
              throw new Error(`work-run branch pointer state is unreadable for ${branch}`);
            }
            if (!['abandoned', 'excluded'].includes(reduceWorkRun(pointedRun.events).status)) {
              throw new Error(`branch points to an active work run: ${pointer.runId}`);
            }
          }
        }

        const receipt = {
          schemaVersion: 1,
          disposition: 'invalid',
          reason: 'state-lost',
          runId,
          generation: 0,
          revision: 0,
          identity: structuredClone(identity),
          timestamps: { claimedAt: null, readyAt: null },
        };
        const receiptPath = this.receiptPath(runId, 0, 0);
        immutableJson(receiptPath, receipt, this.root);
        return { receiptPath, receipt };
      }),
    );
  }
}
