export function invoiceTotal(items) { return items.reduce((s, item) => s + item.price, 0); }
