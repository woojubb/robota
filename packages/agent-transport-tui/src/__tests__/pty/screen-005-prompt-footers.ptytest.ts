/**
 * SCREEN-005 User Execution Test Scenarios — prompt footers and key-hint affordance on the BUILT
 * robota binary in a real PTY (run by `test:pty`; requires `pnpm build:deps` first).
 *
 * Scenario 1: `/` opens the autocomplete → unified footer + `> ` indicator on the selected row.
 * Scenario 2: a replayed model turn drives a CMD-004 ask in each shape (single-select,
 *   multi-select with the dynamic `(min N)` segment, free-text) → all footers share the grammar.
 * Scenario 3: a replayed Shell tool call opens the permission prompt → footer names the real keys
 *   (`←→ Navigate · Enter Confirm`, no Esc); pressing Esc resolves nothing (documented hard-stop).
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { spawnTui, writeTuiProviderSettings } from './pty-driver.js';
import { formatKeyHints } from '../../key-hint-footer.js';
import { LIST_PICKER_DEFAULT_FOOTER_HINTS } from '../../ListPicker.js';
import { getMultiSelectFooterHints } from '../../MultiSelectList.js';
import { PERMISSION_PROMPT_FOOTER_HINTS } from '../../PermissionPrompt.js';
import { SLASH_AUTOCOMPLETE_FOOTER_HINTS } from '../../SlashAutocomplete.js';
import { TEXT_PROMPT_FOOTER_HINTS } from '../../TextPrompt.js';

import type { IPtySession } from './pty-driver.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const ASK_SHAPES_FIXTURE = join(FIXTURES, 'screen-005-ask-shapes.jsonl');
const PERMISSION_FIXTURE = join(FIXTURES, 'screen-005-permission.jsonl');

function escapeRegExp(text: string): RegExp {
  return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('SCREEN-005 prompt footers through the real binary', () => {
  let projectDir: string;
  let session: IPtySession | undefined;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'robota-screen005-pty-'));
    writeTuiProviderSettings(projectDir);
  });

  afterEach(async () => {
    await session?.disposeAsync();
    session = undefined;
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('S1: slash autocomplete shows the unified footer and the > indicator on the selected row', async () => {
    session = spawnTui({ projectDir, homeDir: join(projectDir, 'home') });
    await session.waitFor(/Type a message or \/help/);

    await session.sendKeys('/');
    const expectedFooter = formatKeyHints(SLASH_AUTOCOMPLETE_FOOTER_HINTS);
    await session.waitFor(escapeRegExp(expectedFooter), 20_000);

    const frame = session.snapshot();
    expect(frame).toContain(expectedFooter);
    // The highlighted first row carries the selection indicator in front of the command name.
    expect(frame).toMatch(/> \/\w+/);
  }, 60_000);

  it('S2: single-select, multi-select (dynamic min segment), and free-text asks share the grammar', async () => {
    session = spawnTui({
      projectDir,
      homeDir: join(projectDir, 'home'),
      args: ['--session-log', ASK_SHAPES_FIXTURE, '--name', 'shapes-fixture'],
    });
    await session.waitFor(/Type a message or \/help/);

    await session.sendKeys('go');
    await session.pressEnter();

    // Shape 1 — single-select (ListPicker default footer).
    await session.waitFor(/PICK_SINGLE/, 20_000);
    await session.waitFor(escapeRegExp(formatKeyHints(LIST_PICKER_DEFAULT_FOOTER_HINTS)), 10_000);
    expect(session.snapshot()).toContain('> Red'); // indicator on the highlighted option
    await session.pressEnter(); // answer "Red"

    // Shape 2 — multi-select: min segment shows until satisfiable, then drops.
    await session.waitFor(/PICK_MULTI/, 20_000);
    const unsatisfied = formatKeyHints(
      getMultiSelectFooterHints({ canConfirm: false, minSelect: 1 }),
    );
    await session.waitFor(escapeRegExp(unsatisfied), 10_000);
    const beforeToggle = session.outputOffset();
    await session.sendKeys(' '); // toggle Alpha → selection satisfiable
    const satisfied = formatKeyHints(getMultiSelectFooterHints({ canConfirm: true, minSelect: 1 }));
    await session.waitForSince(beforeToggle, escapeRegExp(satisfied), 10_000);
    await session.pressEnter(); // confirm

    // Shape 3 — free-text (TextPrompt footer).
    await session.waitFor(/TYPE_TEXT/, 20_000);
    await session.waitFor(escapeRegExp(formatKeyHints(TEXT_PROMPT_FOOTER_HINTS)), 10_000);
    await session.sendKeys('hello');
    await session.pressEnter();

    // The replayed follow-up proves every ask resolved through the shared-grammar prompts.
    await session.waitFor(/ALL_SHAPES_DONE/, 20_000);
  }, 60_000);

  it('S3: permission prompt names the real keys and Esc resolves nothing (explicit hard-stop)', async () => {
    session = spawnTui({
      projectDir,
      homeDir: join(projectDir, 'home'),
      args: ['--session-log', PERMISSION_FIXTURE, '--name', 'perm-fixture'],
    });
    await session.waitFor(/Type a message or \/help/);

    await session.sendKeys('go');
    await session.pressEnter();

    // The replayed Shell call needs approval in default permission mode → prompt renders.
    await session.waitFor(/Permission Required/, 20_000);
    const expectedFooter = formatKeyHints(PERMISSION_PROMPT_FOOTER_HINTS);
    await session.waitFor(escapeRegExp(expectedFooter), 10_000);

    // Esc is suppressed (a dismissal would be an implicit deny): nothing resolves, the prompt stays.
    session.pressEscape();
    await delay(500);
    const afterEsc = session.snapshot();
    expect(afterEsc).not.toContain('AFTER_PERMISSION_FLOW');
    expect(afterEsc).toContain('Allow [y]'); // prompt still displayed, still unresolved

    // Resolve explicitly (allow) → the tool runs and the turn continues.
    await session.sendKeys('y');
    await session.waitFor(/AFTER_PERMISSION_FLOW/, 20_000);
  }, 60_000);
});
