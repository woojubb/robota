/**
 * What a connector's content becomes in the library: claims that say where they came from. A claim
 * pulled from a connector carries an origin that marks it as read rather than heard, and a reference
 * that names the connector, so it can be found and removed together with the connection.
 */
import { registerToolPermissionProfile } from '@robota-sdk/agent-core';
import { createZodFunctionTool } from '@robota-sdk/agent-tools';
import { z } from 'zod';

import { CONNECTOR_TOOL_NAMES } from './tools.js';
import { SensitiveContentRefusedError, pageIdFor } from '../knowledge/wiki.js';
import { PAGE_KINDS } from '../knowledge/types.js';

import type { FunctionTool, TUniversalValue } from '@robota-sdk/agent-core';
import type { KnowledgeWiki } from '../knowledge/wiki.js';
import type { TClaimOrigin, TPageKind } from '../knowledge/types.js';
import type { ConnectorBook } from './book.js';
import type { TConnectorKind } from './types.js';

const PREFIX = 'connector:';
const MAX_REFERENCE = 200;

/** Where a claim pulled from a connector of this kind says it came from. */
export function originOfConnector(kind: TConnectorKind): TClaimOrigin {
  if (kind === 'mail') return 'mail';
  if (kind === 'chat') return 'peer';
  return 'tool';
}

/** The reference a claim carries: the connector, then the item it was read from. */
export function connectorReference(connectorId: string, item?: string): string {
  const detail = item?.replace(/\s+/gu, ' ').trim() ?? '';
  return detail === ''
    ? `${PREFIX}${connectorId}`
    : `${PREFIX}${connectorId} ${detail.slice(0, MAX_REFERENCE)}`;
}

function pulledFrom(reference: string | undefined, connectorId: string): boolean {
  if (reference === undefined) return false;
  const own = `${PREFIX}${connectorId}`;
  return reference === own || reference.startsWith(`${own} `);
}

/** The claims in the library that were pulled from one connector, as page and claim ids. */
async function pulledClaims(
  wiki: KnowledgeWiki,
  connectorId: string,
): Promise<{ pageId: string; claimId: string }[]> {
  const found: { pageId: string; claimId: string }[] = [];
  for (const page of await wiki.list()) {
    for (const claim of page.claims) {
      if (pulledFrom(claim.source.reference, connectorId)) {
        found.push({ pageId: page.id, claimId: claim.id });
      }
    }
  }
  return found;
}

/** How many claims in the library came from this connector. */
export async function countPulled(wiki: KnowledgeWiki, connectorId: string): Promise<number> {
  return (await pulledClaims(wiki, connectorId)).length;
}

/** Remove every claim pulled from this connector, and nothing the person or another source said. */
export async function forgetPulled(wiki: KnowledgeWiki, connectorId: string): Promise<number> {
  let forgotten = 0;
  for (const { claimId } of await pulledClaims(wiki, connectorId)) {
    forgotten += await wiki.forget({ claimId });
  }
  return forgotten;
}

function registerProfile(): void {
  // The library is the person's own data inside the agent's state directory, as for the wiki tools.
  registerToolPermissionProfile(CONNECTOR_TOOL_NAMES.keep, { riskClass: 'modify' });
}

/**
 * The tool that files a fact read from a connector into the library. It always files with the
 * origin and reference the connector's kind and id decide, so what a sync keeps can be told from
 * what the person said and removed with the connection, and it only adds: a changed fact is another
 * claim beside the old one, so content read from a service never rewrites what the person said.
 */
export function createConnectorKeepTool(options: {
  readonly book: ConnectorBook;
  readonly wiki: KnowledgeWiki;
}): FunctionTool {
  registerProfile();
  return createZodFunctionTool(
    CONNECTOR_TOOL_NAMES.keep,
    'File one fact you read from a connected service into the library: a plan, a date, a commitment, a preference, a detail about a person. Give the page it belongs on, the fact as one plain sentence, and a short reference to the item you read it from (a subject or an id). It is filed as read from the service, never as the person’s own word. Keep facts, not whole messages, and never secrets, passwords or one-time codes.',
    z.object({
      connector: z.string().min(1),
      page: z.string().min(1).describe('The title of the page the fact belongs on.'),
      kind: z.enum(PAGE_KINDS as unknown as [TPageKind, ...TPageKind[]]).optional(),
      claim: z.string().min(1).describe('The fact, as one plain sentence.'),
      reference: z.string().optional().describe('A short reference to the item it came from.'),
    }),
    async ({ connector, page, kind, claim, reference }): Promise<TUniversalValue> => {
      const known = await options.book.get(connector);
      if (known === undefined) return { kept: false, reason: `No connector ${connector}` };
      const source = {
        origin: originOfConnector(known.kind),
        reference: connectorReference(known.id, reference),
      };
      // The same fact from the same item is already there: keeping it again would only repeat it.
      const filed = (await options.wiki.read(pageIdFor(page)))?.claims ?? [];
      if (
        filed.some(
          (existing) =>
            existing.validTo === undefined &&
            existing.text === claim.trim() &&
            existing.source.reference === source.reference,
        )
      ) {
        return { kept: false, reason: 'Already kept' };
      }
      try {
        const result = await options.wiki.rememberConnectorFact({
          pageTitle: page,
          ...(kind !== undefined && { kind }),
          claim,
          source,
        });
        return { kept: true, page: result.pageId, claim: result.claimId };
      } catch (error) {
        if (error instanceof SensitiveContentRefusedError) {
          return { kept: false, reason: error.message };
        }
        throw error;
      }
    },
  );
}
