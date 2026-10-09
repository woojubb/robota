import { createServer } from 'node:http';
import {
  OrganizationBroker,
  OrganizationLedger,
  createOrganizationGitActions,
  OrganizationGitAsset,
  createOrganizationHttpHandler,
} from '../../dist/node/index.js';

process.send({ kind: 'ready' });
process.on('message', (message) => {
  if (message.kind !== 'initialize') return;
  try {
    const ledger = new OrganizationLedger(message.options);
    const asset = new OrganizationGitAsset(message.asset);
    const actions = createOrganizationGitActions(ledger, {
      resource: 'source',
      asset,
      readRoles: ['operator'],
      writeRoles: ['operator'],
      reservation: { tokens: 0, timeMs: 5000, costMicros: 0 },
    });
    const broker = new OrganizationBroker({ ledger, actions });
    const server = createServer(
      createOrganizationHttpHandler({
        broker,
        audience: message.options.audience,
      }),
    );
    server.listen(0, '127.0.0.1', () =>
      process.send({
        kind: 'initialized',
        endpoint: `http://127.0.0.1:${server.address().port}`,
      }),
    );
  } catch {
    process.send({ kind: 'fixture-error' });
  }
});
