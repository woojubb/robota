import { productConfigEntries } from '../../../packages/product-config/dist/index.js';

// `os.homedir()` reads USERPROFILE on win32. The env is a curated test fixture, never the runner's
// ambient environment; only non-private product settings are forwarded to the packaged process.
export function buildBundledRuntimeChildEnv({ path, home, token, port, systemRoot, productEnvironment = {} }) {
  const configured = Object.fromEntries(productConfigEntries()
    .filter(({ descriptor }) => descriptor.exposure !== 'private')
    .map(({ descriptor }) => descriptor.variable)
    .filter((key) => typeof productEnvironment[key] === 'string')
    .map((key) => [key, productEnvironment[key]]));
  return {
    ...configured,
    PATH: path,
    HOME: home,
    USERPROFILE: home,
    // Windows-only, and only carried through when the host actually has one: some native Windows APIs
    // (crypto/cert store lookups among them) expect `SystemRoot` to resolve, and an env built from
    // scratch otherwise omits it entirely. Absent on POSIX, where `process.env.SystemRoot` is undefined.
    ...(systemRoot ? { SystemRoot: systemRoot } : {}),
    PRODUCT_WS_TOKEN: token,
    PRODUCT_WS_PORT: String(port),
  };
}
