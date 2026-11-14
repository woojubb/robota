import { describe, expect, it } from 'vitest';

import {
  REGISTRY_POLL_INTERVAL_MS,
  REGISTRY_WAIT_LIMIT_MS,
  confirmRegistryPublication,
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
