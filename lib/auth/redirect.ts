/**
 * Safe redirect handling.
 *
 * `redirectTo` arrives from a query string, so it is attacker-controlled.
 * Only same-origin, single-slash paths are allowed; anything else falls back
 * to the default destination.
 */

export const DEFAULT_REDIRECT = "/dashboard";

/**
 * True when the path contains a space, a control character or DEL. Browsers
 * strip tabs and newlines from URLs, so "/<TAB>/evil.com" could otherwise
 * become a protocol-relative URL after normalisation.
 */
function hasUnsafeCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x20 || code === 0x7f) return true;
  }
  return false;
}

export function safeRedirect(
  target: string | null | undefined,
  fallback: string = DEFAULT_REDIRECT,
): string {
  if (!target) return fallback;

  const value = target.trim();
  if (value === "") return fallback;

  // Must be a root-relative path.
  if (!value.startsWith("/")) return fallback;

  // "//evil.com" and "/\evil.com" are protocol-relative URLs, not local paths.
  if (value.startsWith("//")) return fallback;

  // A backslash is normalised to "/" by some browsers; refuse rather than guess.
  if (value.includes("\\")) return fallback;

  if (hasUnsafeCharacter(value)) return fallback;

  return value;
}
