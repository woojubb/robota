import { describe, expect, it } from 'vitest';
import { createRestrictedWorkspaceProjectAccess } from '@robota-sdk/agent-framework';
import {
  formatHeadlessWorkspaceTrustError,
  formatHeadlessRestrictedNotice,
} from '../workspace-trust-admission.js';

describe('headless trust guidance', () => {
  it('names the configured product command in an untrusted refusal', () => {
    const access = createRestrictedWorkspaceProjectAccess('untrusted', '/workspace');
    expect(formatHeadlessWorkspaceTrustError(access, '/workspace', 'cedar')).toContain(
      'cedar trust --yes',
    );
  });

  it('reports Restricted mode and every ignored configured project settings source in one line', () => {
    const notice = formatHeadlessRestrictedNotice([
      { relativePath: '.amber/settings.json' },
      { relativePath: '.shared/settings.local.json' },
    ]);
    expect(notice).toContain('Restricted workspace mode');
    expect(notice).toContain('.amber/settings.json');
    expect(notice).toContain('.shared/settings.local.json');
    expect(notice).not.toContain('\n');
  });
});
