import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTrustedProjectAccessFixture } from '../../../testing/trusted-project-state-fixture.js';
import { createWorkspaceProjectMutation } from '../../../workspace-trust/index.js';
import { createDirectoryEditCheckpointState } from '../../edit-checkpoint-state-storage.js';
import { EditCheckpointStore } from '../../edit-checkpoint-store.js';

const [project, stateRoot, replacement, kind] = process.argv.slice(2);
if (!project || !stateRoot || !replacement) throw new Error('fixture arguments missing');
const access = await createTrustedProjectAccessFixture(project);
if (access.status !== 'trusted') throw new Error('fixture trust missing');
const store = new EditCheckpointStore({
  authority: access.authority,
  mutation: createWorkspaceProjectMutation(access.authority, {
    status: 'approved',
    purpose: 'checkpoint ordering test',
  }),
  ...(kind === 'directory' ? { stateStorage: createDirectoryEditCheckpointState(stateRoot) } : {}),
  sealing: 'plain',
});
try {
  const checkpoint = await store.beginTurn({ sessionId: 'session_1', prompt: replacement });
  process.send?.({ type: 'ready', id: checkpoint.id });
  process.on('message', async (message) => {
    if (message === 'capture') {
      await store.captureFile(join(project, 'same.txt'));
      writeFileSync(join(project, 'same.txt'), replacement);
      process.send?.({ type: 'captured', id: checkpoint.id });
    } else if (message === 'finish') {
      await store.finalizeTurn();
      process.send?.({ type: 'done', id: checkpoint.id });
      process.disconnect?.();
    }
  });
} catch (error) {
  process.send?.({ type: 'refused', message: String(error) });
  process.disconnect?.();
}
