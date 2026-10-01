import { PianoKey } from '@/components/piano-key';
import { TopNavigation } from '@/components/top-navigation';
import { AudioPlayer, createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { useEffect, useRef, useState } from 'react';
import { GestureResponderEvent, Text, useWindowDimensions, View } from 'react-native';
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
const allNotes = [...whiteNotes, ...blackNotes.map((key) => key.note)];

const BLACK_HEIGHT = 140;
const PIANO_HEIGHT = 220;
const POOL_SIZE = 1; // players per key. If all keys work, you can try 2 for overlapping repeats

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
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const players = useRef<Record<string, AudioPlayer[]>>({});
  const nextPlayer = useRef<Record<string, number>>({});
  const touchNotes = useRef<Record<string, string>>({}); // finger id -> note it is on
  const [pressedNotes, setPressedNotes] = useState<string[]>([]);

  const availableWidth = Math.max(1, windowWidth - insets.left - insets.right - 16);
  const keyWidth = Math.floor(availableWidth / whiteNotes.length);
  const blackWidth = keyWidth * (2 / 3);
  const pianoWidth = whiteNotes.length * keyWidth;

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true }).catch(() => undefined);

    // create every player once, up front, so the first press of a key is not silent
    const pools: Record<string, AudioPlayer[]> = {};
    for (const note of allNotes) {
      const { soundUrl, playbackRate } = noteSounds[note];
      try {
        pools[note] = Array.from({ length: POOL_SIZE }, () => {
          const player = createAudioPlayer(soundUrl, { downloadFirst: true });
          player.shouldCorrectPitch = false;
          player.setPlaybackRate(playbackRate);
          return player;
        });
      } catch (error) {
        console.warn(`Could not create player for ${note}`, error);
      }
    }
    players.current = pools;

    return () => {
      Object.values(pools).forEach((pool) => pool.forEach((player) => player.remove()));
      players.current = {};
    };
  }, []);

  function playNote(note: string) {
    const pool = players.current[note];
    if (!pool) return;

    const index = nextPlayer.current[note] ?? 0;
    nextPlayer.current[note] = (index + 1) % POOL_SIZE;

    const player = pool[index];
    player.seekTo(0);
    player.play();
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
      <TopNavigation />
      <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.content}>
        <Text style={styles.title}>Play Page</Text>
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
  },
  title: {
    marginBottom: 24,
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