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
            'E2B SDK is not installed. Install e2b@2.51.0 alongside the CLI in the same project or global installation prefix; host execution is refused.',
            { cause },
          );
        }
      }
    }
    throw new Error(
      'E2B SDK failed to load. Repair or reinstall e2b@2.51.0 alongside the CLI in the same project or global installation prefix; host execution is refused.',
      { cause },
    );
  }
}
