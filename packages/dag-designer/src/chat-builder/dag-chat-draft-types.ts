import type {
  IDagDefinition,
  IDagEdgeDefinition,
  IDagNode,
  INodeConfigObject,
  INodeObjectInfo,
} from '@robota-sdk/dag-core';

export type TDagChatDraftStatus = 'applied' | 'empty-prompt' | 'needs-catalog' | 'no-plan';

export type TDagChatDraftWarningCode =
  | 'DAG_CHAT_CATALOG_REQUIRED'
  | 'DAG_CHAT_PROMPT_REQUIRED'
  | 'DAG_CHAT_NO_COMPATIBLE_PLAN';

export interface IDagChatDraftWarning {
  code: TDagChatDraftWarningCode;
  message: string;
}

export interface IDagChatDraftMessage {
  role: 'assistant';
  content: string;
}

export interface IDagChatDraftInput {
  prompt: string;
  definition: IDagDefinition;
  objectInfo: Record<string, INodeObjectInfo>;
}

export interface IDagChatDraftResult {
  status: TDagChatDraftStatus;
  definition: IDagDefinition;
  message: IDagChatDraftMessage;
  addedNodeIds: string[];
  warnings: IDagChatDraftWarning[];
}

export interface IPortDescriptor {
  key: string;
  normalizedKey: string;
  typeName: string;
  isImage: boolean;
  isVideo: boolean;
  isText: boolean;
  isLikelyList: boolean;
}

export interface ICatalogEntry {
  nodeType: string;
  info: INodeObjectInfo;
  searchText: string;
  inputs: IPortDescriptor[];
  outputs: IPortDescriptor[];
}

export interface IChatIntent {
  wantsImage: boolean;
  wantsVideo: boolean;
  wantsCompose: boolean;
  imageSourceCount: number;
}

export interface IDraftNodeInput {
  entry: ICatalogEntry;
  nodeId: string;
  column: number;
  row: number;
  config?: INodeConfigObject;
}

export interface IDraftAccumulator {
  usedNodeIds: Set<string>;
  nodes: IDagNode[];
  edges: IDagEdgeDefinition[];
  addedNodeIds: string[];
}
