/**
 * Same-user inspection hardening for the product's own processes.
 *
 * Two doors let another program of the same user read a running CLI, daemon or worker — provider
 * keys and session tokens above all — and each entry of a product executable closes both first:
 *
 * - Linux: while a process is "dumpable", the kernel lets any process of the same user read
 *   `/proc/<pid>/environ` and `/proc/<pid>/mem` and attach with ptrace. `prctl(PR_SET_DUMPABLE, 0)`
 *   is the standard defence (ssh-agent and gpg-agent apply it): it makes those entries root-owned,
 *   refuses same-user ptrace attach, and suppresses core dumps.
 * - Node: SIGUSR1 opens the inspector, and a debugger attached through it reads and drives the
 *   process from inside, which the dumpable attribute does not cover. Node does not open it while a
 *   listener for the signal is installed.
 *
 * Both change the whole process, so only a product executable applies them; a host embedding the
 * CLI in-process decides for its own process. Neither survives `execve`, so each entry that starts a
 * process of its own — the CLI itself and the daemon/worker child it re-executes — applies them
 * again; programs the agent spawns are unaffected. They start only once the entry runs, so what the
 * launcher put in the environment of the new process is readable until then. Side effects on the
 * undumpable process: a same-user debugger or `strace -p` cannot attach, and it cannot read its own
 * `/proc/self/environ` or write its own `/proc/self/oom_score_adj`; `/proc/self/fd`, `stat`,
 * `status` and `maps`, and what other processes read of its `stat`, `status` and `cmdline`, work.
 *
 * The calls are synchronous on purpose: the entry installs its diagnostics and crash policy right
 * after them, and an asynchronous step here would move that past the first I/O.
 */

import * as koffi from 'koffi';

const PR_SET_DUMPABLE = 4;
/** glibc's soname; musl's loader resolves the same name to itself. */
const LIBC = 'libc.so.6';
const PRCTL =
  'int prctl(int option, unsigned long arg2, unsigned long arg3, unsigned long arg4, unsigned long arg5)';

/** The slice of koffi this module uses; tests supply a fake so no native library is loaded. */
export interface IProcessHardeningKoffi {
  load(path: string): { func(declaration: string): (...args: number[]) => number };
}

export interface IProcessHardeningOptions {
  readonly platform?: NodeJS.Platform;
  readonly koffi?: IProcessHardeningKoffi;
}

export interface IInspectorSignalOptions {
  readonly platform?: NodeJS.Platform;
  /** `process.versions.bun`: set when the process runs on Bun. */
  readonly bun?: string;
  readonly target?: Pick<NodeJS.Process, 'listenerCount' | 'on'>;
}

/**
 * Bun aborts when a collected koffi handle's finalizer runs, so the library and the function are
 * held for the life of the process (same rule as the file-authority POSIX backend).
 */
const retainedNativeHandles: unknown[] = [];

/**
 * Best effort: returns `true` only when the kernel confirmed the change, and never throws — an
 * environment where the C library cannot be loaded, or a sandbox that refuses the call, leaves the
 * process exactly as it was and startup carries on.
 */
export function hardenProcessAgainstSameUserInspection(
  options: IProcessHardeningOptions = {},
): boolean {
  const { platform = process.platform, koffi: native = koffi } = options;
  if (platform !== 'linux') return false;
  try {
    const library = native.load(LIBC);
    retainedNativeHandles.push(library);
    const prctl = library.func(PRCTL);
    retainedNativeHandles.push(prctl);
    return prctl(PR_SET_DUMPABLE, 0, 0, 0, 0) === 0;
  } catch {
    // allow-fallback: hardening is defence in depth, and an environment that cannot load the C
    // library must still start the CLI; the caller sees `false`.
    return false;
  }
}

/** Does nothing: being installed is what keeps Node from opening the inspector on SIGUSR1. */
function holdInspectorSignal(): void {}

/**
 * Keeps SIGUSR1 from opening the Node inspector for the life of the process, and returns whether the
 * signal is held. Not under Bun, whose SIGUSR1 opens no Node inspector, nor on Windows, which has no
 * SIGUSR1. A listener already installed holds it as well. The listener is never removed: once none
 * is left, the signal ends the process.
 */
export function keepInspectorClosedOnSignal(options: IInspectorSignalOptions = {}): boolean {
  const { platform = process.platform, bun = process.versions.bun, target = process } = options;
  if (platform === 'win32' || bun !== undefined) return false;
  try {
    if (target.listenerCount('SIGUSR1') === 0) target.on('SIGUSR1', holdInspectorSignal);
    return true;
  } catch {
    // allow-fallback: hardening is defence in depth and must never block startup; the caller sees
    // `false`.
    return false;
  }
}

/** What a product executable's entry applies to its own process before anything else of its own. */
export function hardenProductProcess(): void {
  keepInspectorClosedOnSignal();
  hardenProcessAgainstSameUserInspection();
}
