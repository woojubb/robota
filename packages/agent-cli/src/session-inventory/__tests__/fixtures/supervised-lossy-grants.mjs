// Reports ready without the grants it was handed, as a child that lost one would.
const id = process.argv[process.argv.indexOf('--supervised-session-id') + 1];
process.send?.({ kind: 'ready', id, grants: [] });
setInterval(() => undefined, 1_000);
