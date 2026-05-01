import type {
  IGemmaConsumedPseudoBlock,
  IGemmaConsumedPseudoToolTag,
  IGemmaParsedPseudoTag,
  IGemmaPseudoProjectionOptions,
  TGemmaJsonValue,
} from './pseudo-tool-call-types';

const XML_START_MARKER = '<';

export function createGemmaPseudoStartMarkers(toolNames: readonly string[]): string[] {
  void toolNames;
  return [XML_START_MARKER];
}

export function findNextGemmaPseudoStartMarker(
  text: string,
  cursor: number,
  markers: readonly string[],
): number {
  void markers;
  return text.indexOf(XML_START_MARKER, cursor);
}

export function longestGemmaPseudoStartPrefixSuffixLength(
  text: string,
  markers: readonly string[],
): number {
  void markers;
  return text.endsWith(XML_START_MARKER) ? XML_START_MARKER.length : 0;
}

export function parseGemmaPseudoTag(
  text: string,
  start: number,
): IGemmaParsedPseudoTag | undefined {
  const tagEnd = text.indexOf('>', start + 1);
  if (tagEnd === -1) {
    return undefined;
  }

  const rawOpenTag = text.slice(start, tagEnd + 1);
  const tagMatch = rawOpenTag.match(/^<\s*([A-Za-z][\w:-]*)([\s/>][\s\S]*?|)>$/);
  if (!tagMatch) {
    return undefined;
  }

  const tagName = tagMatch[1] ?? '';
  return {
    tagName,
    normalizedName: tagName.toLowerCase(),
    rawOpenTag,
    attributes: parseAttributes(tagMatch[2] ?? ''),
    openEnd: tagEnd + 1,
    selfClosing: /\/\s*>$/.test(rawOpenTag),
  };
}

export function consumeGemmaPseudoControlBlock(
  text: string,
  tag: IGemmaParsedPseudoTag,
  options: IGemmaPseudoProjectionOptions,
): IGemmaConsumedPseudoBlock {
  if (tag.selfClosing) {
    return {
      innerText: '',
      end: tag.openEnd,
      complete: true,
    };
  }

  const closeStart = indexOfClosingTag(text, tag.tagName, tag.openEnd);
  if (closeStart === -1) {
    return {
      innerText: text.slice(tag.openEnd),
      end: options.final ? text.length : tag.openEnd - tag.rawOpenTag.length,
      complete: false,
    };
  }

  const closingTagEnd = text.indexOf('>', closeStart);
  return {
    innerText: text.slice(tag.openEnd, closeStart),
    end: closingTagEnd === -1 ? text.length : closingTagEnd + 1,
    complete: true,
  };
}

export function consumeGemmaPseudoToolTag(
  text: string,
  tag: IGemmaParsedPseudoTag,
): IGemmaConsumedPseudoToolTag {
  if (tag.selfClosing) {
    return { rawText: tag.rawOpenTag, end: tag.openEnd };
  }

  const closeStart = indexOfClosingTag(text, tag.tagName, tag.openEnd);
  if (closeStart === -1) {
    return { rawText: tag.rawOpenTag, end: tag.openEnd };
  }

  const closingTagEnd = text.indexOf('>', closeStart);
  const end = closingTagEnd === -1 ? text.length : closingTagEnd + 1;
  return { rawText: text.slice(tag.openEnd - tag.rawOpenTag.length, end), end };
}

export function findGemmaDeclaredToolName(
  tagName: string,
  toolNames: readonly string[],
): string | undefined {
  const normalizedTagName = normalizeToolName(tagName);
  return toolNames.find((toolName) => normalizeToolName(toolName) === normalizedTagName);
}

function parseAttributes(attributeText: string): Record<string, TGemmaJsonValue> {
  const attributes: Record<string, TGemmaJsonValue> = {};
  const pattern = /([A-Za-z_][\w:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match = pattern.exec(attributeText);
  while (match) {
    const key = match[1] ?? '';
    const rawValue = match[2] ?? match[3] ?? '';
    attributes[key] = parseAttributeValue(decodeXmlEntities(rawValue));
    match = pattern.exec(attributeText);
  }
  return attributes;
}

function parseAttributeValue(value: string): TGemmaJsonValue {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
    return Number(value);
  }
  return value;
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function indexOfClosingTag(text: string, tagName: string, cursor: number): number {
  return text.toLowerCase().indexOf(`</${tagName.toLowerCase()}>`, cursor);
}

function normalizeToolName(value: string): string {
  return value.replace(/[^a-z0-9]/gi, '').toLowerCase();
}
