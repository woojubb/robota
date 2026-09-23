import { decodeDagFile, formatDagFileDecodeFailure } from '@robota-sdk/dag-builder';

import type { IDagDefinition, IDagRobotaCompanion } from '@robota-sdk/dag-core';

/** The CLI's rendering-neutral JSON DAG import result. The decoder owns both disk formats. */
export function decodeDagInput(
  parsed: unknown,
  companion?: IDagRobotaCompanion,
):
  | { readonly ok: true; readonly value: IDagDefinition }
  | { readonly ok: false; readonly message: string } {
  const decoded = decodeDagFile(parsed, companion);
  return decoded.ok
    ? { ok: true, value: decoded.value }
    : { ok: false, message: formatDagFileDecodeFailure(decoded.error) };
}
