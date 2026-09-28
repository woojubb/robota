import assert from 'node:assert/strict';

import koffi from 'koffi';

if (!process.versions.bun) throw new Error('Native addon GC qualification requires Bun.');

function releaseNativeFunction() {
  const library = koffi.load(
    process.platform === 'win32'
      ? 'kernel32.dll'
      : process.platform === 'darwin'
        ? '/usr/lib/libSystem.B.dylib'
        : 'libc.so.6',
  );
  const pid = library.func(
    process.platform === 'win32' ? 'uint32_t __stdcall GetCurrentProcessId()' : 'int getpid()',
  );
  assert.equal(pid(), process.pid);
}

// Bun <= 1.3.14 aborts when Koffi releases an N-API reference during GC.
// Exercise real addon finalizers before accepting this engine for standalone builds.
for (let index = 0; index < 3; index++) releaseNativeFunction();
for (let index = 0; index < 3; index++) {
  globalThis.Bun.gc(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
}
console.log('Native addon GC qualification passed.');
