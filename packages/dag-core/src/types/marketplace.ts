/** Metadata embedded in a third-party node package's package.json under the "robota-dag" key. */
export interface INodePackageManifestEntry {
  readonly nodeType: string;
  readonly displayName: string;
  readonly category: string;
  readonly description?: string;
  readonly defaultInputPort?: string;
  readonly defaultOutputPort?: string;
}

/** The "robota-dag" field shape in a third-party node package's package.json. */
export interface INodePackageManifest {
  readonly type: 'node-package';
  readonly schemaVersion: '1';
  readonly nodes: ReadonlyArray<INodePackageManifestEntry>;
}

/** A discovered external node package with registry metadata. */
export interface IExternalNodePackage {
  readonly name: string;
  readonly version: string;
  readonly description?: string;
  readonly nodeManifest: INodePackageManifest;
  readonly resolvedPath: string;
}
