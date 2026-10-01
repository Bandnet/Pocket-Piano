import { PianoKey } from '@/components/piano-key';
import { PlayNavigation } from '@/components/play-navigation';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AudioPlayer, createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { useLocalSearchParams } from 'expo-router';
import { DEFAULT_BPM, normalizeBpm, playbackScale } from '@/constants/tempo';
import { useEffect, useMemo, useRef, useState } from 'react';
import { GestureResponderEvent, Platform, Pressable, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const BLACK_PITCH_CLASSES = [1, 3, 6, 8, 10];
const LOWEST_MIDI = 21; // A0
const HIGHEST_MIDI = 108; // C8
const MIN_OCTAVE = 0; // window C0 to C2 (keys below A0 are dimmed and silent)
const MAX_OCTAVE = 6; // window C6 to C8
const DEFAULT_OCTAVE = 4; // window C4 to C6
const BLACK_HEIGHT = 140;
const PIANO_HEIGHT = 220;
const MAX_PLAYERS = 12; // Android fails to create players beyond some limit, so never exceed this
const RECORDING_STORAGE_PREFIX = '@pocket-piano/recording/';

type RecordedNote = {
  note: string; // note name like "C#4", so recordings stay compatible with the editor
  at: number;
};

type StoredRecording = {
  notes: RecordedNote[];
  duration: number;
  bpm?: number;
};

function midiToName(midi: number) {
  return `${noteNames[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

function noteNameToMidi(name: string) {
  return (Number(name.slice(-1)) + 1) * 12 + noteNames.indexOf(name.slice(0, -1));
}

function isBlackKey(midi: number) {
  return BLACK_PITCH_CLASSES.includes(midi % 12);
}

function isPlayable(midi: number) {
  return midi >= LOWEST_MIDI && midi <= HIGHEST_MIDI;
}

// Salamander has a real sample every 3 semitones (A0, C1, D#1, F#1, A1, ... C8)
function sampleMidiFor(midi: number) {
  return Math.round(midi / 3) * 3;
}

function getSampleSource(sampleMidi: number) {
  // Remote files (works without any setup):
  return `https://tonejs.github.io/audio/salamander/${midiToName(sampleMidi).replace('#', 's')}.mp3`;
  // Local files (after running scripts/download-samples.js): add
  //   import { salamanderSamples } from '@/constants/salamander-samples';
  // at the top and use this line instead:
  //   return salamanderSamples[sampleMidi];
}

// The keys visible for a given octave: two octaves plus the next C (15 white, 10 black)
function buildWindow(octave: number) {
  const start = (octave + 1) * 12;
  const whites: number[] = [];
  const blacks: { midi: number; afterWhiteIndex: number }[] = [];
  for (let midi = start; midi <= start + 24; midi++) {
    if (isBlackKey(midi)) blacks.push({ midi, afterWhiteIndex: whites.length - 1 });
    else whites.push(midi);
  }
  return { whites, blacks };
}

export default function PlayPage() {
  const { project } = useLocalSearchParams<{ project?: string }>();
  const projectName = Array.isArray(project) ? project[0] : project || 'default';
  const recordingStorageKey = `${RECORDING_STORAGE_PREFIX}${encodeURIComponent(projectName)}`;
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const players = useRef(new Map<number, AudioPlayer>()); // sample midi -> player, least recently used first
  const touchNotes = useRef<Record<string, number>>({}); // finger id -> midi note it is on
  const recordingStart = useRef(0);
  const recordingNotes = useRef<RecordedNote[]>([]);
  const playbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playbackNoteTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [octave, setOctave] = useState(DEFAULT_OCTAVE);
  const [pressedNotes, setPressedNotes] = useState<number[]>([]);
  const [savedNotes, setSavedNotes] = useState<RecordedNote[]>([]);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [playhead, setPlayhead] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [timelineWidth, setTimelineWidth] = useState(0);
  const [bpm, setBpm] = useState(DEFAULT_BPM);

  const { whites, blacks } = useMemo(() => buildWindow(octave), [octave]);
  const availableWidth = Math.max(1, windowWidth - insets.left - insets.right - 16);
  const keyWidth = Math.floor(availableWidth / whites.length);
  const blackWidth = keyWidth * (2 / 3);
  const pianoWidth = whites.length * keyWidth;

  useEffect(() => {
    let cancelled = false;

    AsyncStorage.getItem(recordingStorageKey)
      .then((stored) => {
        if (cancelled || !stored) return;
        const recording = JSON.parse(stored) as StoredRecording;
        setSavedNotes(recording.notes);
        setRecordingDuration(recording.duration);
        setBpm(normalizeBpm(recording.bpm ?? DEFAULT_BPM));
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [recordingStorageKey]);

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true }).catch(() => undefined);

    const activePlayers = players.current;
    return () => {
      if (playbackTimer.current) clearTimeout(playbackTimer.current);
      playbackNoteTimers.current.forEach((timer) => clearTimeout(timer));
      activePlayers.forEach((player) => player.remove());
      activePlayers.clear();
    };
  }, []);

  // Load the samples for the visible keys in advance (9 players for 25 keys)
  useEffect(() => {
    const visible = [...whites, ...blacks.map((key) => key.midi)].filter(isPlayable);
    new Set(visible.map(sampleMidiFor)).forEach((sampleMidi) => getPlayer(sampleMidi));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [whites, blacks]);

  // One player per sample. At most MAX_PLAYERS exist; the least recently used one is removed first.
  function getPlayer(sampleMidi: number): AudioPlayer | null {
    const existing = players.current.get(sampleMidi);
    if (existing) {
      players.current.delete(sampleMidi);
      players.current.set(sampleMidi, existing); // mark as recently used
      return existing;
    }

    while (players.current.size >= MAX_PLAYERS) {
      const oldest = players.current.keys().next().value as number;
      players.current.get(oldest)?.remove();
      players.current.delete(oldest);
    }

    try {
      const player = createAudioPlayer(getSampleSource(sampleMidi), { downloadFirst: Platform.OS !== 'web' });
      player.shouldCorrectPitch = false;
      players.current.set(sampleMidi, player);
      return player;
    } catch (error) {
      console.warn(`Could not create player for ${midiToName(sampleMidi)} (${players.current.size} players exist)`, error);
      return null;
    }
  }

  function playNote(midi: number) {
    if (!isPlayable(midi)) return;

    const sampleMidi = sampleMidiFor(midi);
    const player = getPlayer(sampleMidi);
    if (!player) return;

    // the same sample serves up to 3 neighbouring keys, so set the pitch for this key right before playing
    player.shouldCorrectPitch = false;
    player.setPlaybackRate(2 ** ((midi - sampleMidi) / 12));
    player.seekTo(0);
    player.play();

    if (isRecording) {
      const recordedNote = { note: midiToName(midi), at: Date.now() - recordingStart.current };
      recordingNotes.current = [...recordingNotes.current, recordedNote];
      setPlayhead(recordedNote.at);
    }
  }

  function changeOctave(delta: number) {
    setOctave((current) => Math.max(MIN_OCTAVE, Math.min(MAX_OCTAVE, current + delta)));
    touchNotes.current = {};
    setPressedNotes([]);
  }

  function stopPlayback() {
    if (playbackTimer.current) {
      clearTimeout(playbackTimer.current);
      playbackTimer.current = null;
    }
    playbackNoteTimers.current.forEach((timer) => clearTimeout(timer));
    playbackNoteTimers.current = [];
    setIsPlaying(false);
  }

  function startRecording() {
    stopPlayback();
    recordingNotes.current = [];
    recordingStart.current = Date.now();
    setSavedNotes([]);
    setRecordingDuration(0);
    setPlayhead(0);
    setIsRecording(true);
  }

  function stopRecording() {
    const notes = recordingNotes.current;
    const duration = notes.length ? Math.max(notes[notes.length - 1].at + 500, 500) : 0;
    const recording = { notes, duration, bpm };

    setIsRecording(false);
    setSavedNotes(notes);
    setRecordingDuration(duration);
    setPlayhead(0);
    AsyncStorage.setItem(recordingStorageKey, JSON.stringify(recording)).catch(() => undefined);
  }

  function changeBpm(nextBpm: number) {
    const normalizedBpm = normalizeBpm(nextBpm);
    if (isPlaying) stopPlayback();
    setBpm(normalizedBpm);
    AsyncStorage.setItem(
      recordingStorageKey,
      JSON.stringify({ notes: savedNotes, duration: recordingDuration, bpm: normalizedBpm }),
    ).catch(() => undefined);
  }

  function playRecording() {
    if (!savedNotes.length || !recordingDuration) return;

    stopPlayback();
    setIsPlaying(true);
    const startAt = playhead >= recordingDuration ? 0 : playhead;
    const startedAt = Date.now() - startAt;
    const scale = playbackScale(bpm);

    savedNotes.forEach(({ note, at }) => {
      if (at < startAt) return;
      playbackNoteTimers.current.push(setTimeout(() => playNote(noteNameToMidi(note)), (at - startAt) * scale));
    });

    function updatePlayhead() {
      const elapsed = (Date.now() - startedAt) / scale;
      if (elapsed >= recordingDuration) {
        setPlayhead(recordingDuration);
        setIsPlaying(false);
        return;
      }
      setPlayhead(elapsed);
      playbackTimer.current = setTimeout(updatePlayhead, 50);
    }

    updatePlayhead();
  }

  function seekRecording(event: GestureResponderEvent) {
    if (!recordingDuration || !timelineWidth) return;
    stopPlayback();
    const nextPosition = Math.max(0, Math.min(1, event.nativeEvent.locationX / timelineWidth)) * recordingDuration;
    setPlayhead(nextPosition);
  }

  function noteAt(x: number, y: number): number | null {
    if (x < 0 || x >= pianoWidth || y < 0 || y > PIANO_HEIGHT) return null;

    let midi: number | undefined;
    if (y <= BLACK_HEIGHT) {
      midi = blacks.find((key) => {
        const left = (key.afterWhiteIndex + 1) * keyWidth - blackWidth / 2;
        return x >= left && x <= left + blackWidth;
      })?.midi;
    }
    midi ??= whites[Math.floor(x / keyWidth)];

    return midi !== undefined && isPlayable(midi) ? midi : null;
  }

  function syncPressed() {
    setPressedNotes(Object.values(touchNotes.current));
  }

  function handleTouchStart(event: GestureResponderEvent) {
    for (const touch of event.nativeEvent.changedTouches) {
      const midi = noteAt(touch.locationX, touch.locationY);
      if (midi !== null) {
        touchNotes.current[touch.identifier] = midi;
        playNote(midi);
      }
    }
    syncPressed();
  }

  function handleTouchMove(event: GestureResponderEvent) {
    for (const touch of event.nativeEvent.changedTouches) {
      const midi = noteAt(touch.locationX, touch.locationY);
      const previous = touchNotes.current[touch.identifier];
      if (midi === (previous ?? null)) continue;

      if (midi !== null) {
        touchNotes.current[touch.identifier] = midi;
        playNote(midi); // sliding a finger onto a new key plays it
      } else {
        delete touchNotes.current[touch.identifier];
      }
    }
    syncPressed();
  }

  function handleTouchEnd(event: GestureResponderEvent) {
    for (const touch of event.nativeEvent.changedTouches) {
      delete touchNotes.current[touch.identifier];
    }
    syncPressed();
  }

  return (
    <View style={{ flex: 1 }}>
      <PlayNavigation
        projectName={projectName}
        isRecording={isRecording}
        isPlaying={isPlaying}
        hasRecording={savedNotes.length > 0}
        onToggleRecording={isRecording ? stopRecording : startRecording}
        onTogglePlayback={isPlaying ? stopPlayback : playRecording}
        bpm={bpm}
        onBpmChange={changeBpm}
      />
      <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.content}>
        <View
          style={[styles.timeline, { width: pianoWidth }]}
          onLayout={(event) => setTimelineWidth(event.nativeEvent.layout.width)}
          onTouchStart={seekRecording}
          onTouchMove={seekRecording}>
          <View style={[styles.timelineProgress, { width: `${recordingDuration ? (playhead / recordingDuration) * 100 : 0}%` }]} />
          <View style={[styles.playhead, { left: `${recordingDuration ? (playhead / recordingDuration) * 100 : 0}%` }]} />
        </View>
        <View style={styles.octaveBar}>
          <Pressable
            accessibilityLabel="Octave down"
            disabled={octave <= MIN_OCTAVE}
            onPress={() => changeOctave(-1)}
            style={[styles.octaveButton, octave <= MIN_OCTAVE && styles.octaveButtonDisabled]}>
            <Text style={styles.octaveButtonText}>◀ Octave</Text>
          </Pressable>
          <Text style={styles.octaveLabel}>
            {midiToName(whites[0])} – {midiToName(whites[whites.length - 1])}
          </Text>
          <Pressable
            accessibilityLabel="Octave up"
            disabled={octave >= MAX_OCTAVE}
            onPress={() => changeOctave(1)}
            style={[styles.octaveButton, octave >= MAX_OCTAVE && styles.octaveButtonDisabled]}>
            <Text style={styles.octaveButtonText}>Octave ▶</Text>
          </Pressable>
        </View>
        <View
          style={[styles.piano, { width: pianoWidth }]}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchEnd}>
          <View style={styles.whiteKeys} pointerEvents="none">
            {whites.map((midi) => (
              <PianoKey
                key={midi}
                isBlack={false}
                note={midiToName(midi)}
                pressed={pressedNotes.includes(midi)}
                style={{ width: keyWidth, opacity: isPlayable(midi) ? 1 : 0.3 }}
              />
            ))}
          </View>
          <View style={styles.blackKeys} pointerEvents="none">
            {blacks.map((key) => (
              <PianoKey
                key={key.midi}
                isBlack
                note={midiToName(key.midi)}
                pressed={pressedNotes.includes(key.midi)}
                style={{
                  position: 'absolute',
                  left: (key.afterWhiteIndex + 1) * keyWidth - blackWidth / 2,
                  width: blackWidth,
                  opacity: isPlayable(key.midi) ? 1 : 0.3,
                }}
              />
            ))}
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = {
  content: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    paddingTop: 48,
    paddingBottom: 72,
    paddingHorizontal: 16,
  },
  title: {
    marginBottom: 24,
    fontSize: 20,
    fontWeight: '600' as const,
  },
  timeline: {
    width: '100%' as const,
    height: 24,
    justifyContent: 'center' as const,
    marginTop: 16,
    marginBottom: 20,
    backgroundColor: '#d1d5db',
    borderRadius: 4,
    overflow: 'hidden' as const,
  },
  timelineProgress: {
    position: 'absolute' as const,
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: '#93c5fd',
  },
  playhead: {
    position: 'absolute' as const,
    top: 0,
    bottom: 0,
    width: 3,
    marginLeft: -1.5,
    backgroundColor: '#1d4ed8',
  },
  octaveBar: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 16,
    marginBottom: 20,
  },
  octaveButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: '#dbeafe',
  },
  octaveButtonDisabled: {
    opacity: 0.4,
  },
  octaveButtonText: {
    color: '#1d4ed8',
    fontWeight: '600' as const,
  },
  octaveLabel: {
    minWidth: 90,
    textAlign: 'center' as const,
    fontWeight: '600' as const,
  },
  piano: {
    position: 'relative' as const,
    height: PIANO_HEIGHT,
  },
  whiteKeys: {
    flexDirection: 'row' as const,
  },
  blackKeys: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    height: BLACK_HEIGHT,
  },
};