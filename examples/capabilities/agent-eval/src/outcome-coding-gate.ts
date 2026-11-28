import type { SpendLedger } from './outcome-coding-ledger.js';
import { parseReceipt } from './outcome-coding-pricing.js';
import type { TJson, TJsonObject } from './outcome-coding-protocol.js';
import type { IRelayGate } from './outcome-coding-relay.js';

/**
 * Connects the relay to the spend ledger. A request is admitted only if the ledger reserves its
 * maximum cost first; the reply's receipt then replaces the reservation. These conditions stop the
 * run with no retry and no further admission:
 *
 * - no answer, or an answer that is not a success (an unknown or failed paid call: the reservation
 *   stays, because the provider may still have charged it);
 * - a success without a readable cost (also unknown, same reservation);
 * - a receipt whose provider or model differs from the pinned route;
 * - a success whose generation record (the only place the serving provider is named) cannot be read
 *   (also unknown, same reservation);
 * - a receipt whose output tokens exceed the output cap;
 * - a receipt whose cost exceeds its reservation (recorded at the real cost, against the ceiling).
 */
export function createLedgerGate(
  ledger: SpendLedger,
  lookup: (body: TJson) => Promise<TJsonObject | undefined>,
): IRelayGate {
  const { route, maxOutputTokens } = ledger.header;
  return {
    admit({ bytes, body }) {
      const requested = body.max_tokens;
      if (typeof requested !== 'number' || !Number.isSafeInteger(requested) || requested <= 0) {
        return { ok: false, detail: 'the request carries no usable output cap' };
      }
      const admission = ledger.admit({ requestBytes: bytes, maxOutputTokens: requested });
      if (!admission.ok) return { ok: false, detail: `${admission.code}: ${admission.detail}` };
      const { id } = admission;
      return {
        ok: true,
        async settle(answer) {
          if (answer === undefined) {
            ledger.stop(`call ${id} got no answer; its reservation stays`);
            return { stop: `call ${id} got no answer` };
          }
          const replied = parseReceipt(answer.body);
          if (answer.status < 200 || answer.status >= 300 || replied.costMicros === undefined) {
            ledger.stop(
              `call ${id} has no usable receipt (status ${answer.status}); its reservation stays`,
            );
            return { stop: `call ${id} has no usable receipt` };
          }
          let generation: TJsonObject | undefined;
          try {
            generation = await lookup(answer.body);
          } catch {
            generation = undefined;
          }
          if (generation === undefined) {
            ledger.stop(
              `call ${id} has no generation record confirming the provider; its reservation stays`,
            );
            return { stop: `call ${id} has no generation record confirming the provider` };
          }
          const receipt = parseReceipt(answer.body, generation);
          const problems: string[] = [];
          if (receipt.provider !== route.provider)
            problems.push('the provider differs from the pinned route');
          if (receipt.model !== route.model || receipt.generationModel !== route.model)
            problems.push('the model differs from the pinned route');
          if (receipt.outputTokens === undefined || receipt.outputTokens > maxOutputTokens) {
            problems.push('the output tokens are missing or exceed the output cap');
          }
          const { overrun } = ledger.settle(id, {
            costMicros: receipt.costMicros as number,
            ...(receipt.promptTokens === undefined ? {} : { promptTokens: receipt.promptTokens }),
            ...(receipt.outputTokens === undefined ? {} : { outputTokens: receipt.outputTokens }),
          });
          if (overrun) problems.push('the cost exceeds the reservation');
          if (problems.length === 0) return {};
          const reason = `call ${id}: ${problems.join('; ')}`;
          ledger.stop(reason);
          return { stop: reason };
        },
      };
    },
  };
}
