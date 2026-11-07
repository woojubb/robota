/**
 * agent-transport-http in a web-only realm: a Hono app, built on `fetch`-style `app.fetch`, answers
 * a request with the admission the transport minted. No listener is involved; a host that wants one
 * hands `app.fetch` to whatever serves.
 */
import { createTestInteractiveSession } from '@robota-sdk/agent-interface-session/testing';
import { createHttpTransport } from '@robota-sdk/agent-transport-http';

const ORIGIN = 'https://agent.example.test';

export default async function agentTransportHttp(t) {
  const transport = createHttpTransport();
  transport.attach(createTestInteractiveSession());
  await transport.start();
  const app = transport.getApp();
  const token = transport.getAdmissionToken();
  t.match(
    'the transport minted a credential for its host to hand out',
    token ?? '',
    /^[0-9a-f]{64}$/,
  );

  const refused = await app.fetch(new Request(`${ORIGIN}/executing`));
  t.equal('a request with no credential is refused', refused.status, 401);

  const admitted = await app.fetch(
    new Request(`${ORIGIN}/executing`, { headers: { authorization: `Bearer ${token}` } }),
  );
  t.equal(
    'the credential it minted opens the door',
    [admitted.status, await admitted.json()],
    [200, { executing: false }],
  );
  t.match('the answer is JSON', admitted.headers.get('content-type') ?? '', 'application/json');

  const messages = await app.fetch(
    new Request(`${ORIGIN}/messages`, { headers: { authorization: `Bearer ${token}` } }),
  );
  t.equal(
    "the session's messages are served",
    [messages.status, Array.isArray(await messages.json())],
    [200, true],
  );

  const missing = await app.fetch(
    new Request(`${ORIGIN}/no-such-route`, { headers: { authorization: `Bearer ${token}` } }),
  );
  t.equal('an unknown route is a 404', missing.status, 404);
  await transport.stop();
}
