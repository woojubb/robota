// Browser shim for node:crypto — only randomUUID is needed here.
exports.randomUUID = () => globalThis.crypto.randomUUID();
