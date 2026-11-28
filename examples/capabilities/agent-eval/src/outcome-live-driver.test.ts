import assert from 'node:assert/strict';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { countLeaksInPath } from './outcome-coding-credential.js';
import {
  DriverConfigError,
  runDriver,
  verifyCleanup,
  type IDriverConfig,
  type IDriverResult,
} from './outcome-live-driver.js';
import { PathGuardError, repositoryRoots } from './outcome-live-paths.js';
import {
  planSlots,
  slotKey,
  trialIdOf,
  type IHalt,
  type ITrialEnd,
  type TDriverEvent,
} from './outcome-live-plan.js';
import {
  makeHarness,
  SECRET,
  stubTrials,
  type IHarness,
  type ITrialScript,
} from './outcome-live-testing.js';

const exampleDir = join(import.meta.dirname, '..');

async function withHarness(
  run: (harness: IHarness) => Promise<void>,
  options: Parameters<typeof makeHarness>[0] = {},
): Promise<void> {
  const harness = await makeHarness(options);
  try {
    await run(harness);
  } finally {
    await harness.close();
  }
}

function events(harness: IHarness): TDriverEvent[] {
  return readFileSync(join(harness.evidence, 'events.jsonl'), 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as TDriverEvent);
}

const ends = (harness: IHarness): ITrialEnd[] =>
  events(harness).filter((event): event is ITrialEnd => event.type === 'trial-end');

const noChat = (harness: IHarness): void => assert.equal(harness.gateway.chatBodies.length, 0);

/** Runs the driver once with stub trials whose behavior the scripts decide. */
async function go(
  harness: IHarness,
  scriptFor: (index: number, control: boolean) => ITrialScript = () => ({ calls: [{}] }),
  patch: Partial<IDriverConfig> = {},
  lines: string[] = [],
  offset = 0,
): Promise<{ result: IDriverResult; seen: ReturnType<typeof stubTrials>['seen'] }> {
  const stub = stubTrials(
    (index, spec) => scriptFor(index + offset, spec.delegation === undefined),
    harness.gateway,
  );
  const result = await runDriver(
    harness.config(patch),
    harness.deps({ runTrial: stub.run, log: (line) => lines.push(line) }),
  );
  return { result, seen: stub.seen };
}

test('a complete run follows the plan order with equal caps and records every preflight check', async () => {
  await withHarness(async (harness) => {
    const lines: string[] = [];
    const { result, seen } = await go(harness, undefined, {}, lines);
    const { summary } = result;
    assert.equal(result.exitCode, 0, JSON.stringify(summary.halt));
    assert.equal(summary.finished, true);
    // 2 smoke trials, then 3 rounds of 2 tasks with both arms.
    assert.equal(seen.length, 14);
    const plan = planSlots({
      arms: ['delegation', 'control'],
      taskIds: ['navigation', 'bug-repair'],
      trialsPerTask: 3,
      smokeTaskId: 'navigation',
    });
    assert.deepEqual(
      seen.map((trial) => `${trial.arm}/${trial.taskId}`),
      plan.map((slot) => `${slot.arm}/${slot.taskId}`),
    );
    assert.ok(seen.every((trial) => trial.maxCalls === 20));
    assert.deepEqual(
      seen.slice(0, 2).map((trial) => trial.arm),
      ['delegation', 'control'],
    );
    const names = summary.preflight.map((check) => check.name);
    for (const expected of [
      'evidence and working paths are outside the repository',
      'decision rule fixed before the first call',
      'docker available',
      'credential present',
      'catalog lists the pinned model',
      'endpoint listing parses',
      'ledger basis covers the listed rates',
      'credits cover the next reservation',
      'worker image built and free of solutions and verifiers',
    ]) {
      assert.ok(names.includes(expected), expected);
    }
    assert.ok(summary.preflight.every((check) => check.ok));
    assert.equal(
      summary.preflight.find((check) => check.name === 'credential present')?.detail?.credential,
      'present',
    );
    assert.equal(
      summary.cleanup.every((check) => check.ok),
      true,
    );
    assert.equal(summary.leakScan?.leaks, 0);
    assert.ok((summary.leakScan?.filesScanned ?? 0) >= 3);
    // Settled cost is the receipts' sum; the bound against the ceiling is reported.
    assert.equal(summary.bound?.settledMicros, 14 * 1_000);
    assert.equal(summary.bound?.withinCeiling, true);
    assert.equal(summary.bound?.ceilingMicros, 2_000_000);
    assert.equal(summary.arms.delegation?.settledCostMicros, 6 * 1_000);
    assert.equal(summary.arms.delegation?.counted, 6);
    assert.equal(summary.arms.control?.counted, 6);
    // Nothing was sent anywhere: the stub never reaches the gateway's chat endpoint.
    noChat(harness);
    assert.ok(harness.gateway.allPaths.includes('GET /v1/models'));
    assert.ok(harness.gateway.allPaths.some((path) => path.endsWith('/endpoints')));
    assert.ok(harness.gateway.allPaths.includes('GET /v1/credits'));
    assert.ok(existsSync(result.summaryPath));
    assert.ok(existsSync(join(harness.evidence, 'preflight.json')));
    assert.ok(existsSync(join(harness.evidence, 'ledger.jsonl')));
    // The credential value is in no log line and no evidence file.
    assert.ok(lines.every((line) => !line.includes(SECRET)));
    assert.equal(countLeaksInPath(SECRET, harness.evidence).leaks, 0);
    assert.equal(summary.config.credential, 'present');
    assert.ok(!JSON.stringify(summary).includes(SECRET));
  });
});

test('the computed outcome comes from the counted trials: a total gain of two within range is justified', async () => {
  await withHarness(async (harness) => {
    let controlTrials = 0;
    const { result } = await go(harness, (index, control) => {
      if (index < 2 || !control) return { calls: [{}] };
      controlTrials += 1;
      // The control fails two of its six counted trials.
      return controlTrials <= 2 ? { calls: [{}], failures: ['verifier-failed'] } : { calls: [{}] };
    });
    assert.equal(result.summary.decision.totalPassDifference, 2);
    assert.equal(result.summary.outcome, 'justified');
    assert.equal(result.summary.decision.costRatio?.value, 1);
  });
});

test('delegation alone follows the same order with no control trials', async () => {
  await withHarness(async (harness) => {
    const { result, seen } = await go(harness, undefined, { arms: ['delegation'] });
    assert.equal(result.exitCode, 0);
    assert.equal(seen.length, 1 + 6);
    assert.ok(seen.every((trial) => trial.arm === 'delegation'));
    assert.equal(result.summary.decision.form, 'delegation-only');
  });
});

test('every other non-pass counts and is never replaced by a recovery trial', async () => {
  await withHarness(async (harness) => {
    const scripts: Record<number, ITrialScript> = {
      3: { calls: [{}], failures: ['call-cap'], capReached: true },
      4: { calls: [{}], failures: ['not-delegated'] },
      5: { calls: [{}], failures: ['not-completed', 'interrupted'] },
      6: { calls: [{}], failures: ['verifier-failed'] },
    };
    const { result, seen } = await go(harness, (index) => scripts[index] ?? { calls: [{}] });
    assert.equal(result.exitCode, 0);
    assert.equal(seen.length, 14);
    assert.ok(seen.every((trial) => trial.trialName.includes('-a1-')));
    assert.equal(result.summary.uncounted.infrastructureStops.length, 0);
    const counted = [result.summary.arms.delegation?.counted, result.summary.arms.control?.counted];
    assert.deepEqual(counted, [6, 6]);
    const failures = { ...result.summary.arms.delegation?.failureCounts };
    for (const [name, count] of Object.entries(result.summary.arms.control?.failureCounts ?? {})) {
      failures[name] = (failures[name] ?? 0) + count;
    }
    assert.equal(failures['call-cap'], 1);
    assert.equal(failures['not-delegated'], 1);
    assert.equal(failures['verifier-failed'], 1);
  });
});

test('a container or verifier error halts the run; one recovery trial replaces it after --resume', async () => {
  await withHarness(async (harness) => {
    const first = await go(harness, (index) =>
      index === 3 ? { throws: 'docker run failed' } : { calls: [{}] },
    );
    assert.equal(first.result.exitCode, 1);
    assert.equal(first.result.summary.halt?.kind, 'container-error');
    assert.equal(first.seen.length, 4);
    const stop = ends(harness).at(-1) as ITrialEnd;
    assert.equal(stop.outcome, 'infra-stop');
    assert.equal(stop.stopKind, 'container-error');
    assert.equal(first.result.summary.finished, false);
    // The halt carries the ledger state.
    assert.equal((events(harness).at(-1) as IHalt).ledger?.callsAdmitted, 3);

    const second = await go(harness, () => ({ calls: [{}] }), { resume: true });
    assert.equal(second.result.exitCode, 0, JSON.stringify(second.result.summary.halt));
    assert.equal(second.result.summary.finished, true);
    // The recovery trial is the same task and arm as the stopped one, attempt two.
    assert.equal(second.seen[0]?.taskId, stop.taskId);
    assert.equal(second.seen[0]?.arm, stop.arm);
    const recoveryId = trialIdOf(
      { kind: stop.kind, arm: stop.arm, taskId: stop.taskId, round: stop.round },
      2,
    );
    assert.ok(second.seen[0]?.trialName.includes(recoveryId));
    assert.equal(second.seen.length, 14 - 3);
    const stops = second.result.summary.uncounted.infrastructureStops;
    assert.equal(stops.length, 1);
    assert.equal(stops[0]?.recoveryTrialId, recoveryId);
    // Still exactly three counted trials per task and arm.
    assert.equal(second.result.summary.arms.delegation?.counted, 6);
    assert.equal(second.result.summary.arms.control?.counted, 6);
  });
});

test('a recovery trial that stops again earns its own recovery, one per stop', async () => {
  await withHarness(async (harness) => {
    await go(harness, (index) => (index === 3 ? { throws: 'first' } : { calls: [{}] }));
    const again = await go(harness, () => ({ throws: 'second' }), { resume: true });
    assert.equal(again.seen.length, 1);
    assert.equal(again.result.summary.halt?.kind, 'container-error');
    const third = await go(harness, () => ({ calls: [{}] }), { resume: true });
    assert.ok(third.seen[0]?.trialName.includes('-a3-'));
    assert.equal(third.result.summary.uncounted.infrastructureStops.length, 2);
    assert.equal(third.result.exitCode, 0);
  });
});

test('a spend-gate stop (a receipt from another provider) halts the run and is replaced after --resume', async () => {
  await withHarness(async (harness) => {
    const first = await go(harness, (index) =>
      index === 2 ? { calls: [{}, { provider: 'some-other-route' }] } : { calls: [{}] },
    );
    assert.equal(first.result.exitCode, 1);
    assert.equal(first.result.summary.halt?.kind, 'spend-gate');
    assert.match(first.result.summary.halt?.reason ?? '', /provider differs/);
    const stop = ends(harness).at(-1) as ITrialEnd;
    assert.equal(stop.outcome, 'infra-stop');
    assert.equal(stop.stopKind, 'spend-gate');
    assert.equal(stop.callsAdmitted, 2);
    assert.match(
      String((first.result.summary.ledger?.state as { stopReason?: string }).stopReason),
      /provider differs/,
    );
    // Both calls had receipts, so nothing is unsettled and --resume alone lifts the stop.
    const second = await go(harness, () => ({ calls: [{}] }), { resume: true });
    assert.equal(second.result.exitCode, 0, JSON.stringify(second.result.summary.halt));
    assert.ok(second.seen[0]?.trialName.includes('-a2-'));
    noChat(harness);
  });
});

test('a model mismatch, a cost overrun and a non-success status each stop the run with no retry', async () => {
  for (const call of [{ model: 'another-model' }, { cost: 5 }, { status: 503 }]) {
    await withHarness(async (harness) => {
      const { result, seen } = await go(harness, (index) =>
        index === 0 ? { calls: [call] } : { calls: [{}] },
      );
      assert.equal(result.summary.halt?.kind, 'spend-gate', JSON.stringify(call));
      assert.equal(seen.length, 1);
      assert.equal(result.exitCode, 1);
    });
  }
});

test('--resume refuses while a call has no receipt, unless --reconcile settles it at its reservation', async () => {
  await withHarness(async (harness) => {
    const first = await go(harness, (index) =>
      index === 1 ? { calls: [{ noAnswer: true }] } : { calls: [{}] },
    );
    assert.equal(first.result.summary.halt?.kind, 'spend-gate');
    const unsettled = (first.result.summary.ledger?.state as { unsettledIds: number[] })
      .unsettledIds;
    assert.equal(unsettled.length, 1);
    const stop = ends(harness).at(-1) as ITrialEnd;
    assert.equal(stop.callsWithoutReceipt, 1);

    const refused = await go(harness, () => ({ calls: [{}] }), { resume: true });
    assert.equal(refused.seen.length, 0);
    assert.equal(refused.result.exitCode, 1);
    assert.ok(
      refused.result.summary.preflight.some(
        (check) => check.name === 'no unsettled ledger entries' && !check.ok,
      ),
    );

    const reconciled = await go(harness, () => ({ calls: [{}] }), {
      resume: true,
      reconcile: true,
    });
    assert.equal(reconciled.result.exitCode, 0, JSON.stringify(reconciled.result.summary.halt));
    assert.equal(reconciled.result.summary.reconciled.length, 1);
    assert.equal(reconciled.result.summary.reconciled[0]?.id, unsettled[0]);
    // The reservation stays committed: the settled total now includes it.
    assert.ok((reconciled.result.summary.bound?.settledMicros as number) > 13 * 1_000);
  });
});

test('an unattributed call is the agent’s failure: counted, the run halts, and --resume carries on without a replacement', async () => {
  await withHarness(async (harness) => {
    const first = await go(harness, (index) =>
      index === 3
        ? { calls: [{}], failures: ['run-stopped'], relayStop: 'unattributed call: no role marker' }
        : { calls: [{}] },
    );
    assert.equal(first.result.summary.halt?.kind, 'unattributed');
    assert.equal(first.result.exitCode, 1);
    const last = ends(harness).at(-1) as ITrialEnd;
    assert.equal(last.outcome, 'fail');
    const second = await go(harness, () => ({ calls: [{}] }), { resume: true });
    assert.equal(second.result.exitCode, 0);
    assert.ok(second.seen.every((trial) => trial.trialName.includes('-a1-')));
    assert.equal(second.seen.length, 14 - 4);
    assert.equal(second.result.summary.uncounted.infrastructureStops.length, 0);
    const counted =
      (second.result.summary.arms.delegation?.counted ?? 0) +
      (second.result.summary.arms.control?.counted ?? 0);
    assert.equal(counted, 12);
    assert.equal(
      (second.result.summary.arms.delegation?.failureCounts['run-stopped'] ?? 0) +
        (second.result.summary.arms.control?.failureCounts['run-stopped'] ?? 0),
      1,
    );
  });
});

test('a refused admission is an automatic stop: the failure counts and the run goes no further', async () => {
  await withHarness(async (harness) => {
    const { result, seen } = await go(
      harness,
      (index) => (index === 3 ? { calls: [{}], failures: ['not-completed'] } : { calls: [{}] }),
      { callCap: 3 },
    );
    assert.equal(result.summary.halt?.kind, 'admission-refused');
    assert.match(result.summary.halt?.reason ?? '', /call cap/);
    assert.equal(seen.length, 4);
    assert.equal(seen[3]?.admissions.length, 1);
    assert.match(seen[3]?.admissions[0] ?? '', /call cap is reached/);
    assert.equal(result.exitCode, 1);
    assert.equal((result.summary.bound as { callsAdmitted: number }).callsAdmitted, 3);
  });
});

test('the credits are checked before each trial; a drop below the next reservation stops the run', async () => {
  await withHarness(async (harness) => {
    const { result, seen } = await go(harness, (index) => {
      if (index === 2) {
        harness.gateway.credits = { data: { total_credits: 0.0001, total_usage: 0 } };
      }
      return { calls: [{}] };
    });
    assert.equal(result.summary.halt?.kind, 'credits');
    assert.equal(seen.length, 3);
    assert.equal(result.exitCode, 1);
  });
});

test('a failed preflight stops before any call, creates no ledger and records the checks', async () => {
  const cases: {
    readonly name: string;
    readonly harness?: Parameters<typeof makeHarness>[0];
    readonly patch?: Partial<IDriverConfig>;
    readonly prepare?: (harness: IHarness) => void;
    readonly kind: string;
    readonly failed: RegExp;
  }[] = [
    {
      name: 'credential line absent',
      harness: { credentialText: 'OTHER=1\n' },
      kind: 'preflight',
      failed: /credential present/,
    },
    {
      name: 'credential line repeated',
      harness: { credentialText: `GATEWAY_KEY=a\nGATEWAY_KEY=b\n` },
      kind: 'preflight',
      failed: /credential present/,
    },
    {
      name: 'docker unavailable',
      prepare: (harness) => {
        (harness.docker as { available: () => boolean }).available = () => false;
      },
      kind: 'preflight',
      failed: /docker available/,
    },
    {
      name: 'model no longer listed',
      patch: { model: 'missing-model' },
      kind: 'catalog',
      failed: /catalog lists/,
    },
    {
      name: 'basis below the listed rates',
      patch: { basis: { promptMicrosPerMillionTokens: 1, completionMicrosPerMillionTokens: 1 } },
      kind: 'catalog',
      failed: /basis covers/,
    },
    {
      name: 'credits too low',
      prepare: (harness) => {
        harness.gateway.credits = { data: { total_credits: 0.0001, total_usage: 0 } };
      },
      kind: 'credits',
      failed: /credits cover/,
    },
    {
      name: 'listing malformed',
      prepare: (harness) => {
        harness.gateway.listing = { data: {} };
      },
      kind: 'catalog',
      failed: /endpoint listing/,
    },
  ];
  for (const scenario of cases) {
    await withHarness(async (harness) => {
      scenario.prepare?.(harness);
      const stub = stubTrials(undefined, harness.gateway);
      const result = await runDriver(
        harness.config(scenario.patch),
        harness.deps({ runTrial: stub.run }),
      );
      assert.equal(result.exitCode, 1, scenario.name);
      assert.equal(result.summary.halt?.kind, scenario.kind, scenario.name);
      assert.equal(result.summary.halt?.ledger, undefined, scenario.name);
      assert.match(result.summary.halt?.reason ?? '', scenario.failed, scenario.name);
      assert.equal(stub.seen.length, 0, scenario.name);
      assert.equal(existsSync(join(harness.evidence, 'ledger.jsonl')), false, scenario.name);
      noChat(harness);
      const failed = result.summary.preflight.filter((check) => !check.ok);
      assert.equal(failed.length, 1, scenario.name);
      assert.ok(existsSync(join(harness.evidence, 'preflight.json')));
      assert.equal(countLeaksInPath(SECRET, harness.evidence).leaks, 0);
    }, scenario.harness);
  }
});

test('a real run without the decision rule is refused before anything is touched', async () => {
  await withHarness(async (harness) => {
    for (const decisionRuleUrl of [
      undefined,
      'https://example.test/owner/repo/issues/1',
      'http://example.test/x#issuecomment-1',
      'https://example.test/x#issuecomment-abc',
    ]) {
      const stub = stubTrials(undefined, harness.gateway);
      await assert.rejects(
        runDriver(
          { ...harness.config(), decisionRuleUrl } as IDriverConfig,
          harness.deps({ runTrial: stub.run }),
        ),
        (error: Error) => error instanceof DriverConfigError && /decision-rule/.test(error.message),
      );
      assert.equal(stub.seen.length, 0);
    }
    assert.equal(existsSync(harness.evidence), false);
    assert.deepEqual(harness.gateway.allPaths, []);
  });
});

test('a dry run does not need the decision rule, and a real run needs its credential flags', async () => {
  await withHarness(async (harness) => {
    const noCredential = { ...harness.config() } as Record<string, unknown>;
    delete noCredential.credentialFile;
    delete noCredential.credentialName;
    await assert.rejects(
      runDriver(noCredential as unknown as IDriverConfig, harness.deps()),
      /credential-file/,
    );
    const { result } = await go(harness, undefined, {
      dryRun: true,
      decisionRuleUrl: undefined,
      credentialFile: undefined,
      credentialName: undefined,
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.summary.config.credential, 'present');
    assert.equal(
      result.summary.preflight.find((check) => check.name === 'credential present')?.detail
        ?.credential,
      'fake, dry run',
    );
  });
});

test('configurations the driver refuses', async () => {
  await withHarness(async (harness) => {
    const bad: [Partial<IDriverConfig>, RegExp][] = [
      [{ arms: ['control'] }, /delegation arm is required/],
      [{ arms: [] }, /arms must be/],
      [{ arms: ['delegation', 'delegation'] }, /listed twice/],
      [{ trialCap: 0 }, /trial cap/],
      [{ callCap: 1.5 }, /call cap/],
      [{ ceilingMicros: 0 }, /ceiling/],
      [{ endpoint: 'https://gateway.example/v1/models' }, /endpoint must end/],
      [{ reconcile: true }, /only applies with --resume/],
      [{ credentialName: undefined }, /credential/],
    ];
    for (const [patch, message] of bad) {
      await assert.rejects(
        runDriver({ ...harness.config(), ...patch }, harness.deps()),
        (error: Error) => error instanceof DriverConfigError && message.test(error.message),
        JSON.stringify(patch),
      );
    }
    assert.equal(existsSync(harness.evidence), false);
  });
});

test('an evidence folder inside the repository, or the temporary directory in a real run, is refused', async () => {
  await withHarness(async (harness) => {
    const [root] = repositoryRoots(exampleDir);
    const inside = join(root as string, 'evidence-must-not-exist');
    await assert.rejects(
      runDriver(harness.config({ evidenceDir: inside }), harness.deps()),
      PathGuardError,
    );
    assert.equal(existsSync(inside), false);
    await assert.rejects(
      runDriver(
        harness.config({ baseDir: join(root as string, 'work-must-not-exist') }),
        harness.deps(),
      ),
      PathGuardError,
    );
    await assert.rejects(
      runDriver(harness.config(), harness.deps({ allowTemporaryPaths: false })),
      /temporary directory/,
    );
    assert.equal(existsSync(harness.evidence), false);
    // A credential file in the repository is refused too.
    await assert.rejects(
      runDriver(
        harness.config({ credentialFile: join(root as string, 'credentials.env') }),
        harness.deps(),
      ),
      /credential file must be outside/,
    );
  });
});

test('resume needs the earlier ledger; a fresh run refuses a folder that already holds one', async () => {
  await withHarness(async (harness) => {
    await assert.rejects(
      runDriver(harness.config({ resume: true }), harness.deps()),
      /--resume needs the ledger/,
    );
    const done = await go(harness);
    assert.equal(done.result.exitCode, 0);
    await assert.rejects(go(harness), /already holds a ledger/);
  });
});

test('--resume refuses a ledger whose header differs from this run', async () => {
  await withHarness(async (harness) => {
    await go(harness, (index) => (index === 2 ? { throws: 'stop here' } : { calls: [{}] }));
    for (const patch of [
      { callCap: 399 },
      { ceilingMicros: 1_999_999 },
      { provider: 'route-a2' },
    ]) {
      const again = await go(harness, undefined, { resume: true, ...patch });
      assert.equal(again.seen.length, 0, JSON.stringify(patch));
      assert.equal(again.result.exitCode, 1);
    }
    // A different pinned commit is a different run too.
    const stub = stubTrials(undefined, harness.gateway);
    const other = await runDriver(
      harness.config({ resume: true }),
      harness.deps({
        runTrial: stub.run,
        prepareRuntime: async () => ({
          commit: 'different',
          launch: () => {
            throw new Error('unused');
          },
          verify: async () => {
            throw new Error('unused');
          },
          dispose: () => undefined,
        }),
      }),
    );
    assert.equal(stub.seen.length, 0);
    assert.ok(
      other.summary.preflight.some(
        (check) => check.name === 'ledger header matches this run' && !check.ok,
      ),
    );
  });
});

test('a trial that started and never ended is an infrastructure stop on resume, replaced by one recovery trial', async () => {
  await withHarness(async (harness) => {
    await go(harness, (index) => (index === 3 ? { throws: 'stop' } : { calls: [{}] }));
    const stop = ends(harness).at(-1) as ITrialEnd;
    const slot = { kind: stop.kind, arm: stop.arm, taskId: stop.taskId, round: stop.round };
    // The recovery trial started, and the process died in the middle of it.
    appendFileSync(
      join(harness.evidence, 'events.jsonl'),
      `${JSON.stringify({ type: 'trial-start', trialId: trialIdOf(slot, 2), slotKey: slotKey(slot), attempt: 2, at: 'x' })}\n`,
    );
    const resumed = await go(harness, () => ({ calls: [{}] }), { resume: true });
    assert.ok(resumed.seen[0]?.trialName.includes('-a3-'));
    const interrupted = ends(harness).find((end) => end.stopKind === 'interrupted');
    assert.ok(interrupted !== undefined);
    assert.equal(resumed.result.exitCode, 0);
  });
});

test('an unreadable events file is refused, not skipped', async () => {
  await withHarness(async (harness) => {
    mkdirSync(harness.evidence, { recursive: true });
    writeFileSync(join(harness.evidence, 'events.jsonl'), '{"type":"note"\n');
    await assert.rejects(go(harness), /unreadable line/);
  });
});

test('an error that echoes the credential is redacted before it is recorded', async () => {
  await withHarness(async (harness) => {
    const { result } = await go(harness, (index) =>
      index === 0 ? { throws: `request failed with key ${SECRET}` } : { calls: [{}] },
    );
    assert.equal(result.summary.halt?.kind, 'container-error');
    const stop = ends(harness)[0] as ITrialEnd;
    assert.ok(!(stop.error ?? '').includes(SECRET));
    assert.equal(countLeaksInPath(SECRET, harness.evidence).leaks, 0);
  });
});

test('the leak scan counts a planted credential in the evidence folder and fails the run, reporting only a count', async () => {
  await withHarness(async (harness) => {
    const { result } = await go(harness, (index) => ({
      calls: [{}],
      run: () => {
        if (index === 2) writeFileSync(join(harness.evidence, 'planted.txt'), `key=${SECRET}\n`);
      },
    }));
    assert.ok((result.summary.leakScan?.leaks ?? 0) >= 1);
    assert.equal(result.exitCode, 1);
    const text = readFileSync(result.summaryPath, 'utf8');
    assert.ok(!text.includes(SECRET));
    assert.match(text, /"leaks": [1-9]/);
  });
});

test('cleanup verification fails the run when a container, image, network or volume is left behind', async () => {
  await withHarness(async (harness) => {
    harness.docker.leftover = true;
    const { result } = await go(harness);
    assert.equal(result.exitCode, 1);
    const failed = result.summary.cleanup.filter((check) => !check.ok);
    assert.deepEqual(
      failed.map((check) => check.name),
      ['no container left behind'],
    );
    assert.deepEqual(failed[0]?.detail?.added, ['leftover-container']);
  });
});

test('cleanup checks: a leftover working or trial directory, and a credential copy, are found', () => {
  const base = mkdtempSync(join(realpathSync(tmpdir()), 'cleanup-test-'));
  try {
    const snapshot = { containers: [], images: [], networks: [], volumes: [] };
    const run = (workDir: string | undefined, before: string[] = []) =>
      verifyCleanup({
        before: snapshot,
        after: snapshot,
        workDir,
        baseDir: base,
        workEntriesBefore: before,
        secret: SECRET,
      });
    assert.ok(run(undefined).every((check) => check.ok));
    const work = join(base, '.coding-live-left');
    mkdirSync(work);
    writeFileSync(join(work, 'copy.txt'), `value ${SECRET}`);
    const failed = run(work)
      .filter((check) => !check.ok)
      .map((check) => check.name);
    assert.deepEqual(failed, [
      'working directory removed',
      'no trial or working directory left in the base directory',
      'no credential copy left',
    ]);
    assert.equal(run(work, ['.coding-live-left']).filter((check) => !check.ok).length, 2);
    rmSync(work, { recursive: true });
    mkdirSync(join(base, '.coding-trial-left'));
    assert.deepEqual(
      run(undefined)
        .filter((check) => !check.ok)
        .map((check) => check.name),
      ['no trial or working directory left in the base directory'],
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('the run’s working directory is removed and no work entry is left in the base directory', async () => {
  await withHarness(async (harness) => {
    const { result } = await go(harness);
    assert.equal(result.exitCode, 0);
    assert.deepEqual(readdirSync(harness.base), []);
  });
});

test('a refused admission stops the ledger at once, and a trial that passed stays a pass', async () => {
  await withHarness(async (harness) => {
    const { result } = await go(harness, () => ({ calls: [{}] }), { callCap: 3 });
    assert.equal(result.summary.halt?.kind, 'admission-refused');
    assert.match(
      String((result.summary.ledger?.state as { stopReason?: string }).stopReason),
      /admission refused/,
    );
    // The stub's trial passes by the verifier's verdict although its call was refused.
    const last = ends(harness).at(-1) as ITrialEnd;
    assert.equal(last.outcome, 'pass');
  });
});

test('a real run and a dry run never share an evidence folder', async () => {
  for (const firstDry of [true, false]) {
    await withHarness(async (harness) => {
      const modePatch = (dry: boolean): Partial<IDriverConfig> => ({
        dryRun: dry,
        ...(dry ? { decisionRuleUrl: undefined } : {}),
      });
      const first = await go(
        harness,
        (index) => (index === 2 ? { throws: 'stop' } : { calls: [{}] }),
        modePatch(firstDry),
      );
      assert.equal(first.result.exitCode, 1);
      await assert.rejects(
        go(harness, undefined, { resume: true, ...modePatch(!firstDry) }),
        /cannot use it/,
      );
      // The same mode resumes normally.
      const same = await go(harness, undefined, { resume: true, ...modePatch(firstDry) });
      assert.equal(same.result.exitCode, 0);
    });
  }
});

test('the credential-copy check scans a trial folder left behind', () => {
  const base = mkdtempSync(join(realpathSync(tmpdir()), 'cleanup-copy-test-'));
  try {
    mkdirSync(join(base, '.coding-trial-left'));
    writeFileSync(join(base, '.coding-trial-left', 'copy.txt'), SECRET);
    const snapshot = { containers: [], images: [], networks: [], volumes: [] };
    const checks = verifyCleanup({
      before: snapshot,
      after: snapshot,
      workDir: undefined,
      baseDir: base,
      workEntriesBefore: [],
      secret: SECRET,
    });
    const copy = checks.find((check) => check.name === 'no credential copy left');
    assert.equal(copy?.ok, false);
    assert.equal(copy?.detail?.copies, 1);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
