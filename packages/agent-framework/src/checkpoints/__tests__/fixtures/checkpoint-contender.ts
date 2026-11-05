import { join } from 'node:path';
import { createTrustedProjectAccessFixture } from '../../../testing/trusted-project-state-fixture.js';
import { createWorkspaceProjectMutation } from '../../../workspace-trust/index.js';
import { createDirectoryEditCheckpointState } from '../../edit-checkpoint-state-storage.js';
import { EditCheckpointStore } from '../../edit-checkpoint-store.js';

const [project, stateRoot, file, kind] = process.argv.slice(2);
if (!project || !stateRoot || !file) throw new Error('fixture arguments missing');
const access = await createTrustedProjectAccessFixture(project);
if (access.status !== 'trusted') throw new Error('fixture trust missing');
const store = new EditCheckpointStore({
  authority: access.authority,
  mutation: createWorkspaceProjectMutation(access.authority, { status: 'approved', purpose: 'concurrent checkpoint test' }),
  ...(kind === 'directory' ? { stateStorage: createDirectoryEditCheckpointState(stateRoot) } : {}),
  sealing: 'plain',
});
const checkpoint = await store.beginTurn({ sessionId: 'session_1', prompt: file });
process.send?.({ type: 'ready', id: checkpoint.id });
process.once('message', async () => {
  await store.captureFile(join(project, file));
  await store.finalizeTurn();
  process.send?.({ type: 'done', id: checkpoint.id });
  process.disconnect?.();
});
