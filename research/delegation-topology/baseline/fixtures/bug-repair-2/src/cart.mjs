export function totalCents(items, discountPercent = 0) {
  if (!items || items.length === 0) return 0;

  const subtotalCents = items.reduce(
    (sum, item) => sum + item.priceCents * item.quantity,
    0,
  );

  // Apply the discount as a percentage of the subtotal, then round exactly once.
  return Math.round((subtotalCents * (100 - discountPercent)) / 100);
}
