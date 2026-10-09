import { appendFileSync } from 'node:fs';
import { OrganizationLedger } from '../../dist/node/index.js';

process.send({ kind: 'ready' });
process.on('message', (message) => {
  if (message.kind !== 'reserve') return;
  let ledger;
  try {
    ledger = new OrganizationLedger(message.options);
    const result = ledger.reserve(
      message.call.request,
      message.reservation,
      message.call.approval,
      false,
    );
    if (message.effectPath !== undefined && result.kind === 'reserved')
      appendFileSync(message.effectPath, 'external-effect\n');
    process.send({ kind: 'result', result: result.kind });
  } catch (error) {
    process.send({ kind: 'result', result: error.reason ?? 'unexpected' });
  } finally {
    ledger?.close();
  }
});
