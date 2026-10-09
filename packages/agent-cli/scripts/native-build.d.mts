export interface IProductNativeBuildOptions {
  /** Absolute consumer-owned JavaScript entry; it must create the same product host on re-entry. */
  readonly entry: string;
  /** Absolute destination for the executable. */
  readonly outfile: string;
  readonly version: string;
  readonly sourceVersion?: string;
  readonly buildMetadata?: string | null;
  /** Absolute consumer-maintained third-party notice file, copied beside the executable. */
  readonly noticesFile: string;
  /** Optional matching host target; cross-host addon packaging is refused. */
  readonly target?: 'darwin-arm64' | 'darwin-x64' | 'linux-arm64' | 'linux-x64' | 'windows-x64';
}

export function buildProductNativeBinary(options: IProductNativeBuildOptions): Promise<{
  readonly binary: string;
  readonly notices: string;
  readonly target: string;
}>;
