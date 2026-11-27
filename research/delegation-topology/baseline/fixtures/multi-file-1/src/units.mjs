export function toCents(amount) { return Math.round(amount * 100); }

export function formatMoney(cents) {
  return `$${(Math.round(cents) / 100).toFixed(2)}`;
}
