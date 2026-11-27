/**
 * Convert a value into a URL-friendly slug.
 *
 * The value is coerced to a string and lowercased, every run of characters
 * that are not ASCII letters or digits is collapsed into a single hyphen, and
 * any leading/trailing hyphens are removed. Whitespace-only input therefore
 * yields an empty string.
 *
 * @param {unknown} value Value to slugify.
 * @returns {string} The slug.
 */
export function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
