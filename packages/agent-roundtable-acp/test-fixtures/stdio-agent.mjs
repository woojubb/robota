// A real Agent Client Protocol agent over standard input and output, for tests that start a child
// process. It is built from the protocol SDK's agent side. Behaviors are chosen by argument:
//
//   --reply <text>         the text it says for every prompt (default "fixture reply")
//   --echo-env <NAME>      say a JSON object with that variable and every variable name it sees
//   --hang                 never answer a prompt
//   --exit-mid-turn        say one word, then exit without answering the prompt
//   --grandchild           start a long-lived child of its own before answering anything
//   --grandchild-ignores-term   the grandchild keeps running when asked to terminate (`grandchild-ready`)
//   --grandchild-holds-stdout   the grandchild shares the agent's standard output
//   --exit-after-grandchild     exit as soon as the grandchild has started
//   --ignore-sigterm       keep running when asked to terminate, and past the end of its input
//   --stderr-flood <n>     write about n bytes to standard error before answering a prompt
//
// Progress is reported on standard error, one line each, so a test can wait on an event instead of
// a delay: `ready`, `pid:<n>`, `grandchild:<n>`, `prompt`, `sigterm`, `cancel`, `flood-done`.
import { spawn } from 'node:child_process';
import { writeSync } from 'node:fs';
import { Readable, Writable } from 'node:stream';

import { agent, ndJsonStream } from '@agentclientprotocol/sdk';

const argv = process.argv.slice(2);
const has = (name) => argv.includes(`--${name}`);
const valueOf = (name) => {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 ? argv[at + 1] : undefined;
};
const note = (text) => process.stderr.write(`${text}\n`);

if (has('ignore-sigterm')) {
  // A synchronous write, so the line is out before any later kill can land.
  process.on('SIGTERM', () => writeSync(2, 'sigterm\n'));
  // Without this the process would end by itself once its input ends; only a kill may end it.
  setInterval(() => {}, 1_000);
}

if (has('grandchild')) {
  const code = has('grandchild-ignores-term')
    ? "process.on('SIGTERM', () => {}); process.stderr.write('grandchild-ready\\n'); setInterval(() => {}, 1000)"
    : 'setInterval(() => {}, 1000)';
  // Sharing the agent's standard output keeps that pipe open for as long as the grandchild lives.
  const stdout = has('grandchild-holds-stdout') ? 'inherit' : 'ignore';
  const grandchild = spawn(process.execPath, ['-e', code], {
    // Its standard error is shared too, only so it can report that it is ready to ignore the request.
    stdio: ['ignore', stdout, has('grandchild-ignores-term') ? 'inherit' : 'ignore'],
  });
  grandchild.once('spawn', () => {
    note(`grandchild:${grandchild.pid}`);
    if (has('exit-after-grandchild')) process.exit(0);
  });
}

const flood = async (bytes) => {
  const line = `${'x'.repeat(1023)}\n`;
  for (let written = 0; written < bytes; written += line.length) {
    if (!process.stderr.write(line)) {
      await new Promise((resolve) => process.stderr.once('drain', resolve));
    }
  }
};

const replyText = () => {
  const name = valueOf('echo-env');
  if (name !== undefined) {
    return JSON.stringify({
      marker: process.env[name] ?? null,
      names: Object.keys(process.env).sort(),
    });
  }
  return valueOf('reply') ?? 'fixture reply';
};

const app = agent({ name: 'stdio-fixture-agent' })
  .onRequest('initialize', async () => ({ protocolVersion: 1, agentCapabilities: {} }))
  .onRequest('session/new', async () => ({ sessionId: 'fixture-session' }))
  .onRequest('session/prompt', async ({ params, client }) => {
    note('prompt');
    const say = (text) =>
      client.notify('session/update', {
        sessionId: params.sessionId,
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } },
      });
    if (has('hang')) return new Promise(() => {});
    if (has('exit-mid-turn')) {
      await say('partial');
      process.exit(3);
    }
    const bytes = Number(valueOf('stderr-flood') ?? 0);
    if (bytes > 0) {
      await flood(bytes);
      note('flood-done');
    }
    await say(replyText());
    return { stopReason: 'end_turn' };
  })
  .onNotification('session/cancel', () => note('cancel'));

app.connect(ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)));
note(`pid:${process.pid}`);
note('ready');
