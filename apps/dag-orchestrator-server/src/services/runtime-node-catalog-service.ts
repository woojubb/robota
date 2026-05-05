import type { INodeCatalogService } from '@robota-sdk/dag-api';
import type { IDagError, TObjectInfo, TResult } from '@robota-sdk/dag-core';
import type { IPromptApiClientPort } from '@robota-sdk/dag-orchestrator';

const NODE_TYPE_NOT_FOUND_CODES = new Set(['NODE_TYPE_NOT_FOUND', 'HTTP_404']);

export class RuntimeNodeCatalogService implements INodeCatalogService {
  public constructor(
    private readonly promptApiClient: Pick<IPromptApiClientPort, 'getObjectInfo'>,
  ) {}

  public async listObjectInfo(): Promise<TResult<TObjectInfo, IDagError>> {
    return this.promptApiClient.getObjectInfo();
  }

  public async hasNodeType(nodeType: string): Promise<TResult<boolean, IDagError>> {
    const result = await this.promptApiClient.getObjectInfo(nodeType);
    if (!result.ok) {
      if (NODE_TYPE_NOT_FOUND_CODES.has(result.error.code)) {
        return { ok: true, value: false };
      }
      return result;
    }
    return { ok: true, value: Object.hasOwn(result.value, nodeType) };
  }
}
