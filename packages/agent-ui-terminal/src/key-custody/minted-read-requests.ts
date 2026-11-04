/**
 * Which user read requests the mint made: the runtime half of "only the mint makes one".
 *
 * The brand on `TUserReadRequest` stops a literal, not a cast, so the holder of the keys asks this
 * record instead of trusting the type. Only the mint records and only the port's guard asks;
 * `.dependency-cruiser.cjs` refuses every other importer, so nothing else can add a request to it.
 */
const minted = new WeakSet<object>();

/** The mint's own: `request` was made by it. */
export function recordMintedRequest(request: object): void {
  minted.add(request);
}

/** Whether the mint made `value`; it says nothing else about it. */
export function wasMintedRequest(value: unknown): boolean {
  return typeof value === 'object' && value !== null && minted.has(value);
}
