/**
 * Slug validation rules and helpers.
 *
 * Enforces the canonical, filesystem-safe slug pattern across Vellum.
 * Slugs must start with an alphanumeric character (preventing leading dots,
 * slashes, dashes, or relative traversal segments like '.' and '..') followed
 * by alphanumeric characters, dots, underscores, or hyphens.
 *
 * Consistent with electron/main.ts SLUG_PATTERN and core/ingest/classify.ts output.
 */

export const SLUG_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/

/**
 * Validates whether a value is a valid, filesystem-safe slug string.
 */
export function isValidSlug(slug: unknown): slug is string {
  return typeof slug === 'string' && SLUG_PATTERN.test(slug)
}

/**
 * Asserts that a value is a valid slug, throwing an Error if it is not.
 */
export function assertValidSlug(slug: unknown): asserts slug is string {
  if (!isValidSlug(slug)) {
    throw new Error(`Invalid slug format: ${describeValue(slug)}`)
  }
}

// Input is `unknown`, so building the message must not itself throw
// (template literals throw on Symbols and null-prototype objects).
function describeValue(value: unknown): string {
  try {
    return String(value)
  } catch {
    return Object.prototype.toString.call(value)
  }
}
