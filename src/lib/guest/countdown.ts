export type CountdownParts = {
  days: number
  hours: number
  minutes: number
  seconds: number
  /** True once `now` has reached the target — the parts are all zero. */
  hasArrived: boolean
}

const MS_PER_SECOND = 1000
const MS_PER_MINUTE = 60 * MS_PER_SECOND
const MS_PER_HOUR = 60 * MS_PER_MINUTE
const MS_PER_DAY = 24 * MS_PER_HOUR

/**
 * Splits the time until `target` into whole days/hours/minutes/seconds.
 * Pure, so the server and the client compute the identical first frame
 * from the same `now` and hydration never mismatches.
 */
export function countdownParts(target: Date, now: Date): CountdownParts {
  const remaining = Math.max(0, target.getTime() - now.getTime())
  return {
    days: Math.floor(remaining / MS_PER_DAY),
    hours: Math.floor((remaining % MS_PER_DAY) / MS_PER_HOUR),
    minutes: Math.floor((remaining % MS_PER_HOUR) / MS_PER_MINUTE),
    seconds: Math.floor((remaining % MS_PER_MINUTE) / MS_PER_SECOND),
    hasArrived: remaining === 0,
  }
}
