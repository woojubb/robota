const index = process.argv.indexOf('--supervised-session-id');
const id = process.argv[index + 1];
process.on('message', (message) => {
  process.stderr.write(`startup failure: ${message.environment.REFERENCE_ONLY} ${message.environment.REFERENCE_TWO}\n`, () => process.exit(1));
});
process.send({ kind: 'forwarded-environment-needed', id });
