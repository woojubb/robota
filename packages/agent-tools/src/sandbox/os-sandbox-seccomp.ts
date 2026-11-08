/**
 * The seccomp filter bubblewrap loads when a confined command has no network (issue #3082).
 *
 * `--unshare-net` removes every network interface, but a Unix socket is a file: a daemon listening
 * on one outside the sandbox (a container engine, the session bus, an ssh agent) is still reachable
 * through the read-only filesystem, and is a way to run anything on the host. The filter refuses
 * creating an `AF_UNIX` socket, and refuses `io_uring_setup`, which could create one without the
 * `socket` system call. A system call from another ABI (x32, 32-bit compat) is refused whole, since
 * its numbers differ and the checks below would not see it. macOS's Seatbelt `(deny network*)`
 * already covers Unix sockets.
 */

const BPF_LD_W_ABS = 0x20;
const BPF_JMP_JEQ_K = 0x15;
const BPF_JMP_JSET_K = 0x45;
const BPF_RET_K = 0x06;

const SECCOMP_RET_ALLOW = 0x7fff0000;
const SECCOMP_RET_ERRNO = 0x00050000;
const EPERM = 1;
const EAFNOSUPPORT = 97;
const AF_UNIX = 1;
const X32_SYSCALL_BIT = 0x40000000;

/** `struct seccomp_data` offsets. */
const OFFSET_NR = 0;
const OFFSET_ARCH = 4;
const OFFSET_ARG0_LOW = 16;

interface IArchitecture {
  readonly audit: number;
  readonly socket: number;
  readonly ioUringSetup: number;
}

const ARCHITECTURES: Readonly<Record<string, IArchitecture>> = {
  x64: { audit: 0xc000003e, socket: 41, ioUringSetup: 425 },
  arm64: { audit: 0xc00000b7, socket: 198, ioUringSetup: 425 },
};

function instruction(code: number, jt: number, jf: number, k: number): number[] {
  return [code, jt, jf, k];
}

/**
 * The filter as bytes `bwrap --seccomp` reads, or `undefined` for a processor architecture it has
 * no system call numbers for — the caller then refuses to confine rather than confine with a gap.
 */
export function unixSocketSeccompFilter(arch: string = process.arch): Uint8Array | undefined {
  const target = ARCHITECTURES[arch];
  if (target === undefined) return undefined;
  const errno = (code: number): number => SECCOMP_RET_ERRNO | code;
  const program = [
    /* 0 */ instruction(BPF_LD_W_ABS, 0, 0, OFFSET_ARCH),
    /* 1 */ instruction(BPF_JMP_JEQ_K, 1, 0, target.audit),
    /* 2 */ instruction(BPF_RET_K, 0, 0, errno(EPERM)),
    /* 3 */ instruction(BPF_LD_W_ABS, 0, 0, OFFSET_NR),
    /* 4 */ instruction(BPF_JMP_JSET_K, 0, 1, X32_SYSCALL_BIT),
    /* 5 */ instruction(BPF_RET_K, 0, 0, errno(EPERM)),
    /* 6 */ instruction(BPF_JMP_JEQ_K, 0, 1, target.ioUringSetup),
    /* 7 */ instruction(BPF_RET_K, 0, 0, errno(EPERM)),
    /* 8 */ instruction(BPF_JMP_JEQ_K, 0, 3, target.socket),
    /* 9 */ instruction(BPF_LD_W_ABS, 0, 0, OFFSET_ARG0_LOW),
    /* 10 */ instruction(BPF_JMP_JEQ_K, 0, 1, AF_UNIX),
    /* 11 */ instruction(BPF_RET_K, 0, 0, errno(EAFNOSUPPORT)),
    /* 12 */ instruction(BPF_RET_K, 0, 0, SECCOMP_RET_ALLOW),
  ];
  // `struct sock_filter`: u16 code, u8 jt, u8 jf, u32 k — little-endian on both architectures.
  const bytes = new Uint8Array(program.length * 8);
  const view = new DataView(bytes.buffer);
  program.forEach(([code, jt, jf, k], index) => {
    view.setUint16(index * 8, code!, true);
    view.setUint8(index * 8 + 2, jt!);
    view.setUint8(index * 8 + 3, jf!);
    view.setUint32(index * 8 + 4, k! >>> 0, true);
  });
  return bytes;
}
