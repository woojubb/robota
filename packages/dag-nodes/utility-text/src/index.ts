import { replaceLiteralWithinByteLimit } from './text-replace.js';
import { repeatWithinByteLimit } from './text-repeat.js';
import { joinLinesWithinByteLimit, splitTextWithinByteLimit } from './text-join-split.js';
import { changeCaseWithinByteLimit } from './text-case.js';
import { AbstractNodeDefinition, NodeIoAccessor } from '@robota-sdk/dag-node';
import {
  buildTaskExecutionError,
  buildValidationError,
  resolveDagExecutionByteLimits,
  type ICostEstimate,
  type IDagError,
  type IDagNodeDefinition,
  type INodeExecutionContext,
  type TPortPayload,
  type TResult,
} from '@robota-sdk/dag-core';
import { z } from 'zod';

const FREE_COST: TResult<ICostEstimate, IDagError> = { ok: true, value: { estimatedCredits: 0 } };

const NoConfigSchema = z.object({} as Record<string, z.ZodTypeAny>);
type TNoConfig = z.output<typeof NoConfigSchema>;

// ─── string-to-number ────────────────────────────────────────────────────────

export class StringToNumberNodeDefinition extends AbstractNodeDefinition<typeof NoConfigSchema> {
  public readonly nodeType = 'string-to-number';
  public readonly displayName = 'String → Number';
  public readonly category = 'Utility';
  public override readonly defaultInputPort = 'text';
  public override readonly defaultOutputPort = 'number';
  public readonly inputs: IDagNodeDefinition['inputs'] = [
    { key: 'text', label: 'Text', order: 0, type: 'string', required: true },
  ];
  public readonly outputs: IDagNodeDefinition['outputs'] = [
    { key: 'number', label: 'Number', order: 0, type: 'string', required: true },
  ];
  public readonly configSchemaDefinition = NoConfigSchema;

  public override async estimateCostWithConfig(): Promise<TResult<ICostEstimate, IDagError>> {
    return FREE_COST;
  }

  protected override async executeWithConfig(
    input: TPortPayload,
    context: INodeExecutionContext,
    _config: TNoConfig,
  ): Promise<TResult<TPortPayload, IDagError>> {
    const io = new NodeIoAccessor(input, context.nodeDefinition.nodeId);
    const r = io.requireInputString('text');
    if (!r.ok) return r;
    const n = Number(r.value);
    if (isNaN(n)) {
      return {
        ok: false,
        error: buildValidationError(
          'DAG_VALIDATION_STRING_TO_NUMBER_INVALID',
          `Cannot convert "${r.value}" to a number`,
          { nodeId: context.nodeDefinition.nodeId },
        ),
      };
    }
    io.setOutput('number', String(n));
    return { ok: true, value: io.toOutput() };
  }
}

// ─── number-to-string ────────────────────────────────────────────────────────

export class NumberToStringNodeDefinition extends AbstractNodeDefinition<typeof NoConfigSchema> {
  public readonly nodeType = 'number-to-string';
  public readonly displayName = 'Number → String';
  public readonly category = 'Utility';
  public override readonly defaultInputPort = 'number';
  public override readonly defaultOutputPort = 'text';
  public readonly inputs: IDagNodeDefinition['inputs'] = [
    { key: 'number', label: 'Number', order: 0, type: 'string', required: true },
  ];
  public readonly outputs: IDagNodeDefinition['outputs'] = [
    { key: 'text', label: 'Text', order: 0, type: 'string', required: true },
  ];
  public readonly configSchemaDefinition = NoConfigSchema;

  public override async estimateCostWithConfig(): Promise<TResult<ICostEstimate, IDagError>> {
    return FREE_COST;
  }

  protected override async executeWithConfig(
    input: TPortPayload,
    context: INodeExecutionContext,
    _config: TNoConfig,
  ): Promise<TResult<TPortPayload, IDagError>> {
    const io = new NodeIoAccessor(input, context.nodeDefinition.nodeId);
    const r = io.requireInputString('number');
    if (!r.ok) return r;
    io.setOutput('text', r.value);
    return { ok: true, value: io.toOutput() };
  }
}

// ─── text-join ───────────────────────────────────────────────────────────────

const TextJoinConfigSchema = z.object({
  separator: z.string().default(', '),
});

export class TextJoinNodeDefinition extends AbstractNodeDefinition<typeof TextJoinConfigSchema> {
  public readonly nodeType = 'text-join';
  public readonly displayName = 'Text Join';
  public readonly category = 'Utility';
  public override readonly defaultInputPort = 'items';
  public override readonly defaultOutputPort = 'text';
  public readonly inputs: IDagNodeDefinition['inputs'] = [
    { key: 'items', label: 'Items (newline-separated)', order: 0, type: 'string', required: true },
  ];
  public readonly outputs: IDagNodeDefinition['outputs'] = [
    { key: 'text', label: 'Text', order: 0, type: 'string', required: true },
  ];
  public readonly configSchemaDefinition = TextJoinConfigSchema;

  public override async estimateCostWithConfig(): Promise<TResult<ICostEstimate, IDagError>> {
    return FREE_COST;
  }

  protected override async executeWithConfig(
    input: TPortPayload,
    context: INodeExecutionContext,
    config: z.output<typeof TextJoinConfigSchema>,
  ): Promise<TResult<TPortPayload, IDagError>> {
    const io = new NodeIoAccessor(input, context.nodeDefinition.nodeId);
    const r = io.requireInputString('items');
    if (!r.ok) return r;
    const joined = joinLinesWithinByteLimit(
      r.value, config.separator, resolveDagExecutionByteLimits(context.byteLimits).maxTextJoinOutputBytes,
    );
    if (!joined.ok) return joined;
    io.setOutput('text', joined.value);
    return { ok: true, value: io.toOutput() };
  }
}

// ─── text-split ──────────────────────────────────────────────────────────────

const TextSplitConfigSchema = z.object({
  separator: z.string().default('\n'),
  trim: z.boolean().default(true),
});

export class TextSplitNodeDefinition extends AbstractNodeDefinition<typeof TextSplitConfigSchema> {
  public readonly nodeType = 'text-split';
  public readonly displayName = 'Text Split';
  public readonly category = 'Utility';
  public override readonly defaultInputPort = 'text';
  public override readonly defaultOutputPort = 'items';
  public readonly inputs: IDagNodeDefinition['inputs'] = [
    { key: 'text', label: 'Text', order: 0, type: 'string', required: true },
  ];
  public readonly outputs: IDagNodeDefinition['outputs'] = [
    { key: 'items', label: 'Items (newline-separated)', order: 0, type: 'string', required: true },
  ];
  public readonly configSchemaDefinition = TextSplitConfigSchema;

  public override async estimateCostWithConfig(): Promise<TResult<ICostEstimate, IDagError>> {
    return FREE_COST;
  }

  protected override async executeWithConfig(
    input: TPortPayload,
    context: INodeExecutionContext,
    config: z.output<typeof TextSplitConfigSchema>,
  ): Promise<TResult<TPortPayload, IDagError>> {
    const io = new NodeIoAccessor(input, context.nodeDefinition.nodeId);
    const r = io.requireInputString('text');
    if (!r.ok) return r;
    const split = splitTextWithinByteLimit(
      r.value, config.separator, config.trim,
      resolveDagExecutionByteLimits(context.byteLimits).maxTextSplitOutputBytes,
    );
    if (!split.ok) return split;
    io.setOutput('items', split.value);
    return { ok: true, value: io.toOutput() };
  }
}

// ─── text-replace ─────────────────────────────────────────────────────────────

const TextReplaceConfigSchema = z.object({
  search: z.string().default(''),
  replacement: z.string().default(''),
  useRegex: z.boolean().default(false),
  flags: z.string().default('g'),
});

export class TextReplaceNodeDefinition extends AbstractNodeDefinition<
  typeof TextReplaceConfigSchema
> {
  public readonly nodeType = 'text-replace';
  public readonly displayName = 'Text Replace';
  public readonly category = 'Utility';
  public override readonly defaultInputPort = 'text';
  public override readonly defaultOutputPort = 'text';
  public readonly inputs: IDagNodeDefinition['inputs'] = [
    { key: 'text', label: 'Text', order: 0, type: 'string', required: true },
  ];
  public readonly outputs: IDagNodeDefinition['outputs'] = [
    { key: 'text', label: 'Text', order: 0, type: 'string', required: true },
  ];
  public readonly configSchemaDefinition = TextReplaceConfigSchema;

  public override async estimateCostWithConfig(): Promise<TResult<ICostEstimate, IDagError>> {
    return FREE_COST;
  }

  protected override async executeWithConfig(
    input: TPortPayload,
    context: INodeExecutionContext,
    config: z.output<typeof TextReplaceConfigSchema>,
  ): Promise<TResult<TPortPayload, IDagError>> {
    const io = new NodeIoAccessor(input, context.nodeDefinition.nodeId);
    const r = io.requireInputString('text');
    if (!r.ok) return r;
    let result: string;
    if (config.useRegex) {
      // Regex execution never runs inline on this thread: a pathological pattern (catastrophic
      // backtracking) can freeze the host process, including its cancel/timeout machinery. A host
      // that wants `useRegex` support must supply `regexReplaceOperation` (an isolated executor);
      // without it, this fails closed rather than falling back to `new RegExp(...).replace(...)`.
      if (!context.regexReplaceOperation) {
        return {
          ok: false,
          error: buildTaskExecutionError(
            'DAG_TASK_ISOLATION_UNAVAILABLE',
            'Regex-based text-replace requires an isolated regex executor; none was supplied for this run',
            false,
            { nodeId: context.nodeDefinition.nodeId },
          ),
        };
      }
      const replaced = await context.regexReplaceOperation.execute({
        text: r.value, search: config.search, replacement: config.replacement, flags: config.flags,
      }, context.signal);
      if (!replaced.ok) return replaced;
      result = replaced.value;
    } else {
      const replaced = replaceLiteralWithinByteLimit(
        r.value, config.search, config.replacement,
        resolveDagExecutionByteLimits(context.byteLimits).maxTextReplaceOutputBytes,
      );
      if (!replaced.ok) return replaced;
      result = replaced.value;
    }
    io.setOutput('text', result);
    return { ok: true, value: io.toOutput() };
  }
}

// ─── text-length ──────────────────────────────────────────────────────────────

export class TextLengthNodeDefinition extends AbstractNodeDefinition<typeof NoConfigSchema> {
  public readonly nodeType = 'text-length';
  public readonly displayName = 'Text Length';
  public readonly category = 'Utility';
  public override readonly defaultInputPort = 'text';
  public override readonly defaultOutputPort = 'text';
  public readonly inputs: IDagNodeDefinition['inputs'] = [
    { key: 'text', label: 'Text', order: 0, type: 'string', required: true },
  ];
  public readonly outputs: IDagNodeDefinition['outputs'] = [
    { key: 'text', label: 'Length', order: 0, type: 'string', required: true },
  ];
  public readonly configSchemaDefinition = NoConfigSchema;

  public override async estimateCostWithConfig(): Promise<TResult<ICostEstimate, IDagError>> {
    return FREE_COST;
  }

  protected override async executeWithConfig(
    input: TPortPayload,
    context: INodeExecutionContext,
  ): Promise<TResult<TPortPayload, IDagError>> {
    const io = new NodeIoAccessor(input, context.nodeDefinition.nodeId);
    const r = io.requireInputString('text');
    if (!r.ok) return r;
    io.setOutput('text', String(r.value.length));
    return { ok: true, value: io.toOutput() };
  }
}

// ─── text-upper ───────────────────────────────────────────────────────────────

export class TextUpperNodeDefinition extends AbstractNodeDefinition<typeof NoConfigSchema> {
  public readonly nodeType = 'text-upper';
  public readonly displayName = 'Text Uppercase';
  public readonly category = 'Utility';
  public override readonly defaultInputPort = 'text';
  public override readonly defaultOutputPort = 'text';
  public readonly inputs: IDagNodeDefinition['inputs'] = [
    { key: 'text', label: 'Text', order: 0, type: 'string', required: true },
  ];
  public readonly outputs: IDagNodeDefinition['outputs'] = [
    { key: 'text', label: 'Text', order: 0, type: 'string', required: true },
  ];
  public readonly configSchemaDefinition = NoConfigSchema;

  public override async estimateCostWithConfig(): Promise<TResult<ICostEstimate, IDagError>> {
    return FREE_COST;
  }

  protected override async executeWithConfig(
    input: TPortPayload,
    context: INodeExecutionContext,
  ): Promise<TResult<TPortPayload, IDagError>> {
    const io = new NodeIoAccessor(input, context.nodeDefinition.nodeId);
    const r = io.requireInputString('text');
    if (!r.ok) return r;
    const upper = changeCaseWithinByteLimit(
      r.value, resolveDagExecutionByteLimits(context.byteLimits).maxTextUpperOutputBytes, 'text-upper',
    );
    if (!upper.ok) return upper;
    io.setOutput('text', upper.value);
    return { ok: true, value: io.toOutput() };
  }
}

// ─── text-lower ───────────────────────────────────────────────────────────────

export class TextLowerNodeDefinition extends AbstractNodeDefinition<typeof NoConfigSchema> {
  public readonly nodeType = 'text-lower';
  public readonly displayName = 'Text Lowercase';
  public readonly category = 'Utility';
  public override readonly defaultInputPort = 'text';
  public override readonly defaultOutputPort = 'text';
  public readonly inputs: IDagNodeDefinition['inputs'] = [
    { key: 'text', label: 'Text', order: 0, type: 'string', required: true },
  ];
  public readonly outputs: IDagNodeDefinition['outputs'] = [
    { key: 'text', label: 'Text', order: 0, type: 'string', required: true },
  ];
  public readonly configSchemaDefinition = NoConfigSchema;

  public override async estimateCostWithConfig(): Promise<TResult<ICostEstimate, IDagError>> {
    return FREE_COST;
  }

  protected override async executeWithConfig(
    input: TPortPayload,
    context: INodeExecutionContext,
  ): Promise<TResult<TPortPayload, IDagError>> {
    const io = new NodeIoAccessor(input, context.nodeDefinition.nodeId);
    const r = io.requireInputString('text');
    if (!r.ok) return r;
    const lower = changeCaseWithinByteLimit(
      r.value, resolveDagExecutionByteLimits(context.byteLimits).maxTextLowerOutputBytes, 'text-lower',
    );
    if (!lower.ok) return lower;
    io.setOutput('text', lower.value);
    return { ok: true, value: io.toOutput() };
  }
}

// ─── text-trim ────────────────────────────────────────────────────────────────

const TextTrimConfigSchema = z.object({
  mode: z.enum(['both', 'start', 'end']).default('both'),
});

export class TextTrimNodeDefinition extends AbstractNodeDefinition<typeof TextTrimConfigSchema> {
  public readonly nodeType = 'text-trim';
  public readonly displayName = 'Text Trim';
  public readonly category = 'Utility';
  public override readonly defaultInputPort = 'text';
  public override readonly defaultOutputPort = 'text';
  public readonly inputs: IDagNodeDefinition['inputs'] = [
    { key: 'text', label: 'Text', order: 0, type: 'string', required: true },
  ];
  public readonly outputs: IDagNodeDefinition['outputs'] = [
    { key: 'text', label: 'Text', order: 0, type: 'string', required: true },
  ];
  public readonly configSchemaDefinition = TextTrimConfigSchema;

  public override async estimateCostWithConfig(): Promise<TResult<ICostEstimate, IDagError>> {
    return FREE_COST;
  }

  protected override async executeWithConfig(
    input: TPortPayload,
    context: INodeExecutionContext,
    config: z.output<typeof TextTrimConfigSchema>,
  ): Promise<TResult<TPortPayload, IDagError>> {
    const io = new NodeIoAccessor(input, context.nodeDefinition.nodeId);
    const r = io.requireInputString('text');
    if (!r.ok) return r;
    const trimmed =
      config.mode === 'start'
        ? r.value.trimStart()
        : config.mode === 'end'
          ? r.value.trimEnd()
          : r.value.trim();
    io.setOutput('text', trimmed);
    return { ok: true, value: io.toOutput() };
  }
}

// ─── json-extract ─────────────────────────────────────────────────────────────

const JsonExtractConfigSchema = z.object({
  path: z.string().default(''),
  fallback: z.string().default(''),
});

export class JsonExtractNodeDefinition extends AbstractNodeDefinition<
  typeof JsonExtractConfigSchema
> {
  public readonly nodeType = 'json-extract';
  public readonly displayName = 'JSON Extract';
  public readonly category = 'Utility';
  public override readonly defaultInputPort = 'json';
  public override readonly defaultOutputPort = 'text';
  public readonly inputs: IDagNodeDefinition['inputs'] = [
    { key: 'json', label: 'JSON', order: 0, type: 'string', required: true },
  ];
  public readonly outputs: IDagNodeDefinition['outputs'] = [
    { key: 'text', label: 'Value', order: 0, type: 'string', required: true },
  ];
  public readonly configSchemaDefinition = JsonExtractConfigSchema;

  public override async estimateCostWithConfig(): Promise<TResult<ICostEstimate, IDagError>> {
    return FREE_COST;
  }

  protected override async executeWithConfig(
    input: TPortPayload,
    context: INodeExecutionContext,
    config: z.output<typeof JsonExtractConfigSchema>,
  ): Promise<TResult<TPortPayload, IDagError>> {
    const io = new NodeIoAccessor(input, context.nodeDefinition.nodeId);
    const r = io.requireInputString('json');
    if (!r.ok) return r;
    let parsed: unknown;
    try {
      parsed = JSON.parse(r.value);
    } catch (_err) {
      // allow-fallback: invalid JSON is a user input error, return validation failure
      return {
        ok: false,
        error: buildValidationError(
          'DAG_VALIDATION_JSON_EXTRACT_INVALID_JSON',
          'Input is not valid JSON',
          { nodeId: context.nodeDefinition.nodeId },
        ),
      };
    }
    const keys = config.path ? config.path.split('.') : [];
    let current: unknown = parsed;
    for (const key of keys) {
      if (current === null || typeof current !== 'object') {
        current = undefined;
        break;
      }
      current = (current as Record<string, unknown>)[key];
    }
    const value = current === undefined ? config.fallback : String(current);
    io.setOutput('text', value);
    return { ok: true, value: io.toOutput() };
  }
}

// ─── conditional-text ─────────────────────────────────────────────────────────

const ConditionalTextConfigSchema = z.object({
  operator: z
    .enum(['non-empty', 'equals', 'contains', 'starts-with', 'ends-with'])
    .default('non-empty'),
  operand: z.string().default(''),
});

export class ConditionalTextNodeDefinition extends AbstractNodeDefinition<
  typeof ConditionalTextConfigSchema
> {
  public readonly nodeType = 'conditional-text';
  public readonly displayName = 'Conditional Text';
  public readonly category = 'Utility';
  public override readonly defaultInputPort = 'condition';
  public override readonly defaultOutputPort = 'text';
  public readonly inputs: IDagNodeDefinition['inputs'] = [
    { key: 'condition', label: 'Condition', order: 0, type: 'string', required: true },
    { key: 'text_true', label: 'If True', order: 1, type: 'string', required: true },
    { key: 'text_false', label: 'If False', order: 2, type: 'string', required: false },
  ];
  public readonly outputs: IDagNodeDefinition['outputs'] = [
    { key: 'text', label: 'Result', order: 0, type: 'string', required: true },
  ];
  public readonly configSchemaDefinition = ConditionalTextConfigSchema;

  public override async estimateCostWithConfig(): Promise<TResult<ICostEstimate, IDagError>> {
    return FREE_COST;
  }

  protected override async executeWithConfig(
    input: TPortPayload,
    context: INodeExecutionContext,
    config: z.output<typeof ConditionalTextConfigSchema>,
  ): Promise<TResult<TPortPayload, IDagError>> {
    const io = new NodeIoAccessor(input, context.nodeDefinition.nodeId);
    const conditionResult = io.requireInputString('condition');
    if (!conditionResult.ok) return conditionResult;
    const trueResult = io.requireInputString('text_true');
    if (!trueResult.ok) return trueResult;
    const falseText = io.getInput('text_false');

    const cond = conditionResult.value;
    const operand = config.operand;
    let isTrue: boolean;
    switch (config.operator) {
      case 'non-empty':
        isTrue = cond.trim().length > 0;
        break;
      case 'equals':
        isTrue = cond === operand;
        break;
      case 'contains':
        isTrue = cond.includes(operand);
        break;
      case 'starts-with':
        isTrue = cond.startsWith(operand);
        break;
      case 'ends-with':
        isTrue = cond.endsWith(operand);
        break;
    }

    const output = isTrue ? trueResult.value : typeof falseText === 'string' ? falseText : '';
    io.setOutput('text', output);
    return { ok: true, value: io.toOutput() };
  }
}

// ─── text-count-lines ─────────────────────────────────────────────────────────

const TextCountLinesConfigSchema = z.object({
  skipEmpty: z.boolean().default(false),
});

const NON_TRIM_WHITESPACE = /\S/;

function countLines(text: string, skipEmpty: boolean): number {
  if (!skipEmpty) {
    let count = 1;
    for (let index = 0; index < text.length; index++) {
      if (text[index] === '\n') count++;
    }
    return count;
  }

  let count = 0;
  let lineHasContent = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index]!;
    if (character === '\n') {
      if (lineHasContent) count++;
      lineHasContent = false;
    } else if (!lineHasContent && NON_TRIM_WHITESPACE.test(character)) {
      lineHasContent = true;
    }
  }
  if (lineHasContent) count++;
  return count;
}

export class TextCountLinesNodeDefinition extends AbstractNodeDefinition<
  typeof TextCountLinesConfigSchema
> {
  public readonly nodeType = 'text-count-lines';
  public readonly displayName = 'Text Count Lines';
  public readonly category = 'Utility';
  public override readonly defaultInputPort = 'text';
  public override readonly defaultOutputPort = 'text';
  public readonly inputs: IDagNodeDefinition['inputs'] = [
    { key: 'text', label: 'Text', order: 0, type: 'string', required: true },
  ];
  public readonly outputs: IDagNodeDefinition['outputs'] = [
    { key: 'text', label: 'Line Count', order: 0, type: 'string', required: true },
  ];
  public readonly configSchemaDefinition = TextCountLinesConfigSchema;

  public override async estimateCostWithConfig(): Promise<TResult<ICostEstimate, IDagError>> {
    return FREE_COST;
  }

  protected override async executeWithConfig(
    input: TPortPayload,
    context: INodeExecutionContext,
    config: z.output<typeof TextCountLinesConfigSchema>,
  ): Promise<TResult<TPortPayload, IDagError>> {
    const io = new NodeIoAccessor(input, context.nodeDefinition.nodeId);
    const r = io.requireInputString('text');
    if (!r.ok) return r;
    io.setOutput('text', String(countLines(r.value, config.skipEmpty)));
    return { ok: true, value: io.toOutput() };
  }
}

// ─── text-repeat ──────────────────────────────────────────────────────────────

const TextRepeatConfigSchema = z.object({
  times: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(2),
  separator: z.string().default(''),
});

export class TextRepeatNodeDefinition extends AbstractNodeDefinition<
  typeof TextRepeatConfigSchema
> {
  public readonly nodeType = 'text-repeat';
  public readonly displayName = 'Text Repeat';
  public readonly category = 'Utility';
  public override readonly defaultInputPort = 'text';
  public override readonly defaultOutputPort = 'text';
  public readonly inputs: IDagNodeDefinition['inputs'] = [
    { key: 'text', label: 'Text', order: 0, type: 'string', required: true },
  ];
  public readonly outputs: IDagNodeDefinition['outputs'] = [
    { key: 'text', label: 'Repeated Text', order: 0, type: 'string', required: true },
  ];
  public readonly configSchemaDefinition = TextRepeatConfigSchema;

  public override async estimateCostWithConfig(): Promise<TResult<ICostEstimate, IDagError>> {
    return FREE_COST;
  }

  protected override async executeWithConfig(
    input: TPortPayload,
    context: INodeExecutionContext,
    config: z.output<typeof TextRepeatConfigSchema>,
  ): Promise<TResult<TPortPayload, IDagError>> {
    const io = new NodeIoAccessor(input, context.nodeDefinition.nodeId);
    const r = io.requireInputString('text');
    if (!r.ok) return r;
    const limits = resolveDagExecutionByteLimits(context.byteLimits);
    const repeated = repeatWithinByteLimit(
      r.value, config.separator, config.times, limits.maxTextRepeatOutputBytes,
    );
    if (!repeated.ok) return repeated;
    io.setOutput('text', repeated.value);
    return { ok: true, value: io.toOutput() };
  }
}

// ─── text-slice ───────────────────────────────────────────────────────────────

const TextSliceConfigSchema = z.object({
  start: z.number().int().default(0),
  end: z.number().int().optional(),
});

export class TextSliceNodeDefinition extends AbstractNodeDefinition<typeof TextSliceConfigSchema> {
  public readonly nodeType = 'text-slice';
  public readonly displayName = 'Text Slice';
  public readonly category = 'Utility';
  public override readonly defaultInputPort = 'text';
  public override readonly defaultOutputPort = 'text';
  public readonly inputs: IDagNodeDefinition['inputs'] = [
    { key: 'text', label: 'Text', order: 0, type: 'string', required: true },
  ];
  public readonly outputs: IDagNodeDefinition['outputs'] = [
    { key: 'text', label: 'Sliced Text', order: 0, type: 'string', required: true },
  ];
  public readonly configSchemaDefinition = TextSliceConfigSchema;

  public override async estimateCostWithConfig(): Promise<TResult<ICostEstimate, IDagError>> {
    return FREE_COST;
  }

  protected override async executeWithConfig(
    input: TPortPayload,
    context: INodeExecutionContext,
    config: z.output<typeof TextSliceConfigSchema>,
  ): Promise<TResult<TPortPayload, IDagError>> {
    const io = new NodeIoAccessor(input, context.nodeDefinition.nodeId);
    const r = io.requireInputString('text');
    if (!r.ok) return r;
    io.setOutput('text', r.value.slice(config.start, config.end));
    return { ok: true, value: io.toOutput() };
  }
}
