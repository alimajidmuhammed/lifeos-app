/**
 * Expo-Portable Lexicographic Fractional Indexing (Base-62: 0-9 A-Z a-z)
 *
 * Enables O(1) single-document Firestore writes when dragging/reordering tasks or folders.
 * Uses ASCII code-point order ('0' < '9' < 'A' < 'Z' < 'a' < 'z') which matches
 * Cloud Firestore's UTF-8 byte sort order identically across Web, Android, and iOS.
 */

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE = DIGITS.length; // 62
const MID_CHAR = DIGITS[Math.floor(BASE / 2)]; // 'V'
const FIRST_CHAR = DIGITS[0]; // '0'
const LAST_CHAR = DIGITS[BASE - 1]; // 'z'

function charToDigit(ch: string): number {
  const idx = DIGITS.indexOf(ch);
  if (idx === -1) {
    throw new Error(`Invalid fractional index character: "${ch}"`);
  }
  return idx;
}

export function compareSortKeys(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export function sortBySortKey<T extends { sortKey: string; id: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    const cmp = compareSortKeys(a.sortKey, b.sortKey);
    if (cmp !== 0) return cmp;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * Generates a base-62 key strictly between `prev` and `next` in ASCII/UTF-8 lexicographic order:
 *   prev < result < next
 *
 * - If both are null/undefined: returns initial midpoint 'V'.
 * - If only prev is provided (append): returns key > prev.
 * - If only next is provided (prepend): returns key < next.
 * - If both are provided: returns strict midpoint (expanding precision when adjacent).
 */
export function generateSortKeyBetween(
  prev?: string | null,
  next?: string | null
): string {
  const a = prev && prev.length > 0 ? prev : null;
  const b = next && next.length > 0 ? next : null;

  if (!a && !b) {
    return MID_CHAR;
  }

  if (a && !b) {
    // Append after `a`
    const firstDigit = charToDigit(a[0]);
    if (firstDigit < BASE - 1) {
      // Jump cleanly toward the top of the alphabet to keep keys short
      const step = Math.max(1, Math.floor((BASE - 1 - firstDigit) / 2));
      return DIGITS[firstDigit + step];
    }
    // Already starts with 'z' -> walk right until we find a digit < 'z', or append 'V'
    for (let i = 1; i < a.length; i++) {
      const d = charToDigit(a[i]);
      if (d < BASE - 1) {
        const nextD = Math.min(BASE - 1, d + Math.max(1, Math.floor((BASE - 1 - d) / 2)));
        return a.slice(0, i) + DIGITS[nextD];
      }
    }
    return a + MID_CHAR;
  }

  if (!a && b) {
    // Prepend before `b`
    const firstDigit = charToDigit(b[0]);
    if (firstDigit > 1) {
      return DIGITS[Math.floor(firstDigit / 2)];
    }
    // Walk until we find a character > '0'
    for (let i = 0; i < b.length; i++) {
      const d = charToDigit(b[i]);
      if (d > 1) {
        return b.slice(0, i) + DIGITS[Math.floor(d / 2)];
      }
      if (d === 1) {
        return b.slice(0, i) + FIRST_CHAR + MID_CHAR;
      }
    }
    // All '0's — shouldn't happen in normal use, produce strictly smaller via prefix check
    throw new Error(`Cannot prepend before minimum fractional key "${b}".`);
  }

  // Both `a` and `b` exist
  const left = a!;
  const right = b!;
  if (compareSortKeys(left, right) >= 0) {
    throw new Error(`Invalid bounds: prev ("${left}") must be strictly less than next ("${right}").`);
  }

  let prefix = '';
  let i = 0;
  const maxLen = Math.max(left.length, right.length) + 8;

  while (i < maxLen) {
    const dLeft = i < left.length ? charToDigit(left[i]) : 0;
    const dRight = i < right.length ? charToDigit(right[i]) : BASE;

    if (dLeft === dRight) {
      prefix += DIGITS[dLeft];
      i++;
      continue;
    }

    if (dRight - dLeft > 1) {
      const mid = Math.floor((dLeft + dRight) / 2);
      const candidate = prefix + DIGITS[mid];
      if (compareSortKeys(left, candidate) < 0 && compareSortKeys(candidate, right) < 0) {
        return candidate;
      }
    }

    // Adjacent digits (dRight - dLeft === 1): keep dLeft and expand rightward
    prefix += DIGITS[dLeft];
    i++;

    while (i < maxLen) {
      const tailLeft = i < left.length ? charToDigit(left[i]) : 0;
      if (tailLeft < BASE - 1) {
        const mid = Math.ceil((tailLeft + BASE) / 2);
        const clamped = Math.min(BASE - 1, Math.max(tailLeft + 1, mid));
        const candidate = prefix + DIGITS[clamped];
        if (compareSortKeys(left, candidate) < 0 && compareSortKeys(candidate, right) < 0) {
          return candidate;
        }
      }
      prefix += LAST_CHAR;
      i++;
    }
  }

  // Fallback guaranteed strictly greater than `left` and less than `right`
  return left + MID_CHAR;
}
