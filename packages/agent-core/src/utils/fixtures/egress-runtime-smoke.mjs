import { createServer } from 'node:http';
import { fetchWithEgressPolicy } from '../../../dist/node/node.js';

let calls = 0;
const server = createServer((_, response) => {
  calls += 1;
  response.end('fixture-canary');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
try {
  const result = await fetchWithEgressPolicy(
    `http://pinned-fixture.invalid:${server.address().port}/`,
    { timeoutMs: 1000 },
    { allowedHosts: ['pinned-fixture.invalid'] },
    { lookup: async () => ['127.0.0.1'] },
  );
  if (!result.ok || calls !== 1 || Buffer.from(result.body).toString() !== 'fixture-canary') {
    throw new Error('Runtime did not perform the pinned fixture exchange');
  }
  process.stdout.write(
    `${JSON.stringify({ node: process.versions.node, bun: process.versions.bun, ok: result.ok, calls })}\n`,
  );
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
