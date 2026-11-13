import type { ICliRuntimeContext } from '../product/runtime-context.js';
import { SettingsParseError } from '@robota-sdk/agent-framework';
import { readSettings } from '@robota-sdk/agent-framework/node';
import { productUserSettingsPath } from '../product/user-settings.js';

import type { TSettingsData } from '@robota-sdk/agent-framework';

/**
 * Read the user settings, presenting an unreadable file rather than throwing it at the user.
 *
 * `readSettings` throws `SettingsParseError` for a file that EXISTS and does not parse —
 * deliberately, because an existing settings file that fails to parse is an error
 * condition and never silently equated with a missing one. That decision is right and this does not
 * change it.
 *
 * What was missing is the presentation. The throw escaped to the top-level handler, which re-throws
 * anything that is not an IME hint, so a stray trailing comma in the settings file reached the user
 * as a **stack trace** — and almost none of the message `SettingsParseError` was written to carry
 * survives that:
 *
 * > `Settings file <path> contains invalid JSON: <reason>. Fix or delete the file. Run ${runtime.vocabulary.cliName} doctor
 * > for diagnostics.`
 *
 * It names the file and the remedy, which is the whole point of having a typed error.
 *
 * **Narrowed to `SettingsParseError` on purpose.** A broad catch would turn every unrelated startup
 * defect into a clean exit wearing the settings message — a worse failure than the one being fixed,
 * and one that still passes a test asserting only the happy refusal.
 *
 * It lives here rather than at the call site because the presentation of a read failure belongs
 * beside the read rather than in the shell that happens to call it.
 */
export function readUserSettingsOrExit(runtime: ICliRuntimeContext): TSettingsData {
  try {
    return readSettings(productUserSettingsPath(runtime));
  } catch (error) {
    if (!(error instanceof SettingsParseError)) throw error;
    // allow-fallback: an unreadable settings file is terminal — surface the file and the remedy, exit
    process.stderr.write(
      `${error.message} Run ${runtime.vocabulary.cliName} doctor for diagnostics.\n`,
    );
    process.exit(1);
  }
}
