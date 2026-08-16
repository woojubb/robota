/**
 * What THIS model can be asked to do. PROV-006.
 *
 * The provider catalog carries a per-model capability vocabulary — `tools`, `vision`,
 * `json_schema`, `reasoning`, `native_web`, `streaming` — and nothing read it. Tool gating asked a
 * per-PROVIDER boolean, so a model whose own entry declares no `tools` was handed the whole toolset.
 *
 * Split out of `execution-round-provider.ts` to keep it under the size ceiling, and because "may
 * this model be asked this?" is a question of its own — separate from assembling the request.
 *
 * The rule: only a POPULATED capability list that omits the capability is a denial. A catalog silent
 * about a model has said nothing, and reading silence as refusal would cripple every model no
 * catalog happens to list.
 *
 * `vision` is deliberately NOT gated here — see PROV-010. A first attempt refused any turn whose
 * outgoing messages carried an image part, which is correct about what is sent and wrong about what
 * to do: `setModel()` preserves the conversation, so switching to a non-vision model left every
 * later text-only turn permanently refused because an old image was still in the history.
 */

import { resolveModelCapability } from '../interfaces/model-capability.js';

import type { IResolvedProviderInfo } from './execution-types';
import type { IChatOptions } from '../interfaces/provider';

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
  if (resolveModelCapability(resolved.provider.capabilityTable?.(), model, 'tools', true)) return;
  delete chatOptions.tools;
  delete chatOptions.toolChoice;
}
