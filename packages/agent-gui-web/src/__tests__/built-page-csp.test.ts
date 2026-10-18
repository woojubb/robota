/**
 * The policy the built GUI page carries. It may reach a loopback WebSocket and nothing else, run only
 * its own scripts, and open one frame: its own app sandbox page (same origin), which is what lets an
 * MCP app's document run under the sandbox page's separate policy. The policy is what Vite injects
 * into the HTML entries it builds; read here from the same plugin the build runs.
 */

import { productEnvironment } from '../../../product-config/src/__tests__/product-environment.js';

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveConfig } from 'vite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { HtmlTagDescriptor, Plugin } from 'vite';

const packageRoot = fileURLToPath(new URL('../..', import.meta.url));

function directives(policy: string): Map<string, string> {
  return new Map(
    policy.split(';').map((part) => {
      const [name = '', ...sources] = part.trim().split(/\s+/u);
      return [name, sources.join(' ')];
    }),
  );
}

describe('the built GUI page’s content-security policy', () => {
  let policy: string;

  beforeAll(async () => {
    for (const [key, value] of Object.entries(productEnvironment('cedar'))) vi.stubEnv(key, value);
    const config = await resolveConfig(
      { root: packageRoot, configFile: path.join(packageRoot, 'vite.config.ts'), logLevel: 'silent' },
      'build',
      'production',
    );
    const plugin = config.plugins.find((candidate: Plugin) => candidate.name === 'agent-built-page-csp');
    const hook = plugin?.transformIndexHtml;
    if (typeof hook !== 'function') throw new Error('the built-page policy plugin is missing');
    const tags = (hook as () => HtmlTagDescriptor[])();
    const meta = tags.find((tag) => tag.attrs?.['http-equiv'] === 'Content-Security-Policy');
    policy = String(meta?.attrs?.['content']);
  });

  afterAll(() => vi.unstubAllEnvs());

  it('lets the page open its own origin as a frame, so it can host the app sandbox page', () => {
    expect(directives(policy).get('frame-src')).toBe("'self'");
  });

  it('keeps scripts to its own files and the network to a loopback WebSocket', () => {
    const parsed = directives(policy);
    expect(parsed.get('script-src')).toBe("'self'");
    expect(parsed.get('default-src')).toBe("'self'");
    expect(parsed.get('connect-src')).toBe('ws://127.0.0.1:* ws://localhost:*');
  });

  it('admits no remote origin anywhere', () => {
    expect(policy).not.toMatch(/https?:|\*\.|unsafe-eval/u);
  });
});
