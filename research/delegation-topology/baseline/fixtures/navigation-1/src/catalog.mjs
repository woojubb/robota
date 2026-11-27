export function normalizeSku(value) { return String(value).trim().toUpperCase().replace(/\s+/g, '-'); }
