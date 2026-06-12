/**
 * CLI-069: an EXISTING settings file that fails to parse is an error condition,
 * never silently equated with a missing file (forbidden-fallback class). Thrown
 * by the settings readers; session start propagates it (fail fast, exit 1),
 * reporting consumers (e.g. diagnose) catch it and present it as a finding.
 */
export class SettingsParseError extends Error {
  readonly filePath: string;

  constructor(filePath: string, parseMessage: string) {
    super(
      `Settings file ${filePath} contains invalid JSON: ${parseMessage}. ` +
        'Fix or delete the file, or run robota diagnose.',
    );
    this.name = 'SettingsParseError';
    this.filePath = filePath;
  }
}
