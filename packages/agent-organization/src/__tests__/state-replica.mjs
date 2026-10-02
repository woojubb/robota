import { createServer } from 'node:http';
import {
  OrganizationBroker,
  OrganizationLedger,
  createOrganizationStateActions,
  createOrganizationHttpHandler,
} from '../../dist/node/index.js';

process.send({ kind: 'ready' });
process.on('message', (message) => {
  if (message.kind !== 'initialize') return;
  try {
    const ledger = new OrganizationLedger(message.options);
    const installed = createOrganizationStateActions(ledger, {
      resource: 'board',
      readRoles: ['operator'],
      writeRoles: ['operator'],
      writeRequiresApproval: false,
      reservation: { tokens: 0, timeMs: 1000, costMicros: 0 },
    });
    const actions = installed.map((action) =>
      message.loseWriteAck && action.operation === 'state.write'
        ? {
            ...action,
            execute: async (operation, context) => {
              await action.execute(operation, context);
              process.send({ kind: 'committed' });
              return new Promise(() => {});
            },
          }
        : action,
    );
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
