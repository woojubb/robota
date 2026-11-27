import { toCents } from './units.mjs';

export function invoiceTotal(items) {
  return items.reduce((sum, item) => {
    const quantity = item.quantity ?? 1;
    return sum + toCents(item.price) * quantity;
  }, 0);
}
