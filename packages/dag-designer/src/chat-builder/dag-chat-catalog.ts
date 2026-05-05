import type { INodeObjectInfo, TInputTypeSpec, TObjectInfo } from '@robota-sdk/dag-core';
import type { ICatalogEntry, IChatIntent, IPortDescriptor } from './dag-chat-draft-types.js';
const IMAGE_TERMS = ['image', 'photo', 'picture', '이미지', '사진', '그림'];
const VIDEO_TERMS = ['video', 'movie', 'animation', '비디오', '영상', '동영상'];
const COMPOSE_TERMS = [
  'compose',
  'merge',
  'blend',
  'combine',
  'two',
  '2',
  '둘',
  '두 ',
  '두개',
  '두 장',
  '합성',
];
const EDIT_TERMS = ['edit', 'generate', 'create', '만들', '생성', '편집'];

const IMAGE_SOURCE_BASE_SCORE = 30;
const TEXT_SOURCE_BASE_SCORE = 25;
const IMAGE_TARGET_BASE_SCORE = 30;
const IMAGE_EDIT_BASE_SCORE = 20;
const VIDEO_BASE_SCORE = 40;
const TEXT_NODE_BASE_SCORE = 10;
const EXACT_IMAGE_SOURCE_SCORE = 80;
const EXACT_INPUT_SCORE = 80;
const EXACT_COMPOSE_SCORE = 90;
const EXACT_EDIT_SCORE = 80;
const EXACT_VIDEO_SCORE = 90;
const EXACT_LLM_SCORE = 70;
const SOURCE_TERM_SCORE = 20;
const LOAD_TERM_SCORE = 12;
const INPUT_TERM_SCORE = 20;
const TEXT_INPUT_SCORE = 10;
const COMPOSE_TERM_SCORE = 35;
const RELATED_TERM_SCORE = 20;
const EDIT_TERM_SCORE = 30;
const GENERATE_TERM_SCORE = 15;
const VIDEO_IMAGE_INPUT_SCORE = 10;
const VIDEO_TEXT_INPUT_SCORE = 15;
const VIDEO_TERM_SCORE = 30;
const LLM_TERM_SCORE = 30;
const OUTPUT_TERM_SCORE = 8;
const SOURCE_WITHOUT_IMAGE_INPUT_SCORE = 8;
const TEXT_NODE_INPUT_SCORE = 15;
const DEFAULT_SOURCE_COUNT = 1,
  COMPOSE_SOURCE_COUNT = 2;

export interface IDagChatCandidates {
  imageSource?: ICatalogEntry;
  promptSource?: ICatalogEntry;
  imageCompose?: ICatalogEntry;
  imageEdit?: ICatalogEntry;
  videoNode?: ICatalogEntry;
  textNode?: ICatalogEntry;
}

export function createCatalog(objectInfo: TObjectInfo): ICatalogEntry[] {
  return Object.entries(objectInfo).map(([nodeType, info]) => {
    const searchText = [nodeType, info.display_name, info.category, info.description]
      .join(' ')
      .toLowerCase();
    return {
      nodeType,
      info,
      searchText,
      inputs: createInputDescriptors(info),
      outputs: createOutputDescriptors(info),
    };
  });
}

export function detectIntent(prompt: string): IChatIntent {
  const normalizedPrompt = prompt.toLowerCase();
  const wantsVideo = includesAny(normalizedPrompt, VIDEO_TERMS);
  const wantsCompose = includesAny(normalizedPrompt, COMPOSE_TERMS);
  const wantsImage =
    wantsCompose ||
    wantsVideo ||
    includesAny(normalizedPrompt, IMAGE_TERMS) ||
    includesAny(normalizedPrompt, EDIT_TERMS);
  return {
    wantsImage,
    wantsVideo,
    wantsCompose,
    imageSourceCount: wantsCompose ? COMPOSE_SOURCE_COUNT : DEFAULT_SOURCE_COUNT,
  };
}

export function createCandidates(catalog: ICatalogEntry[]): IDagChatCandidates {
  return {
    imageSource: pickBest(catalog, scoreImageSource),
    promptSource: pickBest(catalog, scoreTextSource),
    imageCompose: pickBest(catalog, scoreImageCompose),
    imageEdit: pickBest(catalog, scoreImageEdit),
    videoNode: pickBest(catalog, scoreVideoNode),
    textNode: pickBest(catalog, scoreTextNode),
  };
}

export function findInputKey(
  entry: ICatalogEntry | undefined,
  kind: 'image' | 'text' | 'video',
  preferredKeys: string[],
): IPortDescriptor | undefined {
  if (!entry) {
    return undefined;
  }
  const candidates = entry.inputs.filter((input) => matchesKind(input, kind));
  return pickPreferredPort(candidates, preferredKeys);
}

export function findOutputKey(
  entry: ICatalogEntry | undefined,
  kind: 'image' | 'text' | 'video',
): string | undefined {
  if (!entry) {
    return undefined;
  }
  return entry.outputs.find((output) => matchesKind(output, kind))?.key;
}

export function formatInputBindingKey(port: IPortDescriptor, index: number | undefined): string {
  if (typeof index !== 'number') {
    return port.key;
  }
  if (port.isLikelyList) {
    return `${port.key}[${index}]`;
  }
  return port.key;
}

export function toNodeIdBase(value: string): string {
  const normalized = value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  return normalized || 'node';
}

function createInputDescriptors(info: INodeObjectInfo): IPortDescriptor[] {
  const descriptors: IPortDescriptor[] = [];
  for (const [key, spec] of Object.entries(info.input.required ?? {})) {
    descriptors.push(createPortDescriptor(key, readInputSpecType(spec)));
  }
  for (const [key, spec] of Object.entries(info.input.optional ?? {})) {
    descriptors.push(createPortDescriptor(key, readInputSpecType(spec)));
  }
  return descriptors;
}

function createOutputDescriptors(info: INodeObjectInfo): IPortDescriptor[] {
  return info.output.map((typeName, index) => {
    const outputName = info.output_name[index] ?? typeName;
    return createPortDescriptor(outputName, typeName);
  });
}

function createPortDescriptor(key: string, typeName: string): IPortDescriptor {
  const normalizedKey = normalizeText(key);
  const normalizedType = normalizeText(typeName);
  return {
    key: normalizePortKey(key),
    normalizedKey,
    typeName: normalizedType,
    isImage: normalizedKey.includes('image') || normalizedType.includes('image'),
    isVideo: normalizedKey.includes('video') || normalizedType.includes('video'),
    isText:
      normalizedKey.includes('text') ||
      normalizedKey.includes('prompt') ||
      normalizedKey.includes('completion') ||
      normalizedType.includes('string') ||
      normalizedType.includes('text'),
    isLikelyList: normalizedKey.endsWith('s') || normalizedKey.includes('list'),
  };
}

function readInputSpecType(spec: TInputTypeSpec | string[]): string {
  const first = spec[0];
  if (typeof first === 'string') {
    return first;
  }
  return 'UNKNOWN';
}

function includesAny(value: string, terms: string[]): boolean {
  return terms.some((term) => value.includes(term));
}

function pickBest(
  catalog: ICatalogEntry[],
  scoreEntry: (entry: ICatalogEntry) => number,
): ICatalogEntry | undefined {
  let bestEntry: ICatalogEntry | undefined;
  let bestScore = 0;
  for (const entry of catalog) {
    const score = scoreEntry(entry);
    if (score > bestScore) {
      bestEntry = entry;
      bestScore = score;
    }
  }
  return bestEntry;
}

function scoreImageSource(entry: ICatalogEntry): number {
  if (!entry.outputs.some((output) => output.isImage)) return 0;
  let score = IMAGE_SOURCE_BASE_SCORE;
  if (!entry.inputs.some((port) => port.isImage)) score += SOURCE_WITHOUT_IMAGE_INPUT_SCORE;
  if (entry.nodeType === 'image-source') score += EXACT_IMAGE_SOURCE_SCORE;
  if (entry.searchText.includes('source')) score += SOURCE_TERM_SCORE;
  if (entry.searchText.includes('load')) score += LOAD_TERM_SCORE;
  return score;
}

function scoreTextSource(entry: ICatalogEntry): number {
  if (!entry.outputs.some((output) => output.isText) || entry.inputs.length > 0) return 0;
  let score = TEXT_SOURCE_BASE_SCORE;
  if (entry.nodeType === 'input') score += EXACT_INPUT_SCORE;
  if (entry.searchText.includes('input')) score += INPUT_TERM_SCORE;
  return score;
}

function scoreImageCompose(entry: ICatalogEntry): number {
  if (!entry.outputs.some((output) => output.isImage) || !hasInput(entry, 'image')) return 0;
  let score = IMAGE_TARGET_BASE_SCORE;
  if (hasInput(entry, 'text')) score += TEXT_INPUT_SCORE;
  if (entry.nodeType === 'gemini-image-compose') score += EXACT_COMPOSE_SCORE;
  if (entry.searchText.includes('compose')) score += COMPOSE_TERM_SCORE;
  if (entry.searchText.includes('merge') || entry.searchText.includes('blend')) {
    score += RELATED_TERM_SCORE;
  }
  return score;
}

function scoreImageEdit(entry: ICatalogEntry): number {
  if (!entry.outputs.some((output) => output.isImage) || !hasInput(entry, 'image')) return 0;
  let score = IMAGE_EDIT_BASE_SCORE;
  if (hasInput(entry, 'text')) score += TEXT_INPUT_SCORE;
  if (entry.nodeType === 'gemini-image-edit') score += EXACT_EDIT_SCORE;
  if (entry.searchText.includes('edit')) score += EDIT_TERM_SCORE;
  if (entry.searchText.includes('generate')) score += GENERATE_TERM_SCORE;
  return score;
}

function scoreVideoNode(entry: ICatalogEntry): number {
  if (!entry.outputs.some((output) => output.isVideo)) return 0;
  let score = VIDEO_BASE_SCORE;
  if (hasInput(entry, 'text')) score += VIDEO_TEXT_INPUT_SCORE;
  if (hasInput(entry, 'image')) score += VIDEO_IMAGE_INPUT_SCORE;
  if (entry.nodeType === 'seedance-video') score += EXACT_VIDEO_SCORE;
  if (entry.searchText.includes('video')) score += VIDEO_TERM_SCORE;
  return score;
}

function scoreTextNode(entry: ICatalogEntry): number {
  if (!entry.outputs.some((output) => output.isText)) return 0;
  let score = TEXT_NODE_BASE_SCORE;
  if (hasInput(entry, 'text')) score += TEXT_NODE_INPUT_SCORE;
  if (entry.nodeType === 'llm-text-openai') score += EXACT_LLM_SCORE;
  if (entry.searchText.includes('llm')) score += LLM_TERM_SCORE;
  if (entry.searchText.includes('output')) score += OUTPUT_TERM_SCORE;
  return score;
}

function hasInput(entry: ICatalogEntry, kind: 'image' | 'text' | 'video'): boolean {
  return entry.inputs.some((input) => matchesKind(input, kind));
}

function matchesKind(port: IPortDescriptor, kind: 'image' | 'text' | 'video'): boolean {
  if (kind === 'image') return port.isImage;
  if (kind === 'video') return port.isVideo;
  return port.isText;
}

function pickPreferredPort(
  ports: IPortDescriptor[],
  preferredKeys: string[],
): IPortDescriptor | undefined {
  for (const preferredKey of preferredKeys) {
    const normalized = normalizeText(preferredKey);
    const match = ports.find((port) => port.normalizedKey === normalized);
    if (match) {
      return match;
    }
  }
  return ports[0];
}

function normalizePortKey(value: string): string {
  return toNodeIdBase(value) || 'output';
}

function normalizeText(value: string): string {
  return toNodeIdBase(value);
}
