import { PlayNavigation } from '@/components/play-navigation';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AudioPlayer, createAudioPlayer } from 'expo-audio';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, PanResponder, Platform, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';

const RECORDING_STORAGE_PREFIX = '@pocket-piano/recording/';
const ROW_HEIGHT = 22; // row height at 100% zoom
const KEYBOARD_WIDTH = 76;
const PX_PER_SECOND = 120; // timeline scale at 100% zoom
const DEFAULT_NOTE_MS = 250; // recordings only store the start time, so notes get this length
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 1.25;
const SNAP_MS = 50;
const GRID_MS = 250;
const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const sampledNotes = ['C4', 'D#4', 'F#4', 'A4', 'C5', 'D#5', 'F#5', 'A5', 'C6'];
const pianoNotes = [
  'C4', 'C#4', 'D4', 'D#4', 'E4', 'F4', 'F#4', 'G4', 'G#4', 'A4', 'A#4', 'B4',
  'C5', 'C#5', 'D5', 'D#5', 'E5', 'F5', 'F#5', 'G5', 'G#5', 'A5', 'A#5', 'B5', 'C6',
].reverse();
const blackNoteNames = new Set(['C#', 'D#', 'F#', 'G#', 'A#']);

type RecordedNote = {
  id: string;
  note: string;
  at: number;
  duration: number;
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
  const [notes, setNotes] = useState<RecordedNote[]>([]);
  const [playhead, setPlayhead] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPinching, setIsPinching] = useState(false);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [addMenu, setAddMenu] = useState<{ note: string; at: number } | null>(null);
  const players = useRef<Record<string, AudioPlayer>>({});
  const playbackTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const playheadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinchStart = useRef<{ distance: number; zoom: number; centerX: number } | null>(null);
  const zoomAnchor = useRef<{ contentX: number; viewportX: number; baseZoom: number } | null>(null);
  const timelineScrollRef = useRef<ScrollView>(null);
  const scrollOffset = useRef(0);
  const undoStack = useRef<StoredRecording[]>([]);
  const notesRef = useRef<RecordedNote[]>([]);

  const rowHeight = Math.max(2, ROW_HEIGHT * zoom);
  const pxPerMs = (PX_PER_SECOND * zoom) / 1000;
  const duration = recording?.duration ?? 0;
  const minTimelineWidth = Math.max(1, windowWidth - KEYBOARD_WIDTH - 34);
  const timelineWidth = Math.max(minTimelineWidth, (duration + DEFAULT_NOTE_MS) * pxPerMs);
  const timelineHeight = pianoNotes.length * rowHeight;

  // Length of each note in ms: default length, shortened if the same pitch is played again sooner
  const noteLengths = useMemo(() => {
    return notes.map((item) => {
      let nextAt = Infinity;
      for (const other of notes) {
        if (other.note === item.note && other.at > item.at && other.at < nextAt) nextAt = other.at;
      }
      return Math.min(item.duration, nextAt - item.at);
    });
  }, [notes]);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(`${RECORDING_STORAGE_PREFIX}${encodeURIComponent(projectName)}`)
      .then((stored) => {
        if (!cancelled && stored) {
          const storedRecording = JSON.parse(stored) as StoredRecording;
          const loadedNotes = storedRecording.notes.map((note, index) => ({
            id: note.id ?? `${note.note}-${note.at}-${index}`,
            note: note.note,
            at: note.at,
            duration: note.duration ?? 500,
          }));
          const normalizedRecording = { ...storedRecording, notes: loadedNotes };
          notesRef.current = loadedNotes;
          setNotes(loadedNotes);
          setRecording(normalizedRecording);
        }
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

  useEffect(() => {
    const anchor = zoomAnchor.current;
    if (!anchor) return;
    const nextOffset = Math.max(0, anchor.contentX * (zoom / anchor.baseZoom) - anchor.viewportX);
    requestAnimationFrame(() => timelineScrollRef.current?.scrollTo({ x: nextOffset, animated: false }));
  }, [zoom]);

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

  function saveNotes(nextNotes: RecordedNote[], nextDuration = duration, addToUndo = true) {
    const nextRecording = { notes: nextNotes, duration: nextDuration };
    if (addToUndo && notesRef.current.length >= 0) {
      undoStack.current = [...undoStack.current, { notes: notesRef.current, duration }];
    }
    notesRef.current = nextNotes;
    setNotes(nextNotes);
    setRecording(nextRecording);
    AsyncStorage.setItem(
      `${RECORDING_STORAGE_PREFIX}${encodeURIComponent(projectName)}`,
      JSON.stringify(nextRecording),
    ).catch(() => undefined);
  }

  function undoLastEdit() {
    const previous = undoStack.current.pop();
    if (!previous) return;
    saveNotes(previous.notes, previous.duration, false);
    setSelectedNoteId(null);
  }

  function addNoteAt(x: number, y: number) {
    const at = snapTime(Math.max(0, (x / timelineWidth) * Math.max(duration, 1000)));
    const row = Math.max(0, Math.min(pianoNotes.length - 1, Math.floor(y / rowHeight)));
    const nextNote = {
      id: `note-${Date.now()}`,
      note: pianoNotes[row],
      at,
      duration: 500,
    };
    const nextNotes = [...notesRef.current, nextNote].sort((first, second) => first.at - second.at);
    saveNotes(nextNotes, Math.max(duration, at + nextNote.duration));
    setSelectedNoteId(nextNote.id);
  }

  function snapTime(value: number) {
    return Math.round(value / SNAP_MS) * SNAP_MS;
  }

  function addNoteFromMenu() {
    if (!addMenu) return;
    const nextNote = {
      id: `note-${Date.now()}`,
      note: addMenu.note,
      at: addMenu.at,
      duration: DEFAULT_NOTE_MS,
    };
    const nextNotes = [...notesRef.current, nextNote].sort((first, second) => first.at - second.at);
    saveNotes(nextNotes, Math.max(duration, nextNote.at + nextNote.duration));
    setSelectedNoteId(nextNote.id);
    setAddMenu(null);
  }

  function updateNote(noteId: string, changes: Partial<RecordedNote>) {
    const nextNotes = notesRef.current.map((note) => note.id === noteId ? { ...note, ...changes } : note);
    notesRef.current = nextNotes;
    setNotes(nextNotes);
  }

  function finishNoteEdit() {
    saveNotes(notesRef.current, Math.max(duration, ...notesRef.current.map((note) => note.at + note.duration)));
  }

  function deleteSelectedNote() {
    if (!selectedNoteId) return;
    saveNotes(notesRef.current.filter((note) => note.id !== selectedNoteId));
    setSelectedNoteId(null);
  }

  function playRecording() {
    if (!notes.length || !duration) return;
    stopPlayback();
    const startAt = playhead >= duration ? 0 : playhead;
    const startedAt = Date.now() - startAt;
    notes.forEach(({ note, at }) => {
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
      const centerX = event.nativeEvent.touches.reduce((total: number, touch: any) => total + (touch.locationX ?? 0), 0) / event.nativeEvent.touches.length - KEYBOARD_WIDTH;
      pinchStart.current = { distance, zoom, centerX };
      setIsPinching(true);
    }
  }

  function handleTouchMove(event: any) {
    if (!pinchStart.current) return;
    const distance = distanceBetweenTouches(event.nativeEvent.touches);
    if (!distance) return;
    const nextZoom = clampZoom(pinchStart.current.zoom * (distance / pinchStart.current.distance));
    zoomAnchor.current = {
      contentX: scrollOffset.current + pinchStart.current.centerX,
      viewportX: pinchStart.current.centerX,
      baseZoom: pinchStart.current.zoom,
    };
    setZoom(nextZoom);
  }

  function handleTouchEnd(event: any) {
    // stay in pinch mode while two fingers are still down
    if (event?.nativeEvent?.touches?.length >= 2) return;
    pinchStart.current = null;
    setIsPinching(false);
  }

  // Tap on an empty part of the timeline: move the playhead there
  function seek(event: any) {
    if (pinchStart.current) return;
    stopPlayback();
    const position = (event.nativeEvent.locationX + scrollOffset.current) / pxPerMs;
    setPlayhead(Math.max(0, Math.min(duration, position)));
  }

  function createMoveResponder(note: RecordedNote) {
    let startAt = note.at;
    return PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dx) > 3 || Math.abs(gesture.dy) > 3,
      onPanResponderGrant: () => {
        setSelectedNoteId(note.id);
        startAt = note.at;
      },
      onPanResponderMove: (_event, gesture) => {
        updateNote(note.id, { at: snapTime(Math.max(0, startAt + gesture.dx / pxPerMs)) });
      },
      onPanResponderRelease: (_event, gesture) => {
        if (Math.abs(gesture.dx) < 5 && Math.abs(gesture.dy) < 5) {
          setSelectedNoteId((current) => current === note.id ? null : note.id);
        } else {
          finishNoteEdit();
        }
      },
      onPanResponderTerminate: finishNoteEdit,
    });
  }

  function createResizeResponder(note: RecordedNote) {
    let startDuration = note.duration;
    return PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dx) > 3 || Math.abs(gesture.dy) > 3,
      onPanResponderGrant: () => {
        setSelectedNoteId(note.id);
        startDuration = note.duration;
      },
      onPanResponderMove: (_event, gesture) => {
        updateNote(note.id, { duration: snapTime(Math.max(SNAP_MS, startDuration + gesture.dx / pxPerMs)) });
      },
      onPanResponderRelease: finishNoteEdit,
      onPanResponderTerminate: finishNoteEdit,
    });
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
          <View style={styles.toolbarActions}>
            <Pressable disabled={!selectedNoteId} onPress={deleteSelectedNote} style={[styles.editButton, !selectedNoteId && styles.disabled]}>
              <Text style={styles.editButtonText}>Delete</Text>
            </Pressable>
            <Pressable disabled={!undoStack.current.length} onPress={undoLastEdit} style={[styles.editButton, !undoStack.current.length && styles.disabled]}>
              <Text style={styles.editButtonText}>Undo</Text>
            </Pressable>
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
                    ref={timelineScrollRef}
                  horizontal
                  scrollEnabled={!isPinching}
                  nestedScrollEnabled
                  onScroll={(event) => { scrollOffset.current = event.nativeEvent.contentOffset.x; }}
                  scrollEventThrottle={16}
                  showsHorizontalScrollIndicator
                  contentContainerStyle={{ width: timelineWidth }}>
                  <View style={{ width: timelineWidth, height: timelineHeight }}>
                    {/* background: tap to move the playhead */}
                    <Pressable accessibilityLabel="Timeline" onPress={seek} style={styles.seekArea} />
                    {pianoNotes.map((note, index) => (
                      <Pressable
                        key={note}
                        delayLongPress={350}
                        onPress={seek}
                        onLongPress={(event) => setAddMenu({ note, at: snapTime((event.nativeEvent.locationX + scrollOffset.current) / pxPerMs) })}
                        style={[
                          styles.timelineRow,
                          { top: index * rowHeight, height: rowHeight },
                          blackNoteNames.has(note.slice(0, -1)) && styles.timelineRowBlack,
                        ]}
                      />
                    ))}
                    {Array.from({ length: Math.floor(Math.max(duration, 1000) / GRID_MS) + 1 }, (_, index) => (
                      <View key={`grid-${index}`} pointerEvents="none" style={[styles.gridLine, { left: index * GRID_MS * pxPerMs }]} />
                    ))}
                    {notes.map((item, index) => {
                      const row = pianoNotes.indexOf(item.note);
                      if (row < 0) return null;
                      const width = Math.max(4, noteLengths[index] * pxPerMs);
                      const moveResponder = createMoveResponder(item);
                      const resizeResponder = createResizeResponder(item);
                      return (
                        <Pressable
                          key={item.id}
                          {...moveResponder.panHandlers}
                          accessibilityRole="button"
                          accessibilityLabel={`Note ${item.note}`}
                          onPress={() => setSelectedNoteId((current) => current === item.id ? null : item.id)}
                          style={[
                            styles.noteBlock,
                            selectedNoteId === item.id && styles.noteBlockSelected,
                            { left: item.at * pxPerMs, top: row * rowHeight, width, height: rowHeight },
                          ]}>
                          {rowHeight >= 12 && width >= 28 && (
                            <Text numberOfLines={1} style={styles.noteText}>{item.note}</Text>
                          )}
                          <View {...resizeResponder.panHandlers} style={styles.resizeHandle} />
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
      <Modal transparent visible={Boolean(addMenu)} onRequestClose={() => setAddMenu(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setAddMenu(null)}>
          <View style={styles.addMenu}>
            <Text style={styles.addMenuTitle}>Add note {addMenu?.note}</Text>
            <Pressable onPress={addNoteFromMenu} style={styles.addMenuButton}>
              <Text style={styles.addMenuButtonText}>Add note</Text>
            </Pressable>
            <Pressable onPress={() => setAddMenu(null)} style={styles.cancelButton}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
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
  toolbarActions: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  },
  editButton: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 4,
    backgroundColor: '#e5e7eb',
  },
  editButtonText: {
    color: '#1f2937',
    fontSize: 12,
    fontWeight: '600' as const,
  },
  disabled: {
    opacity: 0.4,
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
  gridLine: {
    position: 'absolute' as const,
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: '#cbd5e1',
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
  resizeHandle: {
    position: 'absolute' as const,
    top: 0,
    right: 0,
    bottom: 0,
    width: 18,
    backgroundColor: '#93c5fd',
  },
  modalBackdrop: {
    flex: 1,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: 'rgba(17, 24, 39, 0.35)',
  },
  addMenu: {
    width: 240,
    padding: 20,
    borderRadius: 8,
    backgroundColor: '#ffffff',
  },
  addMenuTitle: {
    marginBottom: 16,
    fontSize: 17,
    fontWeight: '600' as const,
    color: '#111827',
  },
  addMenuButton: {
    alignItems: 'center' as const,
    paddingVertical: 10,
    borderRadius: 5,
    backgroundColor: '#2563eb',
  },
  addMenuButtonText: {
    color: '#ffffff',
    fontWeight: '600' as const,
  },
  cancelButton: {
    alignItems: 'center' as const,
    marginTop: 8,
    paddingVertical: 10,
  },
  cancelButtonText: {
    color: '#4b5563',
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