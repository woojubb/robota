/**
 * A supervised runtime built by the real CLI composition (`startCli`): the startup resume decision,
 * the workspace's session store, the served runtime and its claim of the session it opens. Only the
 * product identity, the trusted-workspace answer and the model provider are doubles; the runtime
 * never calls the model.
 */
import { createScriptedProvider } from '@robota-sdk/agent-core/testing';

import { createTestProductRuntime } from '../../../__tests__/helpers/product-runtime.js';
import { createTrustedWorkspaceProjectAccess } from '../../../__tests__/helpers/trusted-workspace-project-access.js';
import { startCli } from '../../../cli.js';

const home = process.env['PRODUCT_TEST_HOME'];
const stateRoot = process.env['PRODUCT_TEST_STATE_ROOT'];
if (home === undefined || stateRoot === undefined) {
  throw new Error(
    'the served real-composition fixture needs PRODUCT_TEST_HOME and PRODUCT_TEST_STATE_ROOT',
  );
}

const scripted = createScriptedProvider([{ text: 'SERVED_REPLY' }]);

await startCli({
  productRuntime: createTestProductRuntime('test-product', {
    HOME: home,
    PRODUCT_USER_STATE_DIR: stateRoot,
    PRODUCT_CACHE_DIR: `${stateRoot}/cache`,
    PRODUCT_LOG_DIR: `${stateRoot}/logs`,
  }),
  providerDefinitions: [
    {
      type: 'scripted',
      defaults: { model: 'scripted-model' },
      requiresApiKey: false,
      createProvider: () => scripted.provider,
    },
  ],
  projectAccess: await createTrustedWorkspaceProjectAccess(process.cwd()),
});
