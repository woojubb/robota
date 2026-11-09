import { startWorkspaceRootBroker } from '../../workspace-root-broker.ts';

const endpoint = process.argv[2];
if (!endpoint) throw new Error('A broker endpoint is required.');
const broker = await startWorkspaceRootBroker(endpoint);
process.stdout.write('READY\n');
process.once('SIGTERM', () => {
  void broker.close().then(() => { process.exitCode = 0; });
});
