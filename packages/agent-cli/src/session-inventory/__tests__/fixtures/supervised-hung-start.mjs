const id = process.argv[process.argv.indexOf('--supervised-session-id') + 1];
process.on('SIGTERM', () => undefined);
process.send?.({ kind: 'error', id, code: 'fixture-refusal' });
setInterval(() => undefined, 1_000);
