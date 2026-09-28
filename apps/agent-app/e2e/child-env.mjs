// GUI-003 — the env the bundled-runtime e2e (`bundled-runtime-e2e.mjs`) spawns the packaged runtime
// with, split out so this one Windows-specific fact is unit-testable without actually spawning a
// binary: `os.homedir()` reads `USERPROFILE` on win32 and never `HOME` (`HOME` only matters on POSIX).
// A sandbox env that sets `HOME` alone therefore isolates the packaged runtime's `~/.robota` on macOS
// and Linux but not on Windows — the runtime falls through to the REAL runner profile instead, which is
// how this e2e failed there: a stale rendezvous directory at the real profile refused local-peer
// admission, and the real profile's missing `settings.json` produced "No provider configuration found.".
//
// The env is a curated allowlist, not `{ ...process.env, ... }`: the point of the sandbox is that the
// packaged runtime sees ONLY the identity this test hands it, never whatever provider settings or
// tokens happen to be in the developer's or runner's ambient environment.
export function buildBundledRuntimeChildEnv({ path, home, token, port, systemRoot }) {
  return {
    PATH: path,
    HOME: home,
    USERPROFILE: home,
    // Windows-only, and only carried through when the host actually has one: some native Windows APIs
    // (crypto/cert store lookups among them) expect `SystemRoot` to resolve, and an env built from
    // scratch otherwise omits it entirely. Absent on POSIX, where `process.env.SystemRoot` is undefined.
    ...(systemRoot ? { SystemRoot: systemRoot } : {}),
    ROBOTA_WS_TOKEN: token,
    ROBOTA_WS_PORT: String(port),
  };
}
