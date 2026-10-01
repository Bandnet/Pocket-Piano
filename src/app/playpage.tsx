import { PianoKey } from '@/components/piano-key';
import { TopNavigation } from '@/components/top-navigation';
import { AudioPlayer, createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { useEffect, useRef, useState } from 'react';
import { GestureResponderEvent, Text, View } from 'react-native';

const noteSounds: Record<string, { soundUrl: string; playbackRate: number }> = {};
const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const sampledNotes = ['C4', 'D#4', 'F#4', 'A4', 'C5'];

for (const octave of [4, 5]) {
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

const whiteNotes = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'];
const blackNotes = [
  { note: 'C#4', left: 48 },
  { note: 'D#4', left: 120 },
  { note: 'F#4', left: 264 },
  { note: 'G#4', left: 336 },
  { note: 'A#4', left: 408 },
];

const WHITE_WIDTH = 72;
const BLACK_WIDTH = 48;
const BLACK_HEIGHT = 140;
const PIANO_WIDTH = 576;
const PIANO_HEIGHT = 220;
const POOL_SIZE = 2;

const shownNotes = [...whiteNotes, ...blackNotes.map((key) => key.note)];

// Which key is under this position? (black keys sit on top, so check them first)
function noteAt(x: number, y: number): string | null {
  if (x < 0 || x >= PIANO_WIDTH || y < 0 || y > PIANO_HEIGHT) return null;

  if (y <= BLACK_HEIGHT) {
    const black = blackNotes.find((key) => x >= key.left && x <= key.left + BLACK_WIDTH);
    if (black) return black.note;
  }

  return whiteNotes[Math.floor(x / WHITE_WIDTH)] ?? null;
}

export default function PlayPage() {
  const players = useRef<Record<string, AudioPlayer[]>>({});
  const nextPlayer = useRef<Record<string, number>>({});
  const touchNotes = useRef<Record<string, string>>({}); // finger id -> note it is on
  const [pressedNotes, setPressedNotes] = useState<string[]>([]);

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true }).catch(() => undefined);

    const pools: Record<string, AudioPlayer[]> = {};
    for (const note of shownNotes) {
      const { soundUrl, playbackRate } = noteSounds[note];
      pools[note] = Array.from({ length: POOL_SIZE }, () => {
        const player = createAudioPlayer(soundUrl);
        player.shouldCorrectPitch = false;
        player.setPlaybackRate(playbackRate);
        return player;
      });
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
      const note = noteAt(touch.locationX, touch.locationY);
      if (note) {
        touchNotes.current[touch.identifier] = note;
        playNote(note);
      }
    }
    syncPressed();
  }

  function handleTouchMove(event: GestureResponderEvent) {
    for (const touch of event.nativeEvent.changedTouches) {
      const note = noteAt(touch.locationX, touch.locationY);
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
      <View style={styles.content}>
        <Text>Play Page</Text>
        <View
          style={styles.piano}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchEnd}>
          <View style={styles.whiteKeys} pointerEvents="none">
            {whiteNotes.map((note) => (
              <PianoKey key={note} isBlack={false} note={note} pressed={pressedNotes.includes(note)} />
            ))}
          </View>
          <View style={styles.blackKeys} pointerEvents="none">
            {blackNotes.map((key) => (
              <PianoKey
                key={key.note}
                isBlack
                note={key.note}
                pressed={pressedNotes.includes(key.note)}
                style={{ position: 'absolute', left: key.left }}
              />
            ))}
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = {
  content: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  piano: {
    position: 'relative' as const,
    marginTop: 24,
    width: PIANO_WIDTH,
    height: PIANO_HEIGHT,
  },
  whiteKeys: {
    flexDirection: 'row' as const,
  },
  blackKeys: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    width: PIANO_WIDTH,
    height: BLACK_HEIGHT,
  },
};