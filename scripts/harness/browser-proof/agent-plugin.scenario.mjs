/**
 * agent-plugin in a web-only realm: plugins attached to a real agent loop. The webhook plugin
 * delivers through the global `fetch` and signs with HMAC; usage tracking keeps its entries in
 * memory; a `file` strategy with no file store injected is refused, not defaulted to a disk.
 */
import { ConversationAgent, hmacSha256Hex } from '@robota-sdk/agent-core';
import { UsagePlugin, WebhookPlugin } from '@robota-sdk/agent-plugin';

import { scriptedProvider } from './kit.mjs';

const HOOK_URL = 'https://hooks.example.test/robota';

export default async function agentPlugin(t) {
  t.fetch.on(HOOK_URL, () => new Response(null, { status: 204 }));

  // Webhooks: one signed POST per completed execution, delivered through `fetch`.
  const { provider } = scriptedProvider([{ text: 'done' }]);
  const agent = new ConversationAgent({
    name: 'plugin-agent',
    aiProviders: [provider],
    defaultModel: { provider: provider.name, model: 'scripted-model' },
    plugins: [
      new WebhookPlugin({
        endpoints: [{ url: HOOK_URL, secret: 's3cret', headers: { 'X-Proof': '1' }, retries: 1 }],
        async: false,
      }),
    ],
    logging: { enabled: false, level: 'silent' },
  });
  await agent.run('hello');
  await agent.destroy();
  const posted = t.fetch.requests.filter((request) => request.url === HOOK_URL);
  t.ok('the agent run posted to the webhook endpoint', posted.length > 0, 'no request reached it');
  const [first] = posted;
  t.equal(
    "the post is a JSON POST with the endpoint's own header",
    [first?.method, first?.headers['x-proof']],
    ['POST', '1'],
  );
  t.match('the body is JSON', first?.headers['content-type'] ?? '', 'application/json');
  t.equal(
    'the signature is the HMAC-SHA-256 of the body under the secret',
    first?.headers['x-webhook-signature'],
    hmacSha256Hex('s3cret', first?.body ?? ''),
  );
  t.ok('the payload names its event', typeof JSON.parse(first?.body ?? '{}').event === 'string');

  // Usage: entries kept in memory, totals computed from them.
  const usage = new UsagePlugin({
    strategy: 'memory',
    trackCosts: true,
    costRates: { 'm-1': { input: 2, output: 4 } },
  });
  await usage.recordUsage({
    provider: 'scripted',
    model: 'm-1',
    tokensUsed: { input: 10, output: 5, total: 15 },
    requestCount: 1,
    duration: 12,
    success: true,
  });
  const totals = await usage.getAggregatedStats();
  t.equal(
    'the usage totals count the recorded request',
    [totals.totalRequests, totals.totalTokens],
    [1, 15],
  );
  await usage.dispose();

  // An absent port refuses; there is no file system to fall back on.
  await t.rejects(
    'a file strategy with no file store is refused',
    async () => new UsagePlugin({ strategy: 'file', filePath: 'usage.json' }),
    /file ?store/i,
  );
}
