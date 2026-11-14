// The registry serves a freshly published version after a delay (usually minutes, rarely longer), so a
// single observation right after upload fails on lag. Wait inside the publish job instead, within a bound.
// The release lock generation shares that bound: `npm install` resolves versions through its own registry
// view and cache, which can still answer "no matching version" after the install metadata listed the version.
export const REGISTRY_POLL_INTERVAL_MS = 15_000;
export const REGISTRY_WAIT_LIMIT_MS = 20 * 60_000;
const REQUEST_TIMEOUT_MS = 15_000;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Returns what is still pending, or undefined once the registry serves the reviewed version as `latest`.
// Throws when the version is listed with other bytes: that is a mismatch, not lag.
async function observe(pkg, url, fetchImpl) {
  let metadata;
  try {
    const response = await fetchImpl(url, {
      headers: { accept: 'application/vnd.npm.install-v1+json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return `registry returned ${response.status}`;
    metadata = await response.json();
  } catch (error) {
    return `registry request failed: ${error.message}`;
  }
  const published = metadata?.versions?.[pkg.version];
  if (!published) return 'version not listed yet';
  if (published.dist?.integrity !== pkg.integrity)
    throw new Error(
      `${pkg.name}@${pkg.version}: registry integrity ${published.dist?.integrity ?? 'missing'} differs from the reviewed tarball ${pkg.integrity}; refusing to certify it.`,
    );
  const latest = metadata['dist-tags']?.latest;
  return latest === pkg.version ? undefined : `latest is ${latest ?? 'unset'}`;
}

/**
 * Resolves once the registry serves `pkg.version` with the reviewed tarball integrity and as `latest`.
 * Lag (a failed request, a missing version, a stale `latest`) is retried until the limit; a version
 * listed with different bytes fails at once.
 */
export async function confirmRegistryPublication(pkg, registry, options = {}) {
  const {
    fetchImpl = fetch,
    sleep = wait,
    now = Date.now,
    intervalMs = REGISTRY_POLL_INTERVAL_MS,
    limitMs = REGISTRY_WAIT_LIMIT_MS,
  } = options;
  const url = new URL(encodeURIComponent(pkg.name), `${registry.replace(/\/$/, '')}/`);
  const started = now();
  for (;;) {
    const pending = await observe(pkg, url, fetchImpl);
    if (pending === undefined) return;
    const waited = now() - started;
    if (waited >= limitMs)
      throw new Error(
        `${pkg.name}@${pkg.version}: registry integrity/latest not yet confirmed after waiting ${Math.round(waited / 1000)} s (${pending}); resume this run without repacking.`,
      );
    await sleep(intervalMs);
  }
}

// The released package whose exact version npm reports as missing, or undefined for any other failure.
function laggingPackage(roots, stderr) {
  if (!/\bETARGET\b/u.test(stderr)) return undefined;
  const missing = [...stderr.matchAll(/No matching version found for (\S+?)\.?(?:\s|$)/gu)].map(
    (match) => match[1],
  );
  return roots.find((pkg) => missing.includes(`${pkg.name}@${pkg.version}`));
}

/**
 * Runs the release lock `npm install` through `runNpm(args)` (returning `{ status, stderr }`, or throwing)
 * and retries it while npm reports one of the released versions as missing: that is registry lag, within the
 * same bound as the confirmation, measured from `started` so the time the confirmation spent counts.
 * Any other failure, including a command that cannot run or times out, fails at once.
 */
export async function installLockThroughRegistryLag(roots, registry, runNpm, options = {}) {
  const {
    sleep = wait,
    now = Date.now,
    intervalMs = REGISTRY_POLL_INTERVAL_MS,
    limitMs = REGISTRY_WAIT_LIMIT_MS,
    started = now(),
  } = options;
  const args = [
    'install',
    '--package-lock-only',
    '--omit=dev',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--prefer-online',
    '--registry',
    registry,
  ];
  for (;;) {
    const { status, stderr } = await runNpm(args);
    if (status === 0) return;
    const lagging = laggingPackage(roots, stderr ?? '');
    if (!lagging) throw new Error(`npm install failed with exit status ${status}`);
    const waited = now() - started;
    if (waited >= limitMs)
      throw new Error(
        `${lagging.name}@${lagging.version}: npm install still finds no matching version after waiting ${Math.round(waited / 1000)} s although the registry listed it; resume this run without repacking.`,
      );
    await sleep(Math.min(intervalMs, limitMs - waited));
  }
}
