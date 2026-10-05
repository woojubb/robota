import { describe, expect, it } from 'vitest';

import { withholdProviderCredential } from '../worker-credential.js';

describe('withholdProviderCredential', () => {
  it('removes the credential variable the profile names and nothing else', () => {
    const environment: NodeJS.ProcessEnv = { OPENAI_API_KEY: 'secret', PATH: '/bin' };
    withholdProviderCredential({ apiKeyEnv: 'OPENAI_API_KEY' }, false, environment);
    expect(environment).toEqual({ PATH: '/bin' });
  });

  it('keeps the variable when the owner opted it in for commands', () => {
    const environment: NodeJS.ProcessEnv = { OPENAI_API_KEY: 'secret' };
    withholdProviderCredential({ apiKeyEnv: 'OPENAI_API_KEY' }, true, environment);
    expect(environment).toEqual({ OPENAI_API_KEY: 'secret' });
  });

  it('leaves the environment alone when the profile names no variable', () => {
    const environment: NodeJS.ProcessEnv = { OPENAI_API_KEY: 'secret' };
    withholdProviderCredential({}, false, environment);
    expect(environment).toEqual({ OPENAI_API_KEY: 'secret' });
  });
});
