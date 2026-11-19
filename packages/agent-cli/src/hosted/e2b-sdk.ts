function isMissingE2BPackage(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ERR_MODULE_NOT_FOUND' &&
    'message' in error &&
    typeof error.message === 'string' &&
    (/^Cannot find package 'e2b' (?:imported )?from /u.test(error.message) ||
      /^Cannot find module 'e2b\/dist\/index\.mjs' from /u.test(error.message))
  );
}

export async function loadE2BSdk(): Promise<typeof import('e2b/dist/index.mjs')> {
  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
  if (process.versions['bun'] === undefined && (major < 22 || (major === 22 && minor < 19))) {
    throw new Error('E2B SDK 2.64.0 requires Node.js 22.19.0 or later for hosted execution.');
  }
  try {
    // eslint-disable-next-line no-restricted-syntax -- The optional hosted SDK must not load during local startup.
    const sdk = await import('e2b/dist/index.mjs');
    if (
      typeof sdk.Sandbox !== 'function' ||
      typeof sdk.CommandExitError !== 'function' ||
      typeof sdk.SandboxNotFoundError !== 'function'
    ) {
      throw new Error('E2B SDK does not provide the required adapter exports.');
    }
    return sdk;
  } catch (cause) {
    if (isMissingE2BPackage(cause)) {
      try {
        import.meta.resolve('e2b');
      } catch (resolution) {
        if (isMissingE2BPackage(resolution)) {
          throw new Error(
            'E2B SDK is not installed. Install e2b@2.64.0 alongside the CLI in the same project or global installation prefix; host execution is refused.',
            { cause },
          );
        }
      }
    }
    throw new Error(
      'E2B SDK failed to load. Repair or reinstall e2b@2.64.0 alongside the CLI in the same project or global installation prefix; host execution is refused.',
      { cause },
    );
  }
}
