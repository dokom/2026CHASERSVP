/**
 * Scalars shared between timelines and the WebGL layer without going through
 * React state. The foil hero reads these every frame; re-rendering React 60
 * times a second to move particles would be the wrong tool.
 */
export const journey = {
  /** 0 = seal intact, 1 = fully broken. Written by Arrival's scroll timeline. */
  sealBreak: 0,
}
