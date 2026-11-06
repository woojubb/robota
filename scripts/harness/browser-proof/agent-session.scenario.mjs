/**
 * agent-session in a web-only realm: a whole turn with a tool, the permission gate with no host to
 * ask, and persistence through a store and a log sink that live in memory.
 */
import {
  FunctionTool,
  clearRegisteredToolProfiles,
  registerToolPermissionProfile,
} from '@robota-sdk/agent-core';
import { FileSessionLogger, PermissionEnforcer, Session } from '@robota-sdk/agent-session';

import { scriptedProvider } from './kit.mjs';

const terminal = {
  write() {},
  writeLine() {},
  writeMarkdown() {},
  writeError() {},
  prompt: async () => '',
  select: async () => 0,
  spinner: () => ({ stop() {}, update() {} }),
};

/** A session store that keeps records in a Map: the whole `IInteractiveSessionStore` a browser needs. */
function memoryStore() {
  const records = new Map();
  return {
    records,
    save(record) {
      records.set(record.id, structuredClone(record));
    },
    load(id) {
      const record = records.get(id);
      return record === undefined
        ? { status: 'missing' }
        : { status: 'valid', record: structuredClone(record) };
    },
    list: () =>
      [...records.keys()].map((id) => ({
        id,
        outcome: { status: 'valid', record: records.get(id) },
      })),
  };
}

export default async function agentSession(t) {
  const executed = [];
  const echo = new FunctionTool(
    {
      name: 'echo',
      description: 'Returns its text, upper-cased',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string', description: 'text to echo' } },
        required: ['text'],
      },
    },
    async (parameters) => {
      executed.push(parameters);
      return String(parameters.text).toUpperCase();
    },
  );
  const { provider, requests } = scriptedProvider([
    { toolCalls: [{ name: 'echo', args: { text: 'session' } }] },
    { text: 'Echoed SESSION.' },
  ]);
  const store = memoryStore();
  const logLines = [];
  const sink = { append: (_sessionId, text) => logLines.push(text) };

  // `hookTypeExecutors: []` runs no hook handler: a neutral session has no shell to run one in.
  const session = new Session({
    hookTypeExecutors: [],
    cwd: '/work',
    sessionId: 'proof-session',
    systemMessage: 'You are a proof.',
    model: 'scripted-model',
    provider,
    autoCompactThreshold: false,
    terminal,
    tools: [echo],
    permissionMode: 'bypassPermissions',
    sessionStore: store,
    sessionLogger: new FileSessionLogger(sink),
  });
  const answer = await session.run('Echo "session".');
  t.equal("the turn ends with the provider's final text", answer, 'Echoed SESSION.');
  t.equal("the tool ran once, with the model's arguments", executed, [{ text: 'session' }]);
  t.equal('the provider saw the request and then the tool result', requests.length, 2);
  const saved = store.records.get('proof-session');
  t.equal(
    'the store holds the conversation the session ran',
    saved?.messages.map((message) => message.role),
    ['system', 'user', 'assistant', 'tool', 'assistant'],
  );
  t.equal("the store holds the session's directory", saved?.cwd, '/work');
  await session.shutdown();
  const events = logLines
    .join('')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  t.ok(
    'the log sink received JSON lines for the session',
    events.length > 0 && events.every((event) => event.sessionId === 'proof-session'),
  );
  t.ok(
    'the log records the session start, the tool call and the shutdown',
    ['session_init', 'tool_call', 'tool_result', 'session_shutdown'].every((name) =>
      events.some((event) => event.event === name),
    ),
  );

  // The permission gate judges a path operand only where a host can resolve it.
  registerToolPermissionProfile('Bash', {
    argument: { key: 'command', kind: 'command' },
    riskClass: 'execute',
  });
  const gate = (resolveInWorkspace) =>
    new PermissionEnforcer({
      hookTypeExecutors: [],
      sessionId: 'proof-gate',
      cwd: '/work',
      getPermissionMode: () => 'default',
      config: { permissions: { allow: [], deny: [] } },
      terminal,
      ...(resolveInWorkspace === undefined ? {} : { resolveInWorkspace }),
    });
  t.equal(
    'a read-only command with no path operand needs no approval',
    await gate().checkPermission('Bash', { command: 'ls' }),
    true,
  );
  t.equal(
    'a path operand with no resolver is refused',
    await gate().checkPermission('Bash', { command: 'cat notes.txt' }),
    false,
  );
  t.equal(
    'the same operand is allowed once the host resolves it inside the workspace',
    await gate((_base, path) => `/work/${path}`).checkPermission('Bash', {
      command: 'cat notes.txt',
    }),
    true,
  );
  clearRegisteredToolProfiles();
}
