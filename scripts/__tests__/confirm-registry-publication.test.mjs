import { describe, expect, it } from 'vitest';

import {
  REGISTRY_POLL_INTERVAL_MS,
  REGISTRY_WAIT_LIMIT_MS,
  confirmRegistryPublication,
  installLockThroughRegistryLag,
} from '../publish/confirm-registry-publication.mjs';

const pkg = { name: '@robota-sdk/agent-core', version: '3.3.1', integrity: 'sha512-reviewed' };
const registry = 'https://registry.example/';

const ready = {
  versions: { [pkg.version]: { dist: { integrity: pkg.integrity } } },
  'dist-tags': { latest: pkg.version },
};
const lagging = {
  versions: { '3.3.0': { dist: { integrity: 'sha512-old' } } },
  'dist-tags': { latest: '3.3.0' },
};
const staleLatest = { ...ready, 'dist-tags': { latest: '3.3.0' } };
const otherBytes = {
  versions: { [pkg.version]: { dist: { integrity: 'sha512-other' } } },
  'dist-tags': { latest: pkg.version },
};
const http = (status) => ({ ok: false, status });

/** A registry that answers the scripted observations in order, then repeats the last one. */
function scenario(observations, options = {}) {
  const clock = { time: 0 };
  const requests = [];
  const sleeps = [];
  const fetchImpl = async (url, init) => {
    const next = observations[Math.min(requests.length, observations.length - 1)];
    requests.push({ url: String(url), accept: init.headers.accept });
    if (next instanceof Error) throw next;
    return next.ok === false
      ? next
      : { ok: true, status: 200, json: async () => structuredClone(next) };
  };
  const sleep = async (ms) => {
    sleeps.push(ms);
    clock.time += ms;
  };
  const confirm = () =>
    confirmRegistryPublication(pkg, registry, {
      fetchImpl,
      sleep,
      now: () => clock.time,
      ...options,
    });
  return { confirm, requests, sleeps };
}

describe('registry publication confirmation', () => {
  it('returns after one request when the registry already serves the version as latest', async () => {
    const { confirm, requests, sleeps } = scenario([ready]);
    await confirm();
    expect(requests).toEqual([
      {
        url: 'https://registry.example/%40robota-sdk%2Fagent-core',
        accept: 'application/vnd.npm.install-v1+json',
      },
    ]);
    expect(sleeps).toEqual([]);
  });

  it('waits through registry lag until the version appears', async () => {
    const { confirm, requests, sleeps } = scenario([lagging, lagging, lagging, ready]);
    await confirm();
    expect(requests).toHaveLength(4);
    expect(sleeps).toEqual([
      REGISTRY_POLL_INTERVAL_MS,
      REGISTRY_POLL_INTERVAL_MS,
      REGISTRY_POLL_INTERVAL_MS,
    ]);
  });

  it('waits while latest still names the previous version', async () => {
    const { confirm, requests } = scenario([staleLatest, staleLatest, ready]);
    await confirm();
    expect(requests).toHaveLength(3);
  });

  it('treats an HTTP error and a network failure as lag', async () => {
    const { confirm, requests, sleeps } = scenario([
      http(503),
      new Error('socket hang up'),
      http(404),
      ready,
    ]);
    await confirm();
    expect(requests).toHaveLength(4);
    expect(sleeps).toHaveLength(3);
  });

  it('fails at once, without waiting, when the listed version has other bytes', async () => {
    const { confirm, requests, sleeps } = scenario([otherBytes, ready]);
    await expect(confirm()).rejects.toThrow(
      /agent-core@3\.3\.1: registry integrity sha512-other differs from the reviewed tarball sha512-reviewed/u,
    );
    expect(requests).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it('fails at once when other bytes appear after earlier lag, and when integrity is missing', async () => {
    const afterLag = scenario([lagging, otherBytes, ready]);
    await expect(afterLag.confirm()).rejects.toThrow(/differs from the reviewed tarball/u);
    expect(afterLag.requests).toHaveLength(2);
    expect(afterLag.sleeps).toHaveLength(1);

    const noIntegrity = scenario([{ ...ready, versions: { [pkg.version]: { dist: {} } } }]);
    await expect(noIntegrity.confirm()).rejects.toThrow(/registry integrity missing differs/u);
    expect(noIntegrity.sleeps).toEqual([]);
  });

  it('stops at the limit and states how long it waited and what was still pending', async () => {
    const { confirm, requests, sleeps } = scenario([lagging], {
      intervalMs: 15_000,
      limitMs: 60_000,
    });
    await expect(confirm()).rejects.toThrow(
      '@robota-sdk/agent-core@3.3.1: registry integrity/latest not yet confirmed after waiting 60 s ' +
        '(version not listed yet); resume this run without repacking.',
    );
    expect(requests).toHaveLength(5);
    expect(sleeps).toHaveLength(4);
  });

  it('reports the last observation when the registry never answers', async () => {
    const { confirm } = scenario([http(503)], { limitMs: 30_000 });
    await expect(confirm()).rejects.toThrow(/after waiting 30 s \(registry returned 503\)/u);
    const stale = scenario([staleLatest], { limitMs: 30_000 });
    await expect(stale.confirm()).rejects.toThrow(/after waiting 30 s \(latest is 3\.3\.0\)/u);
  });

  it('waits twenty minutes by default', async () => {
    expect(REGISTRY_WAIT_LIMIT_MS).toBe(20 * 60_000);
    const { confirm, requests } = scenario([lagging]);
    await expect(confirm()).rejects.toThrow(/not yet confirmed after waiting 1200 s/u);
    expect(requests).toHaveLength(REGISTRY_WAIT_LIMIT_MS / REGISTRY_POLL_INTERVAL_MS + 1);
  });
});

const lagStderr = (name = pkg.name, version = pkg.version) =>
  `npm error code ETARGET\nnpm error notarget No matching version found for ${name}@${version}.\n`;
const lagged = { status: 1, stderr: lagStderr() };
const installed = { status: 0, stderr: '' };

/** An npm that answers the scripted results in order, then repeats the last one; a result may throw. */
function lockScenario(results, options = {}) {
  const clock = { time: options.startAt ?? 0 };
  const calls = [];
  const sleeps = [];
  const runNpm = async (args) => {
    const next = results[Math.min(calls.length, results.length - 1)];
    calls.push(args);
    if (next instanceof Error) throw next;
    return next;
  };
  const sleep = async (ms) => {
    sleeps.push(ms);
    clock.time += ms;
  };
  const install = () =>
    installLockThroughRegistryLag([pkg], registry, runNpm, {
      sleep,
      now: () => clock.time,
      ...options.limits,
    });
  return { install, calls, sleeps, clock };
}

describe('release lock generation through registry lag', () => {
  it('runs the command once when npm resolves the version at once', async () => {
    const { install, calls, sleeps } = lockScenario([installed]);
    await install();
    expect(calls).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it('revalidates cached metadata and keeps the rest of the release lock command', async () => {
    const { install, calls } = lockScenario([installed]);
    await install();
    expect(calls[0]).toEqual([
      'install',
      '--package-lock-only',
      '--omit=dev',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--prefer-online',
      '--registry',
      registry,
    ]);
  });

  it('waits one interval after a missing-version answer and then succeeds', async () => {
    const { install, calls, sleeps } = lockScenario([lagged, installed]);
    await install();
    expect(calls).toHaveLength(2);
    expect(sleeps).toEqual([REGISTRY_POLL_INTERVAL_MS]);
  });

  it('stops at the limit with the lag message after retrying every interval', async () => {
    const { install, calls, sleeps } = lockScenario([lagged], {
      limits: { intervalMs: 15_000, limitMs: 60_000 },
    });
    await expect(install()).rejects.toThrow(
      '@robota-sdk/agent-core@3.3.1: npm install still finds no matching version after waiting 60 s ' +
        'although the registry listed it; resume this run without repacking.',
    );
    expect(calls).toHaveLength(5);
    expect(sleeps).toEqual([15_000, 15_000, 15_000, 15_000]);
  });

  it('counts the time the confirmation already spent and never waits past the limit', async () => {
    const { install, calls, sleeps, clock } = lockScenario([lagged], {
      startAt: 50_000,
      limits: { started: 0, intervalMs: 15_000, limitMs: 60_000 },
    });
    await expect(install()).rejects.toThrow(/after waiting 60 s/u);
    expect(calls).toHaveLength(2);
    expect(sleeps).toEqual([10_000]);
    expect(clock.time).toBe(60_000);
  });

  it('still tries once when the confirmation used the whole bound', async () => {
    const spent = lockScenario([installed], {
      startAt: 80_000,
      limits: { started: 0, limitMs: 60_000 },
    });
    await spent.install();
    expect(spent.calls).toHaveLength(1);
    const failing = lockScenario([lagged], {
      startAt: 80_000,
      limits: { started: 0, limitMs: 60_000 },
    });
    await expect(failing.install()).rejects.toThrow(/after waiting 80 s/u);
    expect(failing.calls).toHaveLength(1);
    expect(failing.sleeps).toEqual([]);
  });

  it('waits twenty minutes by default', async () => {
    const { install, calls } = lockScenario([lagged]);
    await expect(install()).rejects.toThrow(/after waiting 1200 s/u);
    expect(calls).toHaveLength(REGISTRY_WAIT_LIMIT_MS / REGISTRY_POLL_INTERVAL_MS + 1);
  });

  it('fails at once, without waiting or retrying, on any other npm failure', async () => {
    const failures = [
      {
        status: 1,
        stderr: 'npm error code E404\nnpm error 404 Not Found - GET https://registry.example/x\n',
      },
      { status: 1, stderr: 'npm error code EINTEGRITY\n' },
      { status: 1, stderr: '' },
      { status: null, stderr: undefined },
      // The same words under another code are not the lag signature.
      { status: 1, stderr: `npm error code E404\n${lagStderr().split('\n')[1]}\n` },
      // A missing version of a package that is not being released is a real error.
      { status: 1, stderr: lagStderr('@robota-sdk/agent-sessions', pkg.version) },
      { status: 1, stderr: lagStderr(pkg.name, '3.3.10') },
    ];
    for (const failure of failures) {
      const { install, calls, sleeps } = lockScenario([failure, installed]);
      await expect(install()).rejects.toThrow(/^npm install failed with exit status/u);
      expect(calls).toHaveLength(1);
      expect(sleeps).toEqual([]);
    }
  });

  it('fails at once when the command cannot run or times out', async () => {
    const { install, calls, sleeps } = lockScenario([
      Object.assign(new Error('spawnSync npm ETIMEDOUT'), { code: 'ETIMEDOUT' }),
      installed,
    ]);
    await expect(install()).rejects.toThrow('spawnSync npm ETIMEDOUT');
    expect(calls).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it('fails at once when a different failure follows earlier lag', async () => {
    const { install, calls, sleeps } = lockScenario([
      lagged,
      { status: 1, stderr: 'npm error code E401\n' },
      installed,
    ]);
    await expect(install()).rejects.toThrow(/^npm install failed with exit status 1/u);
    expect(calls).toHaveLength(2);
    expect(sleeps).toHaveLength(1);
  });
});
