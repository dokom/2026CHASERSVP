/**
 * Scalars shared between timelines and the WebGL layer without going through
 * React state. The stage reads these every frame; re-rendering React 60
 * times a second to move particles would be the wrong tool.
 */
export const journey = {
  /** 0 = seal intact, 1 = fully broken. Written by Arrival's scroll timeline. */
  sealBreak: 0,
  /** Continuous act position, 0 (welcome) to 4 (response). Written only
   * through `setStage`; see acts.ts for how scroll maps onto it. */
  stage: 0,
}

type StageListener = () => void

const stageListeners = new Set<StageListener>()

/**
 * Writes the stage and wakes whoever renders it. The stage's render loop
 * sleeps once it has settled, and scroll is not the only thing that moves
 * the stage — a page that grows under a resting guest (the RSVP form
 * swapping for its ticket) moves it too — so listeners are told about every
 * change, after the new value is in place.
 */
export function setStage(value: number): void {
  if (journey.stage === value) return
  journey.stage = value
  stageListeners.forEach((listener) => listener())
}

/** Subscribes to stage changes; returns the unsubscribe. */
export function onStageChange(listener: StageListener): () => void {
  stageListeners.add(listener)
  return () => {
    stageListeners.delete(listener)
  }
}
