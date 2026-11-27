export function totalCents(items, discountPercent = 0) { return Math.round(items.reduce((s, i) => s + i.priceCents * i.quantity, 0) * (1 - discountPercent / 100)); }
