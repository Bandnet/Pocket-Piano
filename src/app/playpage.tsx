import { PianoKey } from '@/components/piano-key';
import { PlayNavigation } from '@/components/play-navigation';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AudioPlayer, createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { GestureResponderEvent, Platform, useWindowDimensions, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

const noteSounds: Record<string, { soundUrl: string; playbackRate: number }> = {};
const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
// one real sample every 3 semitones, so a key is never more than 1 semitone away from one
const sampledNotes = ['C4', 'D#4', 'F#4', 'A4', 'C5', 'D#5', 'F#5', 'A5', 'C6'];

for (const octave of [4, 5, 6]) {
  for (const [noteIndex, noteName] of noteNames.entries()) {
    const note = `${noteName}${octave}`;
    const midiNote = (octave + 1) * 12 + noteIndex;
    const sampledNote = sampledNotes.reduce((closest, candidate) => {
      const [candidateName, candidateOctave] = [candidate.slice(0, -1), Number(candidate.slice(-1))];
      const candidateIndex = (candidateOctave + 1) * 12 + noteNames.indexOf(candidateName);
      const closestIndex = (Number(closest.slice(-1)) + 1) * 12 + noteNames.indexOf(closest.slice(0, -1));
      return Math.abs(candidateIndex - midiNote) < Math.abs(closestIndex - midiNote) ? candidate : closest;
    }, sampledNotes[0]);
    const [sampleName, sampleOctave] = [sampledNote.slice(0, -1), Number(sampledNote.slice(-1))];
    const sampleIndex = (sampleOctave + 1) * 12 + noteNames.indexOf(sampleName);

    noteSounds[note] = {
      soundUrl: `https://tonejs.github.io/audio/salamander/${sampleName.replace('#', 's')}${sampleOctave}.mp3`,
      playbackRate: 2 ** ((midiNote - sampleIndex) / 12),
    };
  }
}

const whiteNotes = [
  'C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4',
  'C5', 'D5', 'E5', 'F5', 'G5', 'A5', 'B5',
  'C6',
];
const blackNotes = [
  { note: 'C#4', afterWhiteIndex: 0 },
  { note: 'D#4', afterWhiteIndex: 1 },
  { note: 'F#4', afterWhiteIndex: 3 },
  { note: 'G#4', afterWhiteIndex: 4 },
  { note: 'A#4', afterWhiteIndex: 5 },
  { note: 'C#5', afterWhiteIndex: 7 },
  { note: 'D#5', afterWhiteIndex: 8 },
  { note: 'F#5', afterWhiteIndex: 10 },
  { note: 'G#5', afterWhiteIndex: 11 },
  { note: 'A#5', afterWhiteIndex: 12 },
];
const BLACK_HEIGHT = 140;
const PIANO_HEIGHT = 220;
const POOL_SIZE = 1; // players per key. If all keys work, you can try 2 for overlapping repeats
const RECORDING_STORAGE_PREFIX = '@pocket-piano/recording/';

type RecordedNote = {
  note: string;
  at: number;
};

type StoredRecording = {
  notes: RecordedNote[];
  duration: number;
};

function noteAt(x: number, y: number, keyWidth: number, blackWidth: number): string | null {
  const pianoWidth = whiteNotes.length * keyWidth;
  if (x < 0 || x >= pianoWidth || y < 0 || y > PIANO_HEIGHT) return null;

  if (y <= BLACK_HEIGHT) {
    const black = blackNotes.find((key) => {
      const left = (key.afterWhiteIndex + 1) * keyWidth - blackWidth / 2;
      return x >= left && x <= left + blackWidth;
    });
    if (black) return black.note;
  }

  return whiteNotes[Math.floor(x / keyWidth)] ?? null;
}

export default function PlayPage() {
  const { project } = useLocalSearchParams<{ project?: string }>();
  const projectName = Array.isArray(project) ? project[0] : project || 'default';
  const recordingStorageKey = `${RECORDING_STORAGE_PREFIX}${encodeURIComponent(projectName)}`;
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const players = useRef<Record<string, AudioPlayer[]>>({});
  const nextPlayer = useRef<Record<string, number>>({});
  const touchNotes = useRef<Record<string, string>>({}); // finger id -> note it is on
  const recordingStart = useRef(0);
  const recordingNotes = useRef<RecordedNote[]>([]);
  const playbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playbackNoteTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [pressedNotes, setPressedNotes] = useState<string[]>([]);
  const [savedNotes, setSavedNotes] = useState<RecordedNote[]>([]);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [playhead, setPlayhead] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [timelineWidth, setTimelineWidth] = useState(0);

  const availableWidth = Math.max(1, windowWidth - insets.left - insets.right - 16);
  const keyWidth = Math.floor(availableWidth / whiteNotes.length);
  const blackWidth = keyWidth * (2 / 3);
  const pianoWidth = whiteNotes.length * keyWidth;

  useEffect(() => {
    let cancelled = false;

    AsyncStorage.getItem(recordingStorageKey)
      .then((stored) => {
        if (cancelled || !stored) return;
        const recording = JSON.parse(stored) as StoredRecording;
        setSavedNotes(recording.notes);
        setRecordingDuration(recording.duration);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [recordingStorageKey]);

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true }).catch(() => undefined);

    return () => {
      if (playbackTimer.current) clearTimeout(playbackTimer.current);
      playbackNoteTimers.current.forEach((timer) => clearTimeout(timer));
      Object.values(players.current).forEach((pool) => pool.forEach((player) => player.remove()));
      players.current = {};
    };
  }, []);

  function playNote(note: string) {
    let pool = players.current[note];
    if (!pool) {
      const { soundUrl, playbackRate } = noteSounds[note];
      try {
        pool = Array.from({ length: POOL_SIZE }, () => {
          const player = createAudioPlayer(soundUrl, { downloadFirst: Platform.OS !== 'web' });
          player.shouldCorrectPitch = false;
          player.setPlaybackRate(playbackRate);
          return player;
        });
        players.current[note] = pool;
      } catch (error) {
        console.warn(`Could not create player for ${note}`, error);
        return;
      }
    }

    const index = nextPlayer.current[note] ?? 0;
    nextPlayer.current[note] = (index + 1) % POOL_SIZE;

    const player = pool[index];
    player.seekTo(0);
    player.play();

    if (isRecording) {
      const recordedNote = { note, at: Date.now() - recordingStart.current };
      recordingNotes.current = [...recordingNotes.current, recordedNote];
      setPlayhead(recordedNote.at);
    }
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
    const recording = { notes, duration };

    setIsRecording(false);
    setSavedNotes(notes);
    setRecordingDuration(duration);
    setPlayhead(0);
    AsyncStorage.setItem(recordingStorageKey, JSON.stringify(recording)).catch(() => undefined);
  }

  function playRecording() {
    if (!savedNotes.length || !recordingDuration) return;

    stopPlayback();
    setIsPlaying(true);
    const startAt = playhead >= recordingDuration ? 0 : playhead;
    const startedAt = Date.now() - startAt;

    savedNotes.forEach(({ note, at }) => {
      if (at < startAt) return;
      playbackNoteTimers.current.push(setTimeout(() => playNote(note), at - startAt));
    });

    function updatePlayhead() {
      const elapsed = Date.now() - startedAt;
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

  function syncPressed() {
    setPressedNotes(Object.values(touchNotes.current));
  }

  function handleTouchStart(event: GestureResponderEvent) {
    for (const touch of event.nativeEvent.changedTouches) {
      const note = noteAt(touch.locationX, touch.locationY, keyWidth, blackWidth);
      if (note) {
        touchNotes.current[touch.identifier] = note;
        playNote(note);
      }
    }
    syncPressed();
  }

  function handleTouchMove(event: GestureResponderEvent) {
    for (const touch of event.nativeEvent.changedTouches) {
      const note = noteAt(touch.locationX, touch.locationY, keyWidth, blackWidth);
      const previous = touchNotes.current[touch.identifier];
      if (note === previous) continue;

      if (note) {
        touchNotes.current[touch.identifier] = note;
        playNote(note); // sliding a finger onto a new key plays it
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
        <View
          style={[styles.piano, { width: pianoWidth }]}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchEnd}>
          <View style={styles.whiteKeys} pointerEvents="none">
            {whiteNotes.map((note) => (
              <PianoKey
                key={note}
                isBlack={false}
                note={note}
                pressed={pressedNotes.includes(note)}
                style={{ width: keyWidth }}
              />
            ))}
          </View>
          <View style={styles.blackKeys} pointerEvents="none">
            {blackNotes.map((key) => (
              <PianoKey
                key={key.note}
                isBlack
                note={key.note}
                pressed={pressedNotes.includes(key.note)}
                style={{
                  position: 'absolute',
                  left: (key.afterWhiteIndex + 1) * keyWidth - blackWidth / 2,
                  width: blackWidth,
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