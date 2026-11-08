// Fake $EDITOR for the /editor PTY scenario.
// Invoked as: node fake-editor.cjs <file>. Reads ONE line from the inherited terminal (proving the
// editor runs on the real TTY under the handoff) and writes it as the file's contents, then exits 0.
const { writeFileSync } = require('node:fs');
const file = process.argv[2];
require('node:readline')
  .createInterface({ input: process.stdin })
  .once('line', (line) => {
    writeFileSync(file, `${line}\n`);
    process.exit(0);
  });
