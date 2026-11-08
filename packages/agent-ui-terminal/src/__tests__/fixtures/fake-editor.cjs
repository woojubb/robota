// Fake $EDITOR for the /editor PTY scenario.
// Invoked as: node fake-editor.cjs <file>. Announces EDITOR_READY, then reads ONE line from the
// inherited terminal (proving the editor runs on the real TTY under the handoff) and writes it as
// the file's contents, then exits 0. The announcement is what lets a test type only once this
// process, not the TUI, receives the keys.
const { writeFileSync } = require('node:fs');
const file = process.argv[2];
console.log('EDITOR' + '_READY');
require('node:readline')
  .createInterface({ input: process.stdin })
  .once('line', (line) => {
    writeFileSync(file, `${line}\n`);
    process.exit(0);
  });
