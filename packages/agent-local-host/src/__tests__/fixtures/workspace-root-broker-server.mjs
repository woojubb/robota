import { startWorkspaceRootBroker } from '../../workspace-root-broker.ts';

const [endpoint, lockDirectory, history] = process.argv.slice(2);
if (!endpoint) throw new Error('A broker endpoint is required.');
const broker = await startWorkspaceRootBroker(endpoint, lockDirectory, history);
process.stdout.write('READY\n');
process.send?.('ready');
process.once('SIGTERM', () => {
  void broker.close().then(() => { process.exitCode = 0; });
});
