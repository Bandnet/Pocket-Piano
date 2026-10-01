export const DEFAULT_BPM = 120;
export const MIN_BPM = 40;
export const MAX_BPM = 240;

export function normalizeBpm(value: number) {
  return Math.max(MIN_BPM, Math.min(MAX_BPM, Math.round(value)));
}

// Recordings are stored in milliseconds at the default tempo.
export function playbackScale(bpm: number) {
  return DEFAULT_BPM / normalizeBpm(bpm);
}
