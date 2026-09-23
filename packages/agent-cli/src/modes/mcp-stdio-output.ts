import { Writable } from 'node:stream';

/** Reserve process stdout for MCP before normal CLI startup can emit a notice. */
export function reserveMcpStdout(): { protocol: Writable; restore(): void } {
  const originalWrite = process.stdout.write;
  const protocol = new Writable({
    write(chunk, encoding, callback) {
      originalWrite.call(process.stdout, chunk, encoding, callback);
    },
  });
  process.stdout.write = process.stderr.write.bind(process.stderr) as typeof process.stdout.write;
  return {
    protocol,
    restore() {
      process.stdout.write = originalWrite;
    },
  };
}
