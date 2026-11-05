/**
 * agent-core in a web-only realm: the agent loop with a scripted provider and a tool, and the
 * platform helpers a neutral entry offers in place of `node:crypto` and `node:path`.
 */
import {
  ConversationAgent,
  FunctionTool,
  constantTimeEqual,
  hmacSha256Hex,
  isAbsolutePath,
  joinPath,
  randomHex,
  randomId,
  sha256Hex,
  utf8ByteLength,
} from '@robota-sdk/agent-core';

import { scriptedProvider } from './kit.mjs';

export default async function agentCore(t) {
  // Digests, from the platform's own bytes rather than `node:crypto`.
  t.equal(
    'sha256Hex of "abc" is the published digest',
    sha256Hex('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
  t.equal(
    'sha256Hex of the same text as bytes is the same digest',
    sha256Hex(new TextEncoder().encode('abc')),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
  t.equal(
    'hmacSha256Hex matches RFC 4231 test case 2',
    hmacSha256Hex('Jefe', 'what do ya want for nothing?'),
    '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
  );
  t.ok(
    'constantTimeEqual tells equal text from different text',
    constantTimeEqual('a', 'a') && !constantTimeEqual('a', 'b'),
  );
  t.equal('utf8ByteLength counts bytes, not characters', utf8ByteLength('aé€'), 6);

  // Randomness, from Web Crypto.
  const [first, second] = [randomId(), randomId()];
  t.match(
    'randomId is a version 4 UUID',
    first,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  t.ok('randomId does not repeat', first !== second);
  t.match('randomHex(8) is sixteen hex digits', randomHex(8), /^[0-9a-f]{16}$/);

  // Lexical paths: the flavour is read from the text, with no host to ask.
  t.equal(
    'isAbsolutePath reads POSIX and Windows paths',
    [
      isAbsolutePath('/usr/bin'),
      isAbsolutePath('C:\\Users\\me'),
      isAbsolutePath('\\\\server\\share\\file'),
      isAbsolutePath('relative/path'),
      isAbsolutePath('..\\up'),
    ],
    [true, true, true, false, false],
  );
  t.equal('joinPath joins lexically', joinPath('/work', 'a', '../b.txt'), '/work/b.txt');

  // The agent loop: a tool call, its result fed back, and the final answer.
  const calls = [];
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
      calls.push(parameters);
      return String(parameters.text).toUpperCase();
    },
  );
  const { provider, requests } = scriptedProvider([
    { toolCalls: [{ name: 'echo', args: { text: 'hello' } }] },
    { text: 'The tool said HELLO.' },
  ]);
  const agent = new ConversationAgent({
    name: 'proof-agent',
    aiProviders: [provider],
    defaultModel: { provider: provider.name, model: 'scripted-model' },
    tools: [echo],
    logging: { enabled: false, level: 'silent' },
  });
  const answer = await agent.run('Say hello through the tool.');
  t.equal("the turn ends with the provider's final text", answer, 'The tool said HELLO.');
  t.equal("the tool ran once, with the model's arguments", calls, [{ text: 'hello' }]);
  t.equal('the provider was called twice: the request, then the tool result', requests.length, 2);
  const toolMessage = requests[1]?.find((message) => message.role === 'tool');
  t.match('the second request carries the tool result', toolMessage?.content ?? '', 'HELLO');
  t.equal(
    'the history holds the prompt, the tool round trip and the answer',
    agent.getHistory().map((message) => message.role),
    ['user', 'assistant', 'tool', 'assistant'],
  );
  await agent.destroy();
}
