/**
 * Leaf type module for {@link IExternalPayloadSource} and {@link ISessionLogSource}.
 *
 * Split out of `session-log-sources.ts` so `external-payload-resolution-contracts.ts` can depend
 * on {@link IExternalPayloadSource} without importing back from `session-log-sources.ts`, which
 * previously created an import cycle between the two.
 */

/** Workspace-neutral byte source for relative external-payload references. */
export interface IExternalPayloadSource {
  readBytes(relativePath: string, maxBytes: number): Uint8Array | undefined;
}

/** Workspace-neutral source for one session-log document and its optional payload source. */
export interface ISessionLogSource {
  /**
   * The log's text as a plain store would hold it, or `undefined` when there is no log. A source
   * that seals opens each sealed line, and fails on the first one it cannot: `ArtifactLockedError`
   * while the keys are locked, `ArtifactCorruptError` for a line that does not open, and
   * `SessionLogDecodeError` (`UNSUPPORTED_VERSION`) for one a newer build sealed. A plain source
   * meeting a sealed line throws `ArtifactLockedError` with the reason `no-keys`, since no key in
   * its process opens it.
   */
  readText(): string | undefined;
  readonly externalPayloadSource?: IExternalPayloadSource;
}
