/**
 * Cell and Range Reference Parsing
 *
 * Handles Excel A1 notation parsing and conversion
 */

import type { CellRef, RangeRef } from "./types";

/**
 * Convert Excel column letters to 0-based index
 * A=0, B=1, ..., Z=25, AA=26, etc.
 *
 * @param col - Column letters (e.g., "A", "Z", "AA")
 * @returns 0-based column index
 */
export function columnToIndex(col: string): number {
  let result = 0;
  for (let i = 0; i < col.length; i++) {
    result = result * 26 + (col.charCodeAt(i) - 64); // A=1, B=2, etc.
  }
  return result - 1; // Convert to 0-based
}

/**
 * Convert 0-based index to Excel column letters
 * 0=A, 1=B, ..., 25=Z, 26=AA, etc.
 *
 * @param index - 0-based column index
 * @returns Column letters (e.g., "A", "Z", "AA")
 */
export function indexToColumn(index: number): string {
  let col = "";
  let num = index + 1; // Convert to 1-based
  while (num > 0) {
    const remainder = (num - 1) % 26;
    col = String.fromCharCode(65 + remainder) + col;
    num = Math.floor((num - 1) / 26);
  }
  return col;
}
