import { describe, expect, it } from 'vitest';

import * as commandApi from '../command-api/index.js';
import * as commands from '../commands/index.js';
import * as sdk from '../index.js';
import * as plugins from '../plugins/index.js';

describe('agent-sdk public API', () => {
  it('exposes SDK-owned prompt file-reference helpers', () => {
    expect(typeof sdk.parsePromptFileReferences).toBe('function');
    expect(typeof sdk.resolvePromptFileReferences).toBe('function');
    expect(typeof sdk.resolvePromptFileReferencePaths).toBe('function');
    expect(typeof sdk.buildPromptWithFileReferences).toBe('function');
    expect(typeof sdk.listCommandContextReferences).toBe('function');
    expect(typeof sdk.addCommandContextReference).toBe('function');
    expect(typeof sdk.createContextReferenceItem).toBe('function');
    expect(typeof sdk.buildLanguageCommandSubcommands).toBe('function');
  });

  it('does not expose automatic memory orchestration from the top-level package', () => {
    expect('AutomaticMemoryController' in sdk).toBe(false);
    expect('DEFAULT_AUTOMATIC_MEMORY_CONFIG' in sdk).toBe(false);
    expect('normalizeAutomaticMemoryConfig' in sdk).toBe(false);
  });

  it('does not pass through lower-level package utilities as top-level SDK runtime exports', () => {
    expect('evaluatePermission' in sdk).toBe(false);
    expect('runHooks' in sdk).toBe(false);
    expect('TRUST_TO_MODE' in sdk).toBe(false);
    expect('messageToHistoryEntry' in sdk).toBe(false);
    expect('getMessagesForAPI' in sdk).toBe(false);
  });

  it('exposes authority validation without exposing a production-capable issuer', () => {
    expect(typeof sdk.WorkspaceTrustService).toBe('function');
    expect(typeof sdk.assertWorkspaceProjectAuthority).toBe('function');
    expect('mintWorkspaceProjectAuthority' in sdk).toBe(false);
    expect('createWorkspaceProjectAuthority' in sdk).toBe(false);
  });

  it('does not expose path-based provider helpers from the command API barrel', () => {
    expect('checkSettingsFile' in commandApi).toBe(false);
    expect('resolveProviderSettingsWriteTargetPath' in commandApi).toBe(false);
    expect('readMergedProviderSettingsFromPaths' in commandApi).toBe(false);
  });

  it('does not expose path-based provider helpers from the commands barrel', () => {
    expect('checkSettingsFile' in commands).toBe(false);
    expect('resolveProviderSettingsWriteTargetPath' in commands).toBe(false);
    expect('readMergedProviderSettingsFromPaths' in commands).toBe(false);
  });

  it('does not expose the ambient plugin settings store from the plugin barrel', () => {
    expect('PluginSettingsStore' in plugins).toBe(false);
  });
});
