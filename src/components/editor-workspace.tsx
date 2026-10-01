import { PlayNavigation } from '@/components/play-navigation';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AudioPlayer, createAudioPlayer } from 'expo-audio';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';

const RECORDING_STORAGE_PREFIX = '@pocket-piano/recording/';
const ROW_HEIGHT = 22; // row height at 100% zoom
const KEYBOARD_WIDTH = 76;
const PX_PER_SECOND = 120; // timeline scale at 100% zoom
const DEFAULT_NOTE_MS = 250; // recordings only store the start time, so notes get this length
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 1.25;
const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const sampledNotes = ['C4', 'D#4', 'F#4', 'A4', 'C5', 'D#5', 'F#5', 'A5', 'C6'];
const pianoNotes = [
  'C4', 'C#4', 'D4', 'D#4', 'E4', 'F4', 'F#4', 'G4', 'G#4', 'A4', 'A#4', 'B4',
  'C5', 'C#5', 'D5', 'D#5', 'E5', 'F5', 'F#5', 'G5', 'G#5', 'A5', 'A#5', 'B5', 'C6',
].reverse();
const blackNoteNames = new Set(['C#', 'D#', 'F#', 'G#', 'A#']);

type RecordedNote = {
  note: string;
  at: number;
};

type StoredRecording = {
  notes: RecordedNote[];
  duration: number;
};

type EditorWorkspaceProps = {
  projectName: string;
};

function clampZoom(value: number) {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));
}

function getSound(note: string) {
  const noteName = note.slice(0, -1);
  const octave = Number(note.slice(-1));
  const midiNote = (octave + 1) * 12 + noteNames.indexOf(noteName);
  const sampledNote = sampledNotes.reduce((closest, candidate) => {
    const candidateName = candidate.slice(0, -1);
    const candidateOctave = Number(candidate.slice(-1));
    const candidateMidi = (candidateOctave + 1) * 12 + noteNames.indexOf(candidateName);
    const closestName = closest.slice(0, -1);
    const closestOctave = Number(closest.slice(-1));
    const closestMidi = (closestOctave + 1) * 12 + noteNames.indexOf(closestName);
    return Math.abs(candidateMidi - midiNote) < Math.abs(closestMidi - midiNote) ? candidate : closest;
  }, sampledNotes[0]);
  const sampleName = sampledNote.slice(0, -1);
  const sampleOctave = sampledNote.slice(-1);
  const sampleMidi = (Number(sampleOctave) + 1) * 12 + noteNames.indexOf(sampleName);

  return {
    soundUrl: `https://tonejs.github.io/audio/salamander/${sampleName.replace('#', 's')}${sampleOctave}.mp3`,
    playbackRate: 2 ** ((midiNote - sampleMidi) / 12),
  };
}

export function EditorWorkspace({ projectName }: EditorWorkspaceProps) {
  const { width: windowWidth } = useWindowDimensions();
  const [recording, setRecording] = useState<StoredRecording | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPinching, setIsPinching] = useState(false);
  const [selectedNoteIndex, setSelectedNoteIndex] = useState<number | null>(null);
  const players = useRef<Record<string, AudioPlayer>>({});
  const playbackTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const playheadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinchStart = useRef<{ distance: number; zoom: number } | null>(null);

  const rowHeight = Math.max(2, ROW_HEIGHT * zoom);
  const pxPerMs = (PX_PER_SECOND * zoom) / 1000;
  const duration = recording?.duration ?? 0;
  const minTimelineWidth = Math.max(1, windowWidth - KEYBOARD_WIDTH - 34);
  const timelineWidth = Math.max(minTimelineWidth, (duration + DEFAULT_NOTE_MS) * pxPerMs);
  const timelineHeight = pianoNotes.length * rowHeight;

  // Length of each note in ms: default length, shortened if the same pitch is played again sooner
  const noteLengths = useMemo(() => {
    if (!recording) return [];
    return recording.notes.map((item) => {
      let nextAt = Infinity;
      for (const other of recording.notes) {
        if (other.note === item.note && other.at > item.at && other.at < nextAt) nextAt = other.at;
      }
      return Math.min(DEFAULT_NOTE_MS, nextAt - item.at);
    });
  }, [recording]);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(`${RECORDING_STORAGE_PREFIX}${encodeURIComponent(projectName)}`)
      .then((stored) => {
        if (!cancelled && stored) setRecording(JSON.parse(stored) as StoredRecording);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [projectName]);

  useEffect(() => () => {
    if (playheadTimer.current) clearTimeout(playheadTimer.current);
    playbackTimers.current.forEach((timer) => clearTimeout(timer));
    Object.values(players.current).forEach((player) => player.remove());
  }, []);

  function ensurePlayer(note: string) {
    if (!players.current[note]) {
      const { soundUrl, playbackRate } = getSound(note);
      const player = createAudioPlayer(soundUrl, { downloadFirst: Platform.OS !== 'web' });
      player.shouldCorrectPitch = false;
      player.setPlaybackRate(playbackRate);
      players.current[note] = player;
    }
    return players.current[note];
  }

  function stopPlayback() {
    if (playheadTimer.current) clearTimeout(playheadTimer.current);
    playbackTimers.current.forEach((timer) => clearTimeout(timer));
    playbackTimers.current = [];
    Object.values(players.current).forEach((player) => player.pause());
    setIsPlaying(false);
  }

  function playRecording() {
    if (!recording?.notes.length || !duration) return;
    stopPlayback();
    const startAt = playhead >= duration ? 0 : playhead;
    const startedAt = Date.now() - startAt;
    recording.notes.forEach(({ note, at }) => {
      ensurePlayer(note);
      if (at >= startAt) {
        playbackTimers.current.push(setTimeout(() => {
          const player = ensurePlayer(note);
          player.seekTo(0);
          player.play();
        }, at - startAt));
      }
    });
    setIsPlaying(true);

    function updatePlayhead() {
      const elapsed = Date.now() - startedAt;
      if (elapsed >= duration) {
        setPlayhead(duration);
        setIsPlaying(false);
        return;
      }
      setPlayhead(elapsed);
      playheadTimer.current = setTimeout(updatePlayhead, 40);
    }

    updatePlayhead();
  }

  function distanceBetweenTouches(touches: readonly { pageX: number; pageY: number }[]) {
    if (touches.length < 2) return 0;
    const [first, second] = touches;
    return Math.hypot(second.pageX - first.pageX, second.pageY - first.pageY);
  }

  function handleTouchStart(event: any) {
    const distance = distanceBetweenTouches(event.nativeEvent.touches);
    if (distance > 0) {
      pinchStart.current = { distance, zoom };
      setIsPinching(true);
    }
  }

  function handleTouchMove(event: any) {
    if (!pinchStart.current) return;
    const distance = distanceBetweenTouches(event.nativeEvent.touches);
    if (!distance) return;
    setZoom(clampZoom(pinchStart.current.zoom * (distance / pinchStart.current.distance)));
  }

  function handleTouchEnd(event: any) {
    // stay in pinch mode while two fingers are still down
    if (event?.nativeEvent?.touches?.length >= 2) return;
    pinchStart.current = null;
    setIsPinching(false);
  }

  // Tap on an empty part of the timeline: move the playhead there
  function seek(event: any) {
    if (!duration || pinchStart.current) return;
    stopPlayback();
    const position = event.nativeEvent.locationX / pxPerMs;
    setPlayhead(Math.max(0, Math.min(duration, position)));
  }

  // Tap on a note: this is where the editing functions will go later
  function handleNotePress(index: number) {
    setSelectedNoteIndex((current) => (current === index ? null : index));
  }

  return (
    <View style={styles.root}>
      <PlayNavigation
        projectName={projectName}
        isRecording={false}
        isPlaying={isPlaying}
        hasRecording={Boolean(recording?.notes.length)}
        onTogglePlayback={isPlaying ? stopPlayback : playRecording}
        isEditor
        showRecording={false}
      />
      <View style={styles.workspace}>
        <View style={styles.toolbar}>
          <Text style={styles.toolbarText}>Timeline</Text>
          <View style={styles.zoomControls}>
            <Pressable accessibilityLabel="Zoom out" onPress={() => setZoom((current) => clampZoom(current / ZOOM_STEP))} style={styles.zoomButton}>
              <Text style={styles.zoomText}>-</Text>
            </Pressable>
            <Text style={styles.zoomLabel}>{Math.round(zoom * 100)}%</Text>
            <Pressable accessibilityLabel="Zoom in" onPress={() => setZoom((current) => clampZoom(current * ZOOM_STEP))} style={styles.zoomButton}>
              <Text style={styles.zoomText}>+</Text>
            </Pressable>
          </View>
        </View>
        <View
          style={styles.editorViewport}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchEnd}>
          {/* vertical scroll: piano column and timeline scroll up/down together */}
          <ScrollView scrollEnabled={!isPinching} nestedScrollEnabled showsVerticalScrollIndicator>
            <View style={styles.editorRow}>
              <View style={styles.keyboardColumn}>
                {pianoNotes.map((note) => {
                  const isBlack = blackNoteNames.has(note.slice(0, -1));
                  return (
                    <View key={note} style={[styles.keyRow, { height: rowHeight }, isBlack ? styles.blackKey : styles.whiteKey]}>
                      {rowHeight >= 12 && <Text style={isBlack ? styles.blackKeyText : styles.whiteKeyText}>{note}</Text>}
                    </View>
                  );
                })}
              </View>
              <View style={styles.timelineViewport}>
                {/* horizontal scroll */}
                <ScrollView
                  horizontal
                  scrollEnabled={!isPinching}
                  nestedScrollEnabled
                  showsHorizontalScrollIndicator
                  contentContainerStyle={{ width: timelineWidth }}>
                  <View style={{ width: timelineWidth, height: timelineHeight }}>
                    {/* background: tap to move the playhead */}
                    <Pressable accessibilityLabel="Timeline" onPress={seek} style={styles.seekArea} />
                    {pianoNotes.map((note, index) => (
                      <View
                        key={note}
                        pointerEvents="none"
                        style={[
                          styles.timelineRow,
                          { top: index * rowHeight, height: rowHeight },
                          blackNoteNames.has(note.slice(0, -1)) && styles.timelineRowBlack,
                        ]}
                      />
                    ))}
                    {recording?.notes.map((item, index) => {
                      const row = pianoNotes.indexOf(item.note);
                      if (row < 0) return null;
                      const width = Math.max(4, noteLengths[index] * pxPerMs);
                      return (
                        <Pressable
                          key={`${item.note}-${item.at}-${index}`}
                          accessibilityRole="button"
                          accessibilityLabel={`Note ${item.note}`}
                          onPress={() => handleNotePress(index)}
                          style={[
                            styles.noteBlock,
                            selectedNoteIndex === index && styles.noteBlockSelected,
                            { left: item.at * pxPerMs, top: row * rowHeight, width, height: rowHeight },
                          ]}>
                          {rowHeight >= 12 && width >= 28 && (
                            <Text numberOfLines={1} style={styles.noteText}>{item.note}</Text>
                          )}
                        </Pressable>
                      );
                    })}
                    <View pointerEvents="none" style={[styles.playhead, { left: playhead * pxPerMs }]} />
                  </View>
                </ScrollView>
              </View>
            </View>
          </ScrollView>
        </View>
      </View>
    </View>
  );
}

const styles = {
  root: {
    flex: 1,
  },
  workspace: {
    flex: 1,
    width: '100%' as const,
    paddingHorizontal: 16,
  },
  toolbar: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    minHeight: 44,
    marginBottom: 8,
  },
  toolbarText: {
    fontSize: 18,
    fontWeight: '600' as const,
    color: '#111827',
  },
  zoomControls: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  },
  zoomButton: {
    width: 30,
    height: 30,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderRadius: 4,
    backgroundColor: '#dbeafe',
  },
  zoomText: {
    color: '#1d4ed8',
    fontSize: 20,
    lineHeight: 22,
  },
  zoomLabel: {
    minWidth: 42,
    textAlign: 'center' as const,
    color: '#4b5563',
  },
  editorViewport: {
    flex: 1,
    overflow: 'hidden' as const,
    borderWidth: 1,
    borderColor: '#9ca3af',
    backgroundColor: '#f3f4f6',
  },
  editorRow: {
    flexDirection: 'row' as const,
  },
  keyboardColumn: {
    width: KEYBOARD_WIDTH,
    zIndex: 2,
  },
  keyRow: {
    justifyContent: 'center' as const,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#d1d5db',
  },
  whiteKey: {
    width: KEYBOARD_WIDTH,
    backgroundColor: '#ffffff',
  },
  blackKey: {
    width: KEYBOARD_WIDTH - 20,
    marginLeft: 20,
    borderRadius: 3,
    backgroundColor: '#1f2937',
  },
  whiteKeyText: {
    color: '#111827',
    fontSize: 10,
  },
  blackKeyText: {
    color: '#ffffff',
    fontSize: 10,
  },
  timelineViewport: {
    flex: 1,
    overflow: 'hidden' as const,
  },
  seekArea: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  timelineRow: {
    position: 'absolute' as const,
    left: 0,
    right: 0,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  timelineRowBlack: {
    backgroundColor: '#e5e7eb',
  },
  noteBlock: {
    position: 'absolute' as const,
    justifyContent: 'center' as const,
    paddingHorizontal: 4,
    borderWidth: 1,
    borderColor: '#1e40af',
    backgroundColor: '#3b82f6',
    overflow: 'hidden' as const,
  },
  noteBlockSelected: {
    backgroundColor: '#1e3a8a',
    borderColor: '#fbbf24',
  },
  noteText: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: '600' as const,
  },
  playhead: {
    position: 'absolute' as const,
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: '#dc2626',
  },
};