/**
 * A session that is told where its bundle plugins live needs a host that lends files to read them
 * through. A host that lends none refuses at construction rather than starting with no plugin at all
 * and no word why; a session that names no plugin directory needs no files.
 */

import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { describe, expect, it } from 'vitest';

import { InteractiveSession } from '../interactive-session.js';
import { createTestFrameworkHost } from '../../testing/framework-host.js';

import type { IFrameworkHost } from '../../host/framework-host.js';
import type { TInteractiveSessionOptions } from '../interactive-session-options.js';

const provider = createScriptedProvider([]).provider;

function optionsFor(
  host: IFrameworkHost,
  pluginDirectories?: { user?: string; project?: string },
): TInteractiveSessionOptions {
  return {
    host,
    cwd: process.cwd(),
    provider,
    ...(pluginDirectories === undefined ? {} : { pluginDirectories }),
  } as unknown as TInteractiveSessionOptions;
}

describe('pluginDirectories on a host', () => {
  it('without files refuses at construction and says what the host must lend', () => {
    const host = createTestFrameworkHost({ files: undefined });
    expect(() => new InteractiveSession(optionsFor(host, { user: '/plugins' }))).toThrow(
      /`pluginDirectories` need file access[\s\S]*`host\.files`/u,
    );
  });

  it('without files is fine when no plugin directory is named', () => {
    const host = createTestFrameworkHost({ files: undefined });
    expect(() => new InteractiveSession(optionsFor(host))).not.toThrow();
  });

  it('with files is read through them', () => {
    const host = createTestFrameworkHost();
    expect(() => new InteractiveSession(optionsFor(host, { user: '/plugins' }))).not.toThrow();
  });
});
