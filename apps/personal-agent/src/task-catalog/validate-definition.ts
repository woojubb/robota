/**
 * What a task definition may hold. A definition is reviewed text with a fixed shape: bounded lines, no
 * unknown field, no credential-shaped value, and capabilities named as operations. Nothing here can
 * carry text copied from a tool response as an instruction, because no field takes free-form content
 * beyond the bounded lines that are shown to the person as they are.
 */
import {
  TaskCatalogRefusedError,
  asRecord,
  listOf,
  oneOf,
  plainLine,
  positiveInteger,
  rejectUnknownKeys,
  shaped,
} from './fields.js';
import { EFFECT_CEILINGS, EVIDENCE_KINDS, INPUT_KINDS } from './types.js';

import type { ITaskDefinition, ITaskInput } from './types.js';

export const DEFINITION_LIMITS = {
  title: 80,
  category: 40,
  expectedResult: 400,
  label: 80,
  choice: 60,
  text: 200,
  evidence: 200,
  inputs: 8,
  choices: 12,
  capabilities: 8,
} as const;

const SLUG = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const INPUT_NAME = /^[a-z][A-Za-z0-9]{0,39}$/u;
/** `family.operation`: a name for what is done, which is not the name of any one service's tool. */
const CAPABILITY = /^[a-z][a-z0-9]{0,19}\.[a-z][a-z0-9-]{0,19}$/u;

const DEFINITION_KEYS = [
  'id',
  'revision',
  'title',
  'category',
  'expectedResult',
  'inputs',
  'capabilities',
  'effectCeiling',
  'completionEvidence',
  'execution',
];
const INPUT_KEYS = ['name', 'label', 'kind', 'required', 'default', 'choices'];

function parseInput(raw: unknown, index: number): ITaskInput {
  const where = `inputs[${index}]`;
  const input = asRecord(raw, where);
  rejectUnknownKeys(input, INPUT_KEYS, where);
  const kind = oneOf(input['kind'], `${where}.kind`, INPUT_KINDS);
  if (typeof input['required'] !== 'boolean')
    throw new TaskCatalogRefusedError(`${where}.required must be true or false`);
  let choices: string[] | undefined;
  if (kind === 'choice') {
    choices = listOf(input['choices'], `${where}.choices`, 2, DEFINITION_LIMITS.choices).map(
      (choice, at) => plainLine(choice, `${where}.choices[${at}]`, DEFINITION_LIMITS.choice),
    );
    if (new Set(choices).size !== choices.length)
      throw new TaskCatalogRefusedError(`${where}.choices must not repeat`);
  } else if (input['choices'] !== undefined) {
    throw new TaskCatalogRefusedError(`${where}.choices is only for a choice`);
  }
  let fallback: string | number | undefined;
  if (input['default'] !== undefined) {
    if (kind === 'number') {
      const value = input['default'];
      if (typeof value !== 'number' || !Number.isFinite(value))
        throw new TaskCatalogRefusedError(`${where}.default must be a number`);
      fallback = value;
    } else {
      fallback = plainLine(input['default'], `${where}.default`, DEFINITION_LIMITS.text);
      if (kind === 'choice' && !choices!.includes(fallback))
        throw new TaskCatalogRefusedError(`${where}.default must be one of the choices`);
    }
  }
  return {
    name: shaped(input['name'], `${where}.name`, INPUT_NAME, 40),
    label: plainLine(input['label'], `${where}.label`, DEFINITION_LIMITS.label),
    kind,
    required: input['required'],
    ...(fallback !== undefined && { default: fallback }),
    ...(choices !== undefined && { choices }),
  };
}

/** The definition as a fresh value, or the refusal that says which field is wrong. */
export function parseDefinition(raw: unknown): ITaskDefinition {
  const definition = asRecord(raw, 'A task definition');
  rejectUnknownKeys(definition, DEFINITION_KEYS, 'A task definition');
  const inputs = listOf(definition['inputs'], 'inputs', 0, DEFINITION_LIMITS.inputs).map(
    parseInput,
  );
  if (new Set(inputs.map((input) => input.name)).size !== inputs.length)
    throw new TaskCatalogRefusedError('inputs must not repeat a name');
  const capabilities = listOf(
    definition['capabilities'],
    'capabilities',
    1,
    DEFINITION_LIMITS.capabilities,
  ).map((capability, at) => shaped(capability, `capabilities[${at}]`, CAPABILITY, 40));
  if (new Set(capabilities).size !== capabilities.length)
    throw new TaskCatalogRefusedError('capabilities must not repeat');
  const evidence = asRecord(definition['completionEvidence'], 'completionEvidence');
  rejectUnknownKeys(evidence, ['kind', 'description'], 'completionEvidence');
  if (definition['execution'] !== 'one-shot')
    throw new TaskCatalogRefusedError('execution must be one-shot');
  return {
    id: shaped(definition['id'], 'id', SLUG, 60),
    revision: positiveInteger(definition['revision'], 'revision'),
    title: plainLine(definition['title'], 'title', DEFINITION_LIMITS.title),
    category: plainLine(definition['category'], 'category', DEFINITION_LIMITS.category),
    expectedResult: plainLine(
      definition['expectedResult'],
      'expectedResult',
      DEFINITION_LIMITS.expectedResult,
    ),
    inputs,
    capabilities,
    effectCeiling: oneOf(definition['effectCeiling'], 'effectCeiling', EFFECT_CEILINGS),
    completionEvidence: {
      kind: oneOf(evidence['kind'], 'completionEvidence.kind', EVIDENCE_KINDS),
      description: plainLine(
        evidence['description'],
        'completionEvidence.description',
        DEFINITION_LIMITS.evidence,
      ),
    },
    execution: 'one-shot',
  };
}
