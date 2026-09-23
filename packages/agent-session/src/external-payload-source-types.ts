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
  readText(): string | undefined;
  readonly externalPayloadSource?: IExternalPayloadSource;
}
