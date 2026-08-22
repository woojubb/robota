import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { NodeSessionLogSource } from '@robota-sdk/agent-session';

import { projectPaths } from '../../../paths.js';

import type { ICommandSessionReplayValidationReport } from '../../host-context.js';
import { createTestCommandHost } from '../../../testing/command-host-double.js';
import {
  computeSessionReplayValidationReport,
  validateCommandSessionReplayLog,
} from '../session-command-api.js';

/**
 * ARCH-029 TC-08 — one computed path, one owner.
 *
 * `validateCurrentSessionReplayLog` used to be an OPTIONAL override with a framework-computed
 * default. Measured before this change: no production host implemented it, so the framework's
 * `else` branch was the only code that ever ran. That is not a capability — it is two declared
 * paths, one of them dead, and the dead one is exactly where the two would silently diverge once
 * someone finally implemented the hook.
 *
 * The member is now required and the framework delegates. These cases pin BOTH halves of that:
 * the caller returns the host's report untouched, and the extracted helper still computes the
 * report the deleted branch computed — so "delegate" did not quietly become "recompute".
 */
function writeLog(
  sessionId: string,
  lines: readonly string[],
): { source: NodeSessionLogSource; reference: string } {
  const root = mkdtempSync(join(tmpdir(), 'arch-029-replay-'));
  const logs = projectPaths(root).logs;
  mkdirSync(logs, { recursive: true });
  const logFile = join(logs, `${sessionId}.jsonl`);
  writeFileSync(logFile, lines.join('\n'), 'utf8');
  return {
    source: new NodeSessionLogSource(logFile),
    reference: join('.robota', 'logs', `${sessionId}.jsonl`),
  };
}

describe('ARCH-029 TC-08 — session replay validation has one owner', () => {
  it('returns the HOST report verbatim, with no second path behind it', () => {
    // A report no computation could produce. If a fallback is ever restored and taken, the
    // returned object stops being this one — which is the whole property under test.
    const sentinel: ICommandSessionReplayValidationReport = {
      logFile: '/sentinel/only-the-host-could-say-this.jsonl',
      entryCount: 4242,
      validation: { ok: false, issues: [{ code: 'TOOL_RESULT_MISSING', message: 'sentinel' }] },
    };
    const host = createTestCommandHost({
      overrides: { validateCurrentSessionReplayLog: () => sentinel },
    });

    expect(validateCommandSessionReplayLog(host)).toBe(sentinel);
  });

  it('the caller carries no second computation — the branch is gone, not merely unreachable', () => {
    // Measured limitation of the case above, and the reason this one exists: restoring the
    // `if (hostReport !== undefined) … else recompute` fallback leaves all three behavioural
    // cases GREEN, because a required member never returns undefined so the branch never runs.
    // An unreachable second path is still a second path — it is what the two implementations
    // would drift between the moment someone makes it reachable again. So this reads the source.
    const source = readFileSync(
      fileURLToPath(new URL('../session-command-api.ts', import.meta.url)),
      'utf8',
    );
    const body = source.slice(
      source.indexOf('export function validateCommandSessionReplayLog'),
      source.indexOf('export function formatCommandSessionReplayValidationReport'),
    );

    expect(body).toContain('return context.validateCurrentSessionReplayLog();');
    expect(body).not.toContain('if (');
    expect(body).not.toContain('computeSessionReplayValidationReport');
  });

  it('the extracted helper still computes what the deleted branch computed', () => {
    const entry = JSON.stringify({ type: 'user', content: 'hi', timestamp: 1 });
    const log = writeLog('session-a', [entry, entry]);

    const report = computeSessionReplayValidationReport(log.source, log.reference);

    expect(report.logFile).toBe(log.reference);
    expect(report.entryCount).toBe(2);
    expect(report.validation).toBeDefined();
  });

  it('a host that delegates to the helper and the helper itself agree', () => {
    // The design's actual requirement: the production host does not compute its own report, it
    // calls the same helper. Equal outputs for equal inputs is what makes "same helper" checkable
    // from outside the class.
    const entry = JSON.stringify({ type: 'user', content: 'hi', timestamp: 1 });
    const log = writeLog('session-b', [entry]);
    const host = createTestCommandHost({
      overrides: {
        validateCurrentSessionReplayLog: () =>
          computeSessionReplayValidationReport(log.source, log.reference),
      },
    });

    expect(validateCommandSessionReplayLog(host)).toEqual(
      computeSessionReplayValidationReport(log.source, log.reference),
    );
  });
});
