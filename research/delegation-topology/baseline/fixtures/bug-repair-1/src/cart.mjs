export function totalCents(items, discountPercent = 0) {
  const subtotalCents = items.reduce(
    (sum, item) => sum + item.priceCents * item.quantity,
    0,
  );
  // Apply the discount as a percentage of the subtotal, then round once.
  const discountedCents = (subtotalCents * (100 - discountPercent)) / 100;
  return Math.round(discountedCents);
}
