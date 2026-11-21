import type { IAssistantMessage } from '../interfaces/messages';
import { isJsonEqual } from './json-equal';

/** Compare the data-bearing metadata used to bind a receipt to its committed history. */
export function sameReceiptMetadata(
  leftMetadata: IAssistantMessage['metadata'],
  rightMetadata: IAssistantMessage['metadata'],
): boolean {
  if (leftMetadata === undefined || rightMetadata === undefined)
    return leftMetadata === rightMetadata;
  if (
    leftMetadata === null ||
    rightMetadata === null ||
    typeof leftMetadata !== 'object' ||
    typeof rightMetadata !== 'object' ||
    Object.getPrototypeOf(leftMetadata) !== Object.prototype ||
    Object.getPrototypeOf(rightMetadata) !== Object.prototype
  )
    return false;
  const keys = Object.keys(leftMetadata);
  if (keys.length !== Object.keys(rightMetadata).length) return false;
  return keys.every((key) => {
    if (!Object.hasOwn(rightMetadata, key)) return false;
    const a = leftMetadata[key];
    const b = rightMetadata[key];
    if (a instanceof Date || b instanceof Date)
      return (
        a instanceof Date &&
        b instanceof Date &&
        Number.isFinite(a.getTime()) &&
        a.getTime() === b.getTime()
      );
    return isJsonEqual(a, b);
  });
}
