import { PlayNavigation } from '@/components/play-navigation';
import { DEFAULT_BPM, normalizeBpm } from '@/constants/tempo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

const RECORDING_STORAGE_PREFIX = '@pocket-piano/recording/';
const EMPTY_NOTES: RecordedNote[] = [];

// Musical Constants & Geometry (Increased for larger, clearer notation)
const STAFF_LINE_SPACING = 14; 
const SYSTEM_PADDING_TOP = 32;
const TREBLE_TOP_LINE = SYSTEM_PADDING_TOP + 12; 
const BASS_TOP_LINE = TREBLE_TOP_LINE + 4 * STAFF_LINE_SPACING + 54;

const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const letterSteps = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };

// Key signature definitions (accidental placement steps relative to staff top line)
type KeySignature = 'C' | 'G' | 'D' | 'F' | 'Bb';

const KEY_SIGNATURE_ACCIDENTALS: Record<KeySignature, { note: string; symbol: string; trebleStep: number; bassStep: number }[]> = {
  C: [],
  G: [{ note: 'F#', symbol: '♯', trebleStep: 0, bassStep: 2 }], // F# on top line of treble
  D: [
    { note: 'F#', symbol: '♯', trebleStep: 0, bassStep: 2 },
    { note: 'C#', symbol: '♯', trebleStep: 3.5, bassStep: 5.5 },
  ],
  F: [{ note: 'A#', symbol: '♭', trebleStep: 2, bassStep: 4 }], // Bb
  Bb: [
    { note: 'A#', symbol: '♭', trebleStep: 2, bassStep: 4 },
    { note: 'D#', symbol: '♭', trebleStep: -0.5, bassStep: 1.5 },
  ],
};

type RecordedNote = {
  id?: string;
  note: string;
  at: number;
  duration: number;
};

type StoredRecording = {
  notes: RecordedNote[];
  duration: number;
  bpm?: number;
  key?: KeySignature;
};

function noteToMidi(note: string): number {
  const octave = Number(note.slice(-1));
  const name = note.slice(0, -1);
  return (octave + 1) * 12 + noteNames.indexOf(name);
}

function diatonicStep(note: string): number {
  const octave = Number(note.slice(-1));
  const letter = note.replace('#', '').slice(0, -1) as keyof typeof letterSteps;
  return octave * 7 + letterSteps[letter];
}

function durationSymbol(durationMs: number, quarterMs: number): string {
  const beats = durationMs / quarterMs;
  if (beats >= 3.5) return '𝅝'; 
  if (beats >= 1.75) return '𝅗𝅥'; 
  if (beats >= 0.75) return '♩'; 
  return '♪'; 
}

function getNotePosition(noteName: string) {
  const midi = noteToMidi(noteName);
  const step = diatonicStep(noteName);
  const isBassClef = midi < 60;

  const refStep = isBassClef ? 26 : 38;
  const refY = isBassClef ? BASS_TOP_LINE : TREBLE_TOP_LINE;

  const y = refY + (refStep - step) * (STAFF_LINE_SPACING / 2);

  const ledgerLines: number[] = [];
  if (!isBassClef) {
    if (step < 30) {
      for (let s = 28; s >= step; s -= 2) {
        ledgerLines.push(TREBLE_TOP_LINE + (38 - s) * (STAFF_LINE_SPACING / 2));
      }
    } else if (step > 38) {
      for (let s = 40; s <= step; s += 2) {
        ledgerLines.push(TREBLE_TOP_LINE - (s - 38) * (STAFF_LINE_SPACING / 2));
      }
    }
  } else {
    if (step < 18) {
      for (let s = 16; s >= step; s -= 2) {
        ledgerLines.push(BASS_TOP_LINE + (26 - s) * (STAFF_LINE_SPACING / 2));
      }
    } else if (step > 26) {
      for (let s = 28; s <= step; s += 2) {
        ledgerLines.push(BASS_TOP_LINE - (s - 26) * (STAFF_LINE_SPACING / 2));
      }
    }
  }

  return { y, ledgerLines };
}

export default function NotenPage() {
  const { project } = useLocalSearchParams<{ project?: string }>();
  const projectName = Array.isArray(project) ? project[0] : project || 'default';
  const [recording, setRecording] = useState<StoredRecording | null>(null);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(`${RECORDING_STORAGE_PREFIX}${encodeURIComponent(projectName)}`)
      .then((stored) => {
        if (!cancelled && stored) setRecording(JSON.parse(stored) as StoredRecording);
      })
      .catch((error) => console.warn('Could not load notation data', error));
    return () => {
      cancelled = true;
    };
  }, [projectName]);

  const bpm = normalizeBpm(recording?.bpm ?? DEFAULT_BPM);
  const notes = recording?.notes ?? EMPTY_NOTES;
  const keySignature: KeySignature = recording?.key ?? 'G'; // Key signature defaults to G major (F#)
  const keyAccidentals = KEY_SIGNATURE_ACCIDENTALS[keySignature] || [];

  const quarterMs = 60000 / bpm;
  const barMs = quarterMs * 4;

  const barGroups = useMemo(() => {
    if (!notes.length) return [];
    
    const totalDuration = Math.max(recording?.duration ?? 0, ...notes.map((n) => n.at + n.duration));
    const totalBars = Math.max(1, Math.ceil(totalDuration / barMs));
    const groups: RecordedNote[][] = Array.from({ length: totalBars }, () => []);

    notes.forEach((note) => {
      const barIndex = Math.floor(note.at / barMs);
      if (groups[barIndex]) {
        groups[barIndex].push(note);
      }
    });

    return groups;
  }, [notes, recording, barMs]);

  return (
    <View style={styles.screen}>
      <PlayNavigation
        projectName={projectName}
        isRecording={false}
        isPlaying={false}
        hasRecording={false}
        onTogglePlayback={() => undefined}
        showRecording={false}
      />

      <View style={styles.heading}>
        <Text style={styles.title}>Music Sheet</Text>
        <Text style={styles.meta}>Key: {keySignature} · {bpm} BPM · 4/4</Text>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {!notes.length ? (
          <Text style={styles.empty}>No notes yet. Record music or add notes first.</Text>
        ) : (
          <View style={styles.scoreContainer}>
            <View style={styles.measureGrid}>
              {barGroups.map((barNotes, barIndex) => {
                const isStartOfLine = barIndex % 2 === 0;

                return (
                  <View key={`bar-${barIndex}`} style={styles.measureBox}>
                    {/* Render Clefs, Key Signature, and Time Signature at start of each row */}
                    {isStartOfLine && (
                      <View style={styles.headerGroup}>
                        <Text style={[styles.clef, { top: TREBLE_TOP_LINE - 18 }]}>𝄞</Text>
                        <Text style={[styles.clef, { top: BASS_TOP_LINE - 16 }]}>𝄢</Text>

                        {/* Key Signature Accidentals */}
                        {keyAccidentals.map((acc, i) => (
                          <View key={`key-acc-${i}`} style={{ position: 'absolute', left: 24 + i * 10 }}>
                            <Text style={[styles.keyAccidental, { top: TREBLE_TOP_LINE + acc.trebleStep * (STAFF_LINE_SPACING / 2) - 8 }]}>
                              {acc.symbol}
                            </Text>
                            <Text style={[styles.keyAccidental, { top: BASS_TOP_LINE + acc.bassStep * (STAFF_LINE_SPACING / 2) - 8 }]}>
                              {acc.symbol}
                            </Text>
                          </View>
                        ))}

                        {/* Time Signature (First measure only) */}
                        {barIndex === 0 && (
                          <View style={[styles.timeSignature, { left: 28 + keyAccidentals.length * 10, top: TREBLE_TOP_LINE + 4 }]}>
                            <Text style={styles.timeText}>4</Text>
                            <Text style={styles.timeText}>4</Text>
                          </View>
                        )}
                      </View>
                    )}

                    {/* Treble Lines */}
                    {[0, 1, 2, 3, 4].map((i) => (
                      <View
                        key={`treble-line-${i}`}
                        style={[styles.staffLine, { top: TREBLE_TOP_LINE + i * STAFF_LINE_SPACING }]}
                      />
                    ))}

                    {/* Bass Lines */}
                    {[0, 1, 2, 3, 4].map((i) => (
                      <View
                        key={`bass-line-${i}`}
                        style={[styles.staffLine, { top: BASS_TOP_LINE + i * STAFF_LINE_SPACING }]}
                      />
                    ))}

                    {/* Bar Lines */}
                    <View style={[styles.barLine, { top: TREBLE_TOP_LINE, height: BASS_TOP_LINE + 4 * STAFF_LINE_SPACING - TREBLE_TOP_LINE }]} />
                    <View style={[styles.barLine, { right: 0, top: TREBLE_TOP_LINE, height: BASS_TOP_LINE + 4 * STAFF_LINE_SPACING - TREBLE_TOP_LINE }]} />

                    {/* Notes in Measure */}
                    {barNotes.map((note, noteIdx) => {
                      const barStartMs = barIndex * barMs;
                      const relativeTime = note.at - barStartMs;
                      
                      // Calculate offset padding if line headers are present
                      const minLeft = isStartOfLine ? 35 + keyAccidentals.length * 6 : 15;
                      const leftPercent = Math.min(88, Math.max(minLeft, (relativeTime / barMs) * 100));
                      
                      const { y, ledgerLines } = getNotePosition(note.note);
                      const symbol = durationSymbol(note.duration, quarterMs);

                      // Suppress accidental if already covered by the key signature
                      const hasSharp = note.note.includes('#');
                      const inKeySig = keyAccidentals.some((a) => a.note === note.note.replace(/\d/, ''));
                      const showAccidental = hasSharp && !inKeySig;

                      return (
                        <View
                          key={note.id ?? `${barIndex}-${note.note}-${noteIdx}`}
                          style={[styles.noteWrapper, { left: `${leftPercent}%`, top: y - 10 }]}
                        >
                          {/* Ledger Lines */}
                          {ledgerLines.map((lineY, lIdx) => (
                            <View
                              key={`ledger-${lIdx}`}
                              style={[
                                styles.ledgerLine,
                                { top: lineY - y + 18 },
                              ]}
                            />
                          ))}

                          {showAccidental ? <Text style={styles.accidental}>♯</Text> : null}
                          <Text style={styles.noteSymbol}>{symbol}</Text>
                          <Text style={styles.noteLabel}>{note.note}</Text>
                        </View>
                      );
                    })}
                  </View>
                );
              })}
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f8fafc' },
  heading: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderColor: '#e2e8f0',
  },
  title: { fontSize: 22, fontWeight: '700', color: '#0f172a' },
  meta: { color: '#64748b', fontWeight: '600' },
  scroll: { flex: 1 },
  scrollContent: { padding: 12 },
  empty: { color: '#64748b', textAlign: 'center', marginTop: 40 },
  scoreContainer: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    padding: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  measureGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  measureBox: {
    width: '50%',
    height: 230, // Increased height for larger staff spacing and clear visibility
    position: 'relative',
    marginVertical: 8,
  },
  headerGroup: {
    position: 'absolute',
    left: 2,
    zIndex: 2,
  },
  clef: {
    position: 'absolute',
    fontSize: 42, // Larger clefs
    color: '#0f172a',
  },
  keyAccidental: {
    position: 'absolute',
    fontSize: 20,
    fontWeight: 'bold',
    color: '#0f172a',
  },
  timeSignature: {
    position: 'absolute',
    alignItems: 'center',
  },
  timeText: {
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 16,
    color: '#0f172a',
  },
  staffLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1.5,
    backgroundColor: '#64748b',
  },
  barLine: {
    position: 'absolute',
    width: 1.5,
    backgroundColor: '#334155',
  },
  noteWrapper: {
    position: 'absolute',
    alignItems: 'center',
    width: 28,
    marginLeft: -14,
    zIndex: 5,
  },
  noteSymbol: {
    fontSize: 32, // Significantly larger note heads
    lineHeight: 30,
    color: '#0f172a',
  },
  noteLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: '#475569',
    marginTop: 1,
  },
  accidental: {
    position: 'absolute',
    left: -10,
    top: 2,
    fontSize: 18,
    fontWeight: 'bold',
    color: '#0f172a',
  },
  ledgerLine: {
    position: 'absolute',
    width: 24,
    height: 1.5,
    backgroundColor: '#475569',
    left: 2,
  },
});