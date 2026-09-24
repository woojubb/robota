import { buildTaskExecutionError, type IDagError, type TResult } from '@robota-sdk/dag-core';

/** Walk the template once, treating substituted input as opaque text. */
function visitTemplate(
  template: string, text: string, visit: (part: string) => boolean,
): boolean {
  let literalStart = 0;
  for (let index = 0; index < template.length;) {
    let part: string;
    let width: number;
    if (template.startsWith('%%s', index)) {
      part = '%s';
      width = 3;
    } else if (template.startsWith('{{text}}', index)) {
      part = text;
      width = 8;
    } else if (template.startsWith('%s', index)) {
      part = text;
      width = 2;
    } else {
      index++;
      continue;
    }
    if (index > literalStart && !visit(template.slice(literalStart, index))) return false;
    if (!visit(part)) return false;
    index += width;
    literalStart = index;
  }
  return literalStart === template.length || visit(template.slice(literalStart));
}

/** Count UTF-8 bytes across piece boundaries before constructing expanded output. */
export function renderTemplateWithinByteLimit(
  template: string, text: string, maxBytes: number,
): TResult<string, IDagError> {
  let bytes = 0;
  let previousHigh = false;
  const fits = visitTemplate(template, text, (part) => {
    for (let index = 0; index < part.length; index++) {
      const code = part.charCodeAt(index);
      const low = code >= 0xdc00 && code <= 0xdfff;
      bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : low && previousHigh ? 1 : 3;
      previousHigh = code >= 0xd800 && code <= 0xdbff;
      if (bytes > maxBytes) return false;
    }
    return true;
  });
  if (!fits) return { ok: false, error: buildTaskExecutionError(
    'DAG_TASK_EXECUTION_BYTE_LIMIT_EXCEEDED',
    'text-template output exceeds its UTF-8 byte limit', false,
    { maxBytes, nodeType: 'text-template' },
  ) };
  let output = '';
  visitTemplate(template, text, (part) => { output += part; return true; });
  return { ok: true, value: output };
}
