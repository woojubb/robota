/**
 * What an offer may hold. An offer's reason can come from a mail, a page or a connector, so every
 * field is a bounded value of a fixed shape, and the reason is only ever a line of plain text for the
 * person to read: nothing here, or in the stores that keep it, turns it into anything a definition does.
 */
import {
  TaskCatalogRefusedError,
  asRecord,
  isoTime,
  listOf,
  oneOf,
  plainLine,
  positiveInteger,
  rejectUnknownKeys,
  shaped,
} from './fields.js';
import { OFFER_DECISIONS, OFFER_SOURCES } from './types.js';

import type { IOffer, IOfferContextRef, ITaskDefinition } from './types.js';

export const OFFER_LIMITS = {
  reason: 300,
  contextRefs: 5,
  prefilledEntries: 8,
  prefilledValue: 200,
  dedupeKey: 120,
} as const;

const OFFER_ID = /^offer-[a-z0-9]{1,40}$/u;
const DEFINITION_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const REF_KIND = /^[a-z][a-z0-9-]{0,29}$/u;
/** An opaque identifier has no spaces, so it cannot hold a sentence from a source. */
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9:._@/+-]{0,99}$/u;
const DEDUPE_KEY = /^[\x21-\x7e]{1,120}$/u;
const INPUT_NAME = /^[a-z][A-Za-z0-9]{0,39}$/u;

const OFFER_KEYS = [
  'id',
  'definitionId',
  'definitionRevision',
  'source',
  'reason',
  'contextRefs',
  'createdAt',
  'expiresAt',
  'decision',
  'dedupeKey',
  'prefilled',
];

/** Finds the definition revision an offer names, among the ones the catalog holds. */
export type TDefinitionLookup = (id: string, revision: number) => ITaskDefinition | undefined;

function parseRef(raw: unknown, index: number): IOfferContextRef {
  const where = `contextRefs[${index}]`;
  const ref = asRecord(raw, where);
  rejectUnknownKeys(ref, ['kind', 'id'], where);
  return {
    kind: shaped(ref['kind'], `${where}.kind`, REF_KIND, 30),
    id: shaped(ref['id'], `${where}.id`, OPAQUE_ID, 100),
  };
}

function parsePrefilled(
  raw: unknown,
  definition: ITaskDefinition | undefined,
): Record<string, string> {
  const entries = Object.entries(asRecord(raw, 'prefilled'));
  if (entries.length > OFFER_LIMITS.prefilledEntries)
    throw new TaskCatalogRefusedError(
      `prefilled must have at most ${OFFER_LIMITS.prefilledEntries} entries`,
    );
  const prefilled: Record<string, string> = {};
  for (const [name, value] of entries) {
    shaped(name, 'prefilled name', INPUT_NAME, 40);
    if (definition !== undefined && !definition.inputs.some((input) => input.name === name))
      throw new TaskCatalogRefusedError(`prefilled names an input the task does not have: ${name}`);
    prefilled[name] = plainLine(value, `prefilled.${name}`, OFFER_LIMITS.prefilledValue);
  }
  return prefilled;
}

/**
 * The offer as a fresh value, or the refusal that says which field is wrong. With `find`, an offer
 * whose definition revision is not in the catalog is refused; a store reading its own records passes
 * none, because a revision that has since left the catalog is shown as withdrawn, not dropped.
 */
export function parseOffer(raw: unknown, find?: TDefinitionLookup): IOffer {
  const offer = asRecord(raw, 'An offer');
  rejectUnknownKeys(offer, OFFER_KEYS, 'An offer');
  const definitionId = shaped(offer['definitionId'], 'definitionId', DEFINITION_ID, 60);
  const definitionRevision = positiveInteger(offer['definitionRevision'], 'definitionRevision');
  const definition = find?.(definitionId, definitionRevision);
  if (find !== undefined && definition === undefined)
    throw new TaskCatalogRefusedError(
      `No task ${definitionId} revision ${definitionRevision} is in the catalog`,
    );
  const createdAt = isoTime(offer['createdAt'], 'createdAt');
  const expiresAt = isoTime(offer['expiresAt'], 'expiresAt');
  if (Date.parse(expiresAt) <= Date.parse(createdAt))
    throw new TaskCatalogRefusedError('expiresAt must be after createdAt');
  return {
    id: shaped(offer['id'], 'id', OFFER_ID, 46),
    definitionId,
    definitionRevision,
    source: oneOf(offer['source'], 'source', OFFER_SOURCES),
    reason: plainLine(offer['reason'], 'reason', OFFER_LIMITS.reason),
    contextRefs: listOf(offer['contextRefs'], 'contextRefs', 0, OFFER_LIMITS.contextRefs).map(
      parseRef,
    ),
    createdAt,
    expiresAt,
    decision: oneOf(offer['decision'], 'decision', OFFER_DECISIONS),
    dedupeKey: shaped(offer['dedupeKey'], 'dedupeKey', DEDUPE_KEY, OFFER_LIMITS.dedupeKey),
    ...(offer['prefilled'] !== undefined && {
      prefilled: parsePrefilled(offer['prefilled'], definition),
    }),
  };
}
