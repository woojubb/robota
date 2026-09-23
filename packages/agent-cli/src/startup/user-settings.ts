import { getUserSettingsPath, readSettings, SettingsParseError } from '@robota-sdk/agent-framework';

import type { TSettingsData } from '@robota-sdk/agent-framework';

/**
 * Read the user settings, presenting an unreadable file rather than throwing it at the user.
 *
 * Issue #2342. `readSettings` throws `SettingsParseError` for a file that EXISTS and does not parse —
 * deliberately, under CLI-069, because an existing settings file that fails to parse is an error
 * condition and never silently equated with a missing one. That decision is right and this does not
 * change it.
 *
 * What was missing is the presentation. The throw escaped to the top-level handler, which re-throws
 * anything that is not an IME hint, so a stray trailing comma in the settings file reached the user
 * as a **stack trace** — and almost none of the message `SettingsParseError` was written to carry
 * survives that:
 *
 * > `Settings file <path> contains invalid JSON: <reason>. Fix or delete the file, or run robota
 * > diagnose.`
 *
 * It names the file and the remedy, which is the whole point of having a typed error.
 *
 * **Narrowed to `SettingsParseError` on purpose.** A broad catch would turn every unrelated startup
 * defect into a clean exit wearing the settings message — a worse failure than the one being fixed,
 * and one that still passes a test asserting only the happy refusal.
 *
 * It lives here rather than at the call site because `cli.ts` is at its `file-size` floor: the same
 * guard inlined cost 17 lines when issue #2023 did this for the org policy and broke the freeze. The
 * second reason survives the first being removed — the presentation of a read failure belongs beside
 * the read rather than in the shell that happens to call it.
 */
export function readUserSettingsOrExit(): TSettingsData {
  try {
    return readSettings(getUserSettingsPath());
  } catch (error) {
    if (!(error instanceof SettingsParseError)) throw error;
    // allow-fallback: an unreadable settings file is terminal — surface the file and the remedy, exit
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
