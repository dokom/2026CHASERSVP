/**
 * Placeholder invites are printed as "001", "002", … so the printer can match
 * each QR code to a physical card. The width grows only when a batch pushes
 * past 999 — a 1,200-guest run prints "0001" … "1200".
 */
export const MIN_NUMBER_WIDTH = 3

export function numberWidth(highestNumber: number): number {
  return Math.max(MIN_NUMBER_WIDTH, String(Math.max(0, Math.trunc(highestNumber))).length)
}

export function formatInviteNumber(number: number, highestNumber: number = number): string {
  return String(number).padStart(numberWidth(highestNumber), '0')
}

/** The label a fresh placeholder is created with; the admin renames it later. */
export function placeholderLabel(number: number, highestNumber: number): string {
  return formatInviteNumber(number, highestNumber)
}

/**
 * Allocates `count` consecutive numbers after the highest one already in
 * use. A deleted invite in the middle of a run leaves a gap rather than
 * being refilled: its card may already be printed, and a number belongs to
 * one card. (Deleting the very last number does let the next batch reissue
 * it — that card's old token is dead either way, so it needs reprinting.)
 */
export function nextNumbers(highestInUse: number | null, count: number): number[] {
  const start = (highestInUse ?? 0) + 1
  return Array.from({ length: count }, (_, i) => start + i)
}
