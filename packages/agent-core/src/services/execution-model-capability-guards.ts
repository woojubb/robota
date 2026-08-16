/**
 * What THIS model can be asked to do. PROV-006.
 *
 * The provider catalog carries a per-model capability vocabulary — `tools`, `vision`,
 * `json_schema`, `reasoning`, `native_web`, `streaming` — and nothing read it. Tool gating asked a
 * per-PROVIDER boolean, so a model whose own entry declares no `tools` was handed the whole toolset;
 * an image was sent to a model that cannot see one.
 *
 * Split out of `execution-round-provider.ts` to keep it under the size ceiling, and because "may
 * this model be asked this?" is a question of its own — separate from assembling the request.
 *
 * The rule both guards share: only a POPULATED capability list that omits the capability is a
 * denial. A catalog silent about a model has said nothing, and reading silence as refusal would
 * cripple every model no catalog happens to list.
 */

import { modelDeclaresCapability, resolveModelCapability } from '../interfaces/model-capability.js';

import type { IResolvedProviderInfo } from './execution-types';
import type { TUniversalMessage } from '../interfaces/messages';
import type { IChatOptions } from '../interfaces/provider';

/**
 * Refuse to send an image to a model whose catalog says it cannot see one. PROV-006.
 *
 * The catalog carries `vision` per model and nothing checked it, so an image was sent regardless.
 * The two outcomes are a vendor error the user cannot interpret, or — worse — the image silently
 * ignored and an answer produced as though it had been read. Refusing here names the model and the
 * reason before the request leaves.
 *
 * Only a POPULATED capability list that omits `vision` is a denial. A catalog that says nothing
 * about a model still sends, because silence is not a statement (`interfaces/model-capability.ts`).
 */
export function assertModelAcceptsImages(
  messages: TUniversalMessage[],
  model: string,
  resolved: IResolvedProviderInfo,
): void {
  const carriesImage = messages.some((message) =>
    message.parts?.some((part) => part.type === 'image_inline' || part.type === 'image_uri'),
  );
  if (!carriesImage) return;
  if (modelDeclaresCapability(resolved.provider.modelCatalog?.(), model, 'vision') !== false) {
    return;
  }
  throw new Error(
    `[EXECUTION] Model "${model}" does not support images — its provider's model catalog declares ` +
      'no `vision` capability for it. Choose a vision-capable model, or send the request without ' +
      'image parts.',
  );
}

/**
 * Withhold tools from a model that declares none.
 *
 * Mutates the options rather than rebuilding them: the tool list is assembled once for the turn, and
 * a second assembly path is how the two capability answers drifted apart in the first place.
 */
export function applyModelToolCapability(
  chatOptions: IChatOptions,
  model: string,
  resolved: IResolvedProviderInfo,
): void {
  if (chatOptions.tools === undefined) return;
  if (resolveModelCapability(resolved.provider.modelCatalog?.(), model, 'tools', true)) return;
  delete chatOptions.tools;
  delete chatOptions.toolChoice;
}
