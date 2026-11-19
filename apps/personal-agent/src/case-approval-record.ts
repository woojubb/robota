/** An immutable record of a case action the person approved, independent of feed rewrites. */
import { randomUUID } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import type { IFeedItem } from '@robota-sdk/agent-product/personal';
import type { ICaseActionSnapshot } from './case-action.js';
import type { IApprovedConnectorCall } from './goal-runner.js';

function syncDirectory(path: string): void {
  const directory = openSync(path, 'r');
  try {
    fsyncSync(directory);
  } finally {
    closeSync(directory);
  }
}

export function createCaseApprovalRecorder(directory: string) {
  return async (
    snapshot: ICaseActionSnapshot,
    executionId: string,
    call: IApprovedConnectorCall,
    item: IFeedItem,
  ): Promise<void> => {
    if (item.approval?.state !== 'approved') throw new Error('The approval was not recorded');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    syncDirectory(dirname(directory));
    const name = randomUUID();
    const path = join(directory, `${name}.json`);
    const temporary = join(directory, `${name}.tmp`);
    let created = false;
    try {
      const file = openSync(temporary, 'wx', 0o600);
      created = true;
      try {
        writeFileSync(
          file,
          `${JSON.stringify({
            caseId: snapshot.caseId,
            answerId: snapshot.feedItemId,
            bindingGeneration: snapshot.bindingGeneration,
            scopeGeneration: snapshot.scopeGeneration,
            executionId,
            call,
            approval: {
              id: item.id,
              goalId: item.goalId,
              runId: item.runId,
              detail: item.approval.detail,
              state: item.approval.state,
            },
            recordedAt: new Date().toISOString(),
          })}\n`,
        );
        fsyncSync(file);
      } finally {
        closeSync(file);
      }
      renameSync(temporary, path);
      // A successful handoff must not precede a durable directory entry for its approval.
      syncDirectory(directory);
    } finally {
      if (created) rmSync(temporary, { force: true });
    }
  };
}
