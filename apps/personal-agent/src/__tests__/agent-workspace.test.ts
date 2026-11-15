import { mkdtempSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createPersonalAgent } from '../agent.js';
import { createProviderFromProfile } from '../provider.js';
import { startScriptedModel } from './scripted-model.js';

describe('the personal agent workspace', () => {
  let closeModel: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await closeModel?.();
    closeModel = undefined;
  });

  // A saved chat records its folder as a real path and the chat list matches chats by that spelling,
  // so a workspace named through a symlink would list no earlier chats.
  it.skipIf(process.platform === 'win32')(
    'is named by its real path when the state directory is reached through a symlink',
    async () => {
      const model = await startScriptedModel();
      closeModel = () => model.close();
      const real = realpathSync(mkdtempSync(join(tmpdir(), 'personal-agent-real-')));
      const link = join(mkdtempSync(join(tmpdir(), 'personal-agent-link-')), 'state');
      symlinkSync(real, link, 'dir');

      const agent = createPersonalAgent({
        stateDir: link,
        provider: createProviderFromProfile(
          { type: 'openai', model: 'scripted-model', baseURL: model.baseURL, apiKeyEnv: 'KEY' },
          { KEY: 'scripted-key' },
        ),
      });

      expect(agent.workspace).toBe(join(real, 'workspace'));
    },
  );
});
