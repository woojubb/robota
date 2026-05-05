import type {
  IDagError,
  INodeManifest,
  INodeObjectInfo,
  TObjectInfo,
  TResult,
  TInputTypeSpec,
} from '@robota-sdk/dag-core';
import type { INodeCatalogService } from '@robota-sdk/dag-api';

export class BundledNodeCatalogService implements INodeCatalogService {
  private readonly manifestByNodeType = new Map<string, INodeManifest>();

  public constructor(private readonly manifests: INodeManifest[]) {
    for (const manifest of manifests) {
      this.manifestByNodeType.set(manifest.nodeType, manifest);
    }
  }

  public async hasNodeType(nodeType: string): Promise<TResult<boolean, IDagError>> {
    return { ok: true, value: this.manifestByNodeType.has(nodeType) };
  }

  public async listObjectInfo(): Promise<TResult<TObjectInfo, IDagError>> {
    const objectInfo: TObjectInfo = {};
    for (const manifest of this.manifests) {
      objectInfo[manifest.nodeType] = manifestToObjectInfo(manifest);
    }
    return { ok: true, value: objectInfo };
  }
}

function manifestToObjectInfo(manifest: INodeManifest): INodeObjectInfo {
  return {
    display_name: manifest.displayName,
    category: manifest.category,
    input: {
      required: portsToInputSpec(manifest.inputs.filter((port) => port.required)),
      optional: portsToInputSpec(manifest.inputs.filter((port) => !port.required)),
    },
    output: manifest.outputs.map((port) => port.type),
    output_is_list: manifest.outputs.map((port) => port.isList ?? false),
    output_name: manifest.outputs.map((port) => port.key),
    output_node: manifest.outputs.length === 0,
    description: '',
  };
}

function portsToInputSpec(ports: INodeManifest['inputs']): Record<string, TInputTypeSpec> {
  const inputSpec: Record<string, TInputTypeSpec> = {};
  for (const port of ports) {
    inputSpec[port.key] = [port.type];
  }
  return inputSpec;
}
