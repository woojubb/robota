/**
 * CONFIG-002: `updateModelInSettings` writes the active model into
 * `providers[currentProvider]`. When the settings file names no active profile there is nothing
 * the canonical loader would accept, so the writer refuses instead of emitting the legacy flat
 * `provider` shape that `loadConfig()` rejects.
 */
export class NoCurrentProviderProfileError extends Error {
  readonly filePath: string;

  constructor(filePath: string) {
    super(
      `Settings file ${filePath} has no active provider profile ("currentProvider" + "providers"); ` +
        'the model cannot be updated. Run provider setup first.',
    );
    this.name = 'NoCurrentProviderProfileError';
    this.filePath = filePath;
  }
}
