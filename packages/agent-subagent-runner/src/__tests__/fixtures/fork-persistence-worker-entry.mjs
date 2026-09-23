import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { runSubagentWorkerMain } from '../../../dist/node/index.js';

if (!process.argv.includes('--__robota-subagent-worker')) {
  process.stderr.write('fork persistence fixture started without the worker-mode flag\n');
  process.exit(2);
}

function recordPath(cwd, id) {
  return join(cwd, 'sessions', `${id}.json`);
}

function openSessionStore(cwd) {
  return {
    save(record) {
      mkdirSync(join(cwd, 'sessions'), { recursive: true });
      writeFileSync(recordPath(cwd, record.id), JSON.stringify(record), 'utf8');
    },
    load(id) {
      const path = recordPath(cwd, id);
      if (!existsSync(path)) return { status: 'missing' };
      const record = JSON.parse(readFileSync(path, 'utf8'));
      record.messages = record.messages.map((message) => ({
        ...message,
        timestamp: new Date(message.timestamp),
      }));
      return { status: 'valid', record };
    },
    list() {
      return [];
    },
    delete() {},
  };
}

runSubagentWorkerMain({
  createTools: () => [],
  providerDefinitions: [
    {
      type: 'openai',
      createProvider: () => ({
        name: 'openai',
        chat: () =>
          Promise.resolve({
            role: 'assistant',
            content: 'the child process answers',
            timestamp: new Date(),
          }),
      }),
    },
  ],
  openSessionStore: ({ cwd }) => openSessionStore(cwd),
});
