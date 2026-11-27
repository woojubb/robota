export function toCents(amount) { return Math.round(amount * 100); }

export function formatMoney(cents) {
  const rounded = Math.round(cents);
  const sign = rounded < 0 ? "-" : "";
  const abs = Math.abs(rounded);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  return `${sign}$${dollars}.${String(remainder).padStart(2, "0")}`;
}
