import { rmSync } from 'node:fs';

import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { makeCanonicalTempDir } from '../../testing/canonical-temp-dir.js';
import { createTestFrameworkHost } from '../../testing/framework-host.js';
import { InteractiveSession } from '../interactive-session.js';

import type { IProductPromptSection } from '../../context/system-prompt-types.js';
import type { TInteractiveSessionOptions } from '../interactive-session.js';

const host = createTestFrameworkHost();

const PRODUCT_TEXT = 'PRODUCT-CORE-TEXT';
const PRODUCT: readonly IProductPromptSection[] = [{ id: 'product-core', content: PRODUCT_TEXT }];

/**
 * A live preset switch REPLACES the preset's own system prompt. A product's guidance that was folded
 * into that text went with it; a product section is carried by every rebuild, so the switch cannot
 * reach it. Driven through the real `applyPresetSystemPrompt` and the system message each provider
 * call actually carries, so a section a test re-supplied by hand could not pass for one the session kept.
 */
describe('a product section through a live preset switch', () => {
  const directories: string[] = [];
  let session: InteractiveSession | undefined;

  afterEach(async () => {
    await session?.shutdown();
    session = undefined;
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  async function startSession(
    scripted: ReturnType<typeof createScriptedProvider>,
    extra: Partial<TInteractiveSessionOptions> = {},
  ): Promise<InteractiveSession> {
    const cwd = makeCanonicalTempDir('product-sections-');
    directories.push(cwd);
    const started = new InteractiveSession({
      host,
      cwd,
      provider: scripted.provider,
      bare: true,
      defaultTools: [],
      productSections: PRODUCT,
      ...extra,
    } as TInteractiveSessionOptions);
    session = started;
    await started.whenInitialized();
    return started;
  }

  async function runTurn(target: InteractiveSession, prompt: string): Promise<void> {
    const handle = await target.submit(prompt);
    await handle.completed;
  }

  function systemMessageOfCall(
    scripted: ReturnType<typeof createScriptedProvider>,
    call: number,
  ): string {
    const system = scripted.requests[call]?.find((message) => message.role === 'system');
    return String(system?.content ?? '');
  }

  it('keeps the product section and puts it before the switched-in preset prompt', async () => {
    const scripted = createScriptedProvider([{ text: 'first' }, { text: 'second' }]);
    const active = await startSession(scripted);

    await runTurn(active, 'hello');
    expect(systemMessageOfCall(scripted, 0)).toContain(PRODUCT_TEXT);

    active.applyPresetSystemPrompt('PRESET TEXT');
    await runTurn(active, 'again');

    const system = systemMessageOfCall(scripted, 1);
    expect(system).toContain(PRODUCT_TEXT);
    expect(system).toContain('PRESET TEXT');
    expect(system.indexOf(PRODUCT_TEXT)).toBeLessThan(system.indexOf('PRESET TEXT'));
  });

  it('keeps the product section when switching again and drops the first preset prompt', async () => {
    const scripted = createScriptedProvider([{ text: 'one' }, { text: 'two' }, { text: 'three' }]);
    const active = await startSession(scripted, { presetSystemPrompt: 'PRESET SEED' });

    await runTurn(active, 'hello');
    expect(systemMessageOfCall(scripted, 0)).toContain('PRESET SEED');

    active.applyPresetSystemPrompt('PRESET ONE');
    await runTurn(active, 'second');
    active.applyPresetSystemPrompt('PRESET TWO');
    await runTurn(active, 'third');

    const second = systemMessageOfCall(scripted, 1);
    expect(second).toContain(PRODUCT_TEXT);
    expect(second).toContain('PRESET ONE');
    expect(second).not.toContain('PRESET SEED');

    const third = systemMessageOfCall(scripted, 2);
    expect(third).toContain(PRODUCT_TEXT);
    expect(third).toContain('PRESET TWO');
    expect(third).not.toContain('PRESET ONE');
    expect(third.indexOf(PRODUCT_TEXT)).toBeLessThan(third.indexOf('PRESET TWO'));
  });

  it('lists the product section in the manifest the live session keeps', async () => {
    const scripted = createScriptedProvider([{ text: 'one' }]);
    const active = await startSession(scripted);

    active.applyPresetSystemPrompt('PRESET TEXT');

    const manifest = active.getSession().getSystemPromptManifest();
    expect(manifest?.sections.map((section) => [section.id, section.source])).toEqual(
      expect.arrayContaining([
        ['product-core', 'product'],
        ['preset-system-prompt', 'preset-system-prompt'],
      ]),
    );
  });
});
