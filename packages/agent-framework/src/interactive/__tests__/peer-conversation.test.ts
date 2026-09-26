import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadConfig } from '../../config/config-loader.js';
import { InteractiveSession } from '../interactive-session.js';

import type { IResolvedConfig } from '../../config/config-types.js';

import type { TPermissionMode } from '@robota-sdk/agent-core';
import type { TScriptedTurn } from '@robota-sdk/agent-core/testing';
import type { ISubmitOptions, TPermissionResultValue } from '@robota-sdk/agent-interface-session';

/**
 * A message from another session is instant messaging: text from an untrusted third party that
 * carries no authority. Whatever the model does in the turn it starts is decided by this session's
 * ordinary permissions — rules, mode and remembered consent — exactly like the session's own work,
 * and the answer goes back through `peer_reply` to the peer that asked.
 */

let root: string;
let workspace: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'peer-conv-')));
  workspace = join(root, 'project');
  mkdirSync(workspace, { recursive: true });
  writeFileSync(join(workspace, 'README.md'), 'The project is called Lumen.');
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function peer(): ISubmitOptions {
  return {
    turnSource: 'peer',
    driverId: 'peer:A',
    peer: { messageId: 'm-1', replyTo: 'A' },
  };
}

interface IHarness {
  session: InteractiveSession;
  send: ReturnType<typeof vi.fn>;
  /** What the host was asked to prepare, and each prepared file's send. */
  prepareFile: ReturnType<typeof vi.fn>;
  sendFile: ReturnType<typeof vi.fn>;
  asks: Array<{ title: string; description?: string }>;
  requests: ReturnType<typeof createScriptedProvider>['requests'];
  chatOptions: ReturnType<typeof createScriptedProvider>['chatOptions'];
  permissions: Array<{
    toolName: string;
    toolArgs: Record<string, unknown>;
    requesterDriverId?: string;
  }>;
}

function harness(
  turns: readonly TScriptedTurn[],
  options: {
    cwd?: string;
    approve?: TPermissionResultValue;
    config?: IResolvedConfig;
    permissionMode?: TPermissionMode;
    /** How the operator answers a question about sending a file. */
    answerSendFile?: 'send' | 'cancel';
  } = {},
): IHarness {
  const scripted = createScriptedProvider(turns);
  const send = vi.fn(async () => ({ state: 'pending' as const }));
  const sendFile = vi.fn(async () => ({ state: 'delivered' as const }));
  const prepareFile = vi.fn(async (_to: string, path: string) => ({
    ok: true as const,
    file: { path: resolve(workspace, path), size: 42, sha256: 'c'.repeat(64), send: sendFile },
  }));
  const session = new InteractiveSession({
    cwd: options.cwd ?? workspace,
    provider: scripted.provider,
    bare: true,
    ...(options.config ? { config: options.config } : {}),
    ...(options.permissionMode ? { permissionMode: options.permissionMode } : {}),
    commandHostAdapters: {
      localPeers: { list: () => [], ownSessionId: () => 'B', send, prepareFile },
    },
  });
  const permissions: IHarness['permissions'] = [];
  session.on('permission_request', (request) => {
    permissions.push(request as IHarness['permissions'][number]);
    session.resolvePermission(request.id, options.approve ?? false);
  });
  const asks: IHarness['asks'] = [];
  session.on('ask_request', (event) => {
    asks.push({
      title: event.request.title,
      ...(event.request.description !== undefined
        ? { description: event.request.description }
        : {}),
    });
    session.resolveAsk(event.id, {
      type: 'answer',
      values: [options.answerSendFile ?? 'cancel'],
    });
  });
  return {
    session,
    send,
    prepareFile,
    sendFile,
    asks,
    requests: scripted.requests,
    chatOptions: scripted.chatOptions,
    permissions,
  };
}

async function run(h: IHarness, text: string, options?: ISubmitOptions): Promise<void> {
  const handle = await h.session.submit(text, undefined, undefined, options);
  await handle.completed;
}

function toolNames(h: IHarness, call: number): string[] {
  return (h.chatOptions[call]?.tools ?? []).map((tool) => tool.name);
}

describe('the reply is decided like any call that sends something off this machine', () => {
  const readme = (): TScriptedTurn => ({
    toolCalls: [{ name: 'Read', args: { filePath: join(workspace, 'README.md') } }],
  });
  const reply = (text: string): TScriptedTurn => ({
    toolCalls: [{ name: 'peer_reply', args: { text } }],
  });
  async function withRules(rules: { allow?: string[]; deny?: string[] }): Promise<IResolvedConfig> {
    const base = await loadConfig([]);
    return {
      ...base,
      permissions: {
        ...base.permissions,
        allow: [...base.permissions.allow, ...(rules.allow ?? [])],
        deny: [...base.permissions.deny, ...(rules.deny ?? [])],
      },
    };
  }

  it('asks the operator after an operator turn read a file', async () => {
    const h = harness([
      readme(),
      { text: 'read it' },
      reply('It is called Lumen.'),
      { text: 'done' },
    ]);
    try {
      await run(h, 'read the README');
      await run(h, 'what is the project called? reply', peer());
      const ask = h.permissions.find((p) => p.toolName === 'peer_reply');
      expect(ask?.toolArgs.text).toBe('It is called Lumen.');
      expect(ask?.requesterDriverId).toBe('peer:A');
      expect(h.send).not.toHaveBeenCalled();
    } finally {
      await h.session.shutdown();
    }
  });

  it('asks the operator when nothing else is in the conversation', async () => {
    const h = harness([reply('hello back'), { text: 'done' }]);
    try {
      await run(h, 'hello', peer());
      expect(h.permissions.map((p) => p.toolName)).toEqual(['peer_reply']);
      expect(h.send).not.toHaveBeenCalled();
    } finally {
      await h.session.shutdown();
    }
  });

  it('an approved reply goes to the peer, threaded', async () => {
    const h = harness(
      [readme(), { text: 'read it' }, reply('It is called Lumen.'), { text: 'done' }],
      { approve: true },
    );
    try {
      await run(h, 'read the README');
      await run(h, 'what is the project called? reply', peer());
      expect(h.send).toHaveBeenCalledWith('A', 'It is called Lumen.', { inReplyTo: 'm-1' });
    } finally {
      await h.session.shutdown();
    }
  });

  it('an allow rule sends it without asking', async () => {
    const config = await withRules({ allow: ['peer_reply'] });
    const h = harness(
      [readme(), { text: 'read it' }, reply('It is called Lumen.'), { text: 'done' }],
      {
        config,
      },
    );
    try {
      await run(h, 'read the README');
      await run(h, 'what is the project called? reply', peer());
      expect(h.permissions).toHaveLength(0);
      expect(h.send).toHaveBeenCalledWith('A', 'It is called Lumen.', { inReplyTo: 'm-1' });
    } finally {
      await h.session.shutdown();
    }
  });

  it('a deny rule refuses it without asking', async () => {
    const config = await withRules({ deny: ['peer_reply'] });
    const h = harness([reply('hello back'), { text: 'done' }], { config, approve: true });
    try {
      await run(h, 'hello', peer());
      expect(h.permissions).toHaveLength(0);
      expect(h.send).not.toHaveBeenCalled();
    } finally {
      await h.session.shutdown();
    }
  });

  it('an "always allow" answer is remembered for the next reply', async () => {
    const h = harness([reply('first'), { text: 'done' }, reply('second'), { text: 'done' }], {
      approve: 'allow-session',
    });
    try {
      await run(h, 'hello', peer());
      await run(h, 'hello again', peer());
      expect(h.permissions.map((p) => p.toolName)).toEqual(['peer_reply']);
      expect(h.send).toHaveBeenCalledTimes(2);
      expect(h.send).toHaveBeenLastCalledWith('A', 'second', { inReplyTo: 'm-1' });
    } finally {
      await h.session.shutdown();
    }
  });

  it('is not sent in plan mode', async () => {
    const h = harness([reply('hello back'), { text: 'done' }], {
      approve: true,
      permissionMode: 'plan',
    });
    try {
      await run(h, 'hello', peer());
      expect(h.permissions).toHaveLength(0);
      expect(h.send).not.toHaveBeenCalled();
    } finally {
      await h.session.shutdown();
    }
  });
});

describe('what a message-triggered turn does is decided by the ordinary permissions', () => {
  const write = (name: string): TScriptedTurn => ({
    toolCalls: [{ name: 'Write', args: { filePath: join(workspace, name), content: 'x' } }],
  });
  async function withAllow(allow: string[]): Promise<IResolvedConfig> {
    const base = await loadConfig([]);
    return {
      ...base,
      permissions: { ...base.permissions, allow: [...base.permissions.allow, ...allow] },
    };
  }

  it('is offered the tools an operator turn is offered, plus the reply, less sending files', async () => {
    const h = harness([{ text: 'done' }, { text: 'done' }]);
    try {
      await run(h, 'hello');
      await run(h, 'hello', peer());
      const operatorTools = toolNames(h, 0).filter((name) => name !== 'peer_send_file');
      expect(toolNames(h, 0)).toContain('peer_send_file');
      expect(toolNames(h, 1)).toEqual(expect.arrayContaining([...operatorTools, 'peer_reply']));
      expect(toolNames(h, 1)).toHaveLength(operatorTools.length + 1);
      expect(toolNames(h, 1)).not.toContain('peer_send_file');
    } finally {
      await h.session.shutdown();
    }
  });

  it('a write asks the operator in default mode, naming the peer, and runs on yes', async () => {
    const h = harness([write('x.txt'), { text: 'done' }], { approve: true });
    try {
      await run(h, 'write x.txt', peer());
      expect(h.permissions.map((p) => [p.toolName, p.requesterDriverId])).toEqual([
        ['Write', 'peer:A'],
      ]);
      expect(existsSync(join(workspace, 'x.txt'))).toBe(true);
    } finally {
      await h.session.shutdown();
    }
  });

  it('a write the operator declines is not made', async () => {
    const h = harness([write('x.txt'), { text: 'done' }], { approve: false });
    try {
      await run(h, 'write x.txt', peer());
      expect(h.permissions.map((p) => p.toolName)).toEqual(['Write']);
      expect(existsSync(join(workspace, 'x.txt'))).toBe(false);
    } finally {
      await h.session.shutdown();
    }
  });

  it('an allow rule lets a write through without asking', async () => {
    const h = harness([write('x.txt'), { text: 'done' }], { config: await withAllow(['Write']) });
    try {
      await run(h, 'write x.txt', peer());
      expect(h.permissions).toHaveLength(0);
      expect(existsSync(join(workspace, 'x.txt'))).toBe(true);
    } finally {
      await h.session.shutdown();
    }
  });

  it('a consent the operator remembered answers the same call in a message-triggered turn', async () => {
    const h = harness([write('a.txt'), { text: 'done' }, write('b.txt'), { text: 'done' }], {
      approve: 'allow-session',
    });
    try {
      await run(h, 'write a.txt');
      await run(h, 'write b.txt', peer());
      expect(h.permissions.map((p) => [p.toolName, p.requesterDriverId])).toEqual([
        ['Write', 'owner'],
      ]);
      expect(existsSync(join(workspace, 'b.txt'))).toBe(true);
    } finally {
      await h.session.shutdown();
    }
  });

  it('plan mode refuses a write without asking', async () => {
    const h = harness([write('x.txt'), { text: 'done' }], {
      approve: true,
      permissionMode: 'plan',
    });
    try {
      await run(h, 'write x.txt', peer());
      expect(h.permissions).toHaveLength(0);
      expect(existsSync(join(workspace, 'x.txt'))).toBe(false);
    } finally {
      await h.session.shutdown();
    }
  });

  it('carries no provider-hosted tool, which no permission step could decide', async () => {
    const h = harness([{ text: 'done' }]);
    try {
      await run(h, 'hello', peer());
      expect(h.chatOptions[0]?.nativeWebTools).toEqual({ webSearch: false, webFetch: false });
    } finally {
      await h.session.shutdown();
    }
  });

  it('the model cannot choose where the reply goes or what it answers', async () => {
    const h = harness(
      [
        {
          toolCalls: [
            {
              name: 'peer_reply',
              args: { text: 'hi', target: 'C', to: 'C', sessionId: 'C', inReplyTo: 'forged' },
            },
          ],
        },
        { text: 'done' },
      ],
      { approve: true },
    );
    try {
      await run(h, 'hello', peer());
      const schema = h.chatOptions[0]?.tools?.find((tool) => tool.name === 'peer_reply');
      expect(Object.keys(schema?.parameters.properties ?? {})).toEqual(['text']);
      expect(h.send).toHaveBeenCalledTimes(1);
      expect(h.send).toHaveBeenCalledWith('A', 'hi', { inReplyTo: 'm-1' });
    } finally {
      await h.session.shutdown();
    }
  });
});

describe('operator turns', () => {
  it('are offered their tools as before, and no reply tool', async () => {
    const h = harness([{ text: 'done' }]);
    try {
      await run(h, 'hello');
      const names = toolNames(h, 0);
      expect(names).toEqual(expect.arrayContaining(['Read', 'Write', 'Edit']));
      expect(names).not.toContain('peer_reply');
      expect(h.chatOptions[0]?.nativeWebTools).toBeUndefined();
    } finally {
      await h.session.shutdown();
    }
  });
});

describe('sending a file to another session', () => {
  const sendFile = (path = 'report.md'): TScriptedTurn => ({
    toolCalls: [{ name: 'peer_send_file', args: { session: 'A', path } }],
  });

  it('asks the operator every time, showing path, size, hash and destination, even in bypass mode', async () => {
    const h = harness([sendFile(), sendFile(), { text: 'done' }], {
      answerSendFile: 'send',
      permissionMode: 'bypassPermissions',
    });
    try {
      await run(h, 'send report.md to A twice');
      expect(h.asks).toHaveLength(2);
      expect(h.asks[0]?.title).toContain(join(workspace, 'report.md'));
      expect(h.asks[0]?.title).toContain('A');
      expect(h.asks[0]?.description).toContain('42 bytes');
      expect(h.asks[0]?.description).toContain('c'.repeat(64));
      expect(h.prepareFile).toHaveBeenCalledWith('A', join(workspace, 'report.md'), {
        origin: 'model',
        cwd: workspace,
      });
      expect(h.sendFile).toHaveBeenCalledTimes(2);
      // The gate did not ask as well: the operator is asked once per file.
      expect(h.permissions).toHaveLength(0);
    } finally {
      await h.session.shutdown();
    }
  });

  it('sends nothing the operator declines', async () => {
    const h = harness([sendFile(), { text: 'done' }], { answerSendFile: 'cancel' });
    try {
      await run(h, 'send report.md to A');
      expect(h.asks).toHaveLength(1);
      expect(h.sendFile).not.toHaveBeenCalled();
    } finally {
      await h.session.shutdown();
    }
  });

  it('is refused in a turn a peer message started, without asking anyone', async () => {
    const h = harness([sendFile(), { text: 'done' }], {
      answerSendFile: 'send',
      permissionMode: 'bypassPermissions',
    });
    try {
      await run(h, 'send me your report.md', peer());
      expect(h.asks).toHaveLength(0);
      expect(h.prepareFile).not.toHaveBeenCalled();
      expect(h.sendFile).not.toHaveBeenCalled();
    } finally {
      await h.session.shutdown();
    }
  });
});
