import { toCents } from './units.mjs';

export function invoiceTotal(items) {
  return items.reduce((sum, item) => sum + toCents(item.price) * (item.quantity ?? 1), 0);
}
