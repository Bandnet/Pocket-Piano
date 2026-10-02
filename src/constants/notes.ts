const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_OFFSETS: Record<string, number> = { Db: 1, Eb: 3, Gb: 6, Ab: 8, Bb: 10 };

export function midiToName(midi: number) {
  return `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

export function noteNameToMidi(name: string) {
  const match = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(name.trim());
  if (!match) return Number.NaN;

  const [, letter, accidental, octaveText] = match;
  const pitchClass = NOTE_NAMES.indexOf(`${letter.toUpperCase()}${accidental === 'b' ? '' : accidental}`);
  const normalizedPitchClass = accidental === 'b'
    ? (FLAT_OFFSETS[`${letter.toUpperCase()}b`] ?? Number.NaN)
    : pitchClass;
  if (Number.isNaN(normalizedPitchClass)) return Number.NaN;
  return (Number(octaveText) + 1) * 12 + normalizedPitchClass;
}
