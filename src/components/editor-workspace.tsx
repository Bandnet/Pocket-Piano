import { PlayNavigation } from '@/components/play-navigation';
import { TempoControl } from '@/components/tempo-control';
import { DEFAULT_BPM, normalizeBpm, playbackScale } from '@/constants/tempo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AudioPlayer, createAudioPlayer } from 'expo-audio';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  Modal,
  PanResponder,
  PanResponderInstance,
  Platform,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

const RECORDING_STORAGE_PREFIX = '@pocket-piano/recording/';
const ROW_HEIGHT = 22; // row height at 100% zoom
const KEYBOARD_WIDTH = 76;
const PX_PER_SECOND = 120; // timeline scale at 100% zoom
const DEFAULT_NOTE_MS = 250; // length of newly added notes
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 1.25;
const SNAP_MS = 50;
const GRID_MS = 250;
const LOWEST_MIDI = 21; // A0
const HIGHEST_MIDI = 108; // C8
const MAX_PLAYERS = 12; // keep the same value as on the play page (Android limits how many players can exist)
const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const blackNoteNames = new Set(['C#', 'D#', 'F#', 'G#', 'A#']);
const RELEASE_MS = 5000; // the sound keeps fading for this long after the end of a note

function midiToName(midi: number) {
  return `${noteNames[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

function noteNameToMidi(name: string) {
  return (Number(name.slice(-1)) + 1) * 12 + noteNames.indexOf(name.slice(0, -1));
}

// all 88 piano keys, highest note first (top row of the editor)
const pianoNotes = Array.from({ length: HIGHEST_MIDI - LOWEST_MIDI + 1 }, (_, index) => midiToName(HIGHEST_MIDI - index));
const rowByNote = new Map(pianoNotes.map((note, row) => [note, row]));

// Salamander has a real sample every 3 semitones (A0, C1, D#1, F#1, A1, ... C8)
function sampleMidiFor(midi: number) {
  return Math.round(midi / 3) * 3;
}

function getSampleUrl(sampleMidi: number) {
  return `https://tonejs.github.io/audio/salamander/${midiToName(sampleMidi).replace('#', 's')}.mp3`;
}

type RecordedNote = {
  id: string;
  note: string;
  at: number;
  duration: number;
};

type StoredRecording = {
  notes: RecordedNote[];
  duration: number;
  bpm?: number;
};

type EditorWorkspaceProps = {
  projectName: string;
};

function clampZoom(value: number) {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));
}

function snapTime(value: number) {
  return Math.round(value / SNAP_MS) * SNAP_MS;
}

// Time until the next note of the same pitch starts (a note cannot be longer than that)
function gapToNextSamePitch(list: RecordedNote[], note: RecordedNote) {
  let nextAt = Infinity;
  for (const other of list) {
    if (other.id !== note.id && other.note === note.note && other.at > note.at && other.at < nextAt) nextAt = other.at;
  }
  return nextAt - note.at;
}

export function EditorWorkspace({ projectName }: EditorWorkspaceProps) {
  const { width: windowWidth } = useWindowDimensions();
  const [recording, setRecording] = useState<StoredRecording | null>(null);
  const [notes, setNotes] = useState<RecordedNote[]>([]);
  const [playhead, setPlayhead] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [bpm, setBpm] = useState(DEFAULT_BPM);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPinching, setIsPinching] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [addMenu, setAddMenu] = useState<{ note: string; at: number } | null>(null);
  const players = useRef(new Map<number, AudioPlayer>()); // sample midi -> player, least recently used first
  const playbackVoices = useRef(new Map<string, AudioPlayer>());
  const lastPlayed = useRef<Record<number, string>>({}); // sample midi -> id of the note that last started on it
  const playbackTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const playheadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinchStart = useRef<{ distance: number; zoom: number; centerX: number } | null>(null);
  const zoomAnchor = useRef<{ contentX: number; viewportX: number; baseZoom: number } | null>(null);
  const timelineScrollRef = useRef<ScrollView>(null);
  const verticalScrollRef = useRef<ScrollView>(null);
  const scrollOffset = useRef(0);
  const undoStack = useRef<{ notes: RecordedNote[]; duration: number }[]>([]);
  const notesRef = useRef<RecordedNote[]>([]);
  const dragBefore = useRef<{ notes: RecordedNote[]; duration: number } | null>(null);
  const responders = useRef<Record<string, { move: PanResponderInstance; resize: PanResponderInstance }>>({});

  const rowHeight = Math.max(2, ROW_HEIGHT * zoom);
  const pxPerMs = (PX_PER_SECOND * zoom) / 1000;
  const duration = recording?.duration ?? 0;
  const minTimelineWidth = Math.max(1, windowWidth - KEYBOARD_WIDTH - 34);
  const timelineWidth = Math.max(minTimelineWidth, (duration + DEFAULT_NOTE_MS) * pxPerMs);
  const timelineHeight = pianoNotes.length * rowHeight;

  // The cached drag handlers below live longer than one render, so they read the newest values from here
  const latest = useRef({ pxPerMs, rowHeight, duration, selectedNoteId });
  latest.current = { pxPerMs, rowHeight, duration, selectedNoteId };
  const actions = useRef({ beginEdit, updateNote, finishEdit, preview });
  actions.current = { beginEdit, updateNote, finishEdit, preview };

  // Displayed length of each note: its own length, but never longer than the gap to the same pitch
  const noteLengths = useMemo(
    () => notes.map((item) => Math.min(item.duration, gapToNextSamePitch(notes, item))),
    [notes],
  );

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(`${RECORDING_STORAGE_PREFIX}${encodeURIComponent(projectName)}`)
      .then((stored) => {
        if (cancelled) return;
        let loadedNotes: RecordedNote[] = [];
        if (stored) {
          const storedRecording = JSON.parse(stored) as StoredRecording;
          loadedNotes = storedRecording.notes.map((note, index) => ({
            id: note.id ?? `${note.note}-${note.at}-${index}`,
            note: note.note,
            at: note.at,
            duration: note.duration ?? 500,
          }));
          notesRef.current = loadedNotes;
          setNotes(loadedNotes);
          setRecording({ ...storedRecording, notes: loadedNotes });
          setBpm(normalizeBpm(storedRecording.bpm ?? DEFAULT_BPM));
        }
        setTimeout(() => scrollToNotes(loadedNotes), 100);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [projectName]);

  function releaseAudioPlayers() {
    if (playheadTimer.current) clearTimeout(playheadTimer.current);
    playheadTimer.current = null;
    playbackTimers.current.forEach((timer) => clearTimeout(timer));
    playbackTimers.current = [];
    players.current.forEach((player) => player.remove());
    players.current.clear();
    playbackVoices.current.forEach((player) => player.remove());
    playbackVoices.current.clear();
    setIsPlaying(false);
  }

  // The Play page remains mounted underneath this route, so release editor
  // players whenever the editor loses focus to avoid exceeding native limits.
  useFocusEffect(useCallback(() => releaseAudioPlayers, []));

  useEffect(() => {
    const anchor = zoomAnchor.current;
    if (!anchor) return;
    const nextOffset = Math.max(0, anchor.contentX * (zoom / anchor.baseZoom) - anchor.viewportX);
    requestAnimationFrame(() => timelineScrollRef.current?.scrollTo({ x: nextOffset, animated: false }));
  }, [zoom]);

  // Scroll the grid up/down so the recorded notes (or the C6 area when empty) are visible
  function scrollToNotes(list: RecordedNote[]) {
    const topRow = list.length
      ? list.reduce((min, item) => Math.min(min, rowByNote.get(item.note) ?? min), pianoNotes.length)
      : rowByNote.get('C6') ?? 0;
    verticalScrollRef.current?.scrollTo({ y: Math.max(0, (topRow - 2) * ROW_HEIGHT), animated: false });
  }

  // ---------- audio: one player per sample, at most MAX_PLAYERS ----------

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
      const player = createAudioPlayer(getSampleUrl(sampleMidi), { downloadFirst: Platform.OS !== 'web' });
      player.shouldCorrectPitch = false;
      players.current.set(sampleMidi, player);
      return player;
    } catch (error) {
      console.warn(`Could not create player for ${midiToName(sampleMidi)} (${players.current.size} players exist)`, error);
      return null;
    }
  }

  function startNote(noteName: string, id: string) {
    const midi = noteNameToMidi(noteName);
    if (Number.isNaN(midi)) return;
    const sampleMidi = sampleMidiFor(midi);
    const player = getPlayer(sampleMidi);
    if (!player) return;

    player.shouldCorrectPitch = false;
    player.setPlaybackRate(2 ** ((midi - sampleMidi) / 12));
    player.seekTo(0);
    player.play();
    lastPlayed.current[sampleMidi] = id;
  }

  // Ends a note after its length, unless another note has taken over the same player in the meantime
  function endNote(noteName: string, id: string) {
    const sampleMidi = sampleMidiFor(noteNameToMidi(noteName));
    if (lastPlayed.current[sampleMidi] === id) players.current.get(sampleMidi)?.pause();
  }

  function preview(noteName: string) {
    startNote(noteName, 'preview');
  }

  function stopPlayback() {
    if (playheadTimer.current) clearTimeout(playheadTimer.current);
    playbackTimers.current.forEach((timer) => clearTimeout(timer));
    playbackTimers.current = [];
    players.current.forEach((player) => player.pause());
    playbackVoices.current.forEach((player) => player.remove());
    playbackVoices.current.clear();
    setIsPlaying(false);
  }

  function startPlaybackVoice(noteName: string, id: string) {
    const midi = noteNameToMidi(noteName);
    if (Number.isNaN(midi)) return;
    const sampleMidi = sampleMidiFor(midi);
    try {
      const player = createAudioPlayer(getSampleUrl(sampleMidi), { downloadFirst: Platform.OS !== 'web' });
      player.shouldCorrectPitch = false;
      player.setPlaybackRate(2 ** ((midi - sampleMidi) / 12));
      playbackVoices.current.set(id, player);
      player.play();
    } catch (error) {
      console.warn(`Could not create playback voice for ${noteName}`, error);
    }
  }

  function endPlaybackVoice(_noteName: string, id: string) {
    const player = playbackVoices.current.get(id);
    if (!player) return;
    player.pause();
    player.remove();
    playbackVoices.current.delete(id);
  }

  function playRecording() {
    if (!notes.length || !duration) return;
    stopPlayback();
    const startAt = playhead >= duration ? 0 : playhead;
    const scale = playbackScale(bpm);
    const startedAt = Date.now() - startAt * scale;

    notes.forEach((item, index) => {
      if (item.at < startAt) return;
      playbackTimers.current.push(setTimeout(() => startPlaybackVoice(item.note, item.id), (item.at - startAt) * scale));
      playbackTimers.current.push(
        setTimeout(() => endPlaybackVoice(item.note, item.id), (item.at + noteLengths[index] + RELEASE_MS - startAt) * scale),
      );
    });
    setIsPlaying(true);

    function updatePlayhead() {
      const elapsed = (Date.now() - startedAt) / scale;
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

  // ---------- saving and editing ----------

  function persist(nextNotes: RecordedNote[], nextDuration: number, nextBpm = bpm) {
    const nextRecording = { notes: nextNotes, duration: nextDuration, bpm: nextBpm };
    notesRef.current = nextNotes;
    setNotes(nextNotes);
    setRecording(nextRecording);
    AsyncStorage.setItem(
      `${RECORDING_STORAGE_PREFIX}${encodeURIComponent(projectName)}`,
      JSON.stringify(nextRecording),
    ).catch(() => undefined);
  }

  // Save an edit and remember how things looked before it, so Undo can restore that
  function commitEdit(
    nextNotes: RecordedNote[],
    nextDuration = latest.current.duration,
    before = { notes: notesRef.current, duration: latest.current.duration },
  ) {
    undoStack.current = [...undoStack.current, before];
    persist(nextNotes, nextDuration);
  }

  function changeBpm(nextBpm: number) {
    const normalizedBpm = normalizeBpm(nextBpm);
    if (isPlaying) stopPlayback();
    setBpm(normalizedBpm);
    persist(notesRef.current, duration, normalizedBpm);
  }

  function undoLastEdit() {
    const previous = undoStack.current.pop();
    if (!previous) return;
    persist(previous.notes, previous.duration);
    setSelectedNoteId(null);
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
    commitEdit(nextNotes, Math.max(duration, nextNote.at + nextNote.duration));
    setSelectedNoteId(nextNote.id);
    setAddMenu(null);
  }

  function deleteSelectedNote() {
    if (!selectedNoteId) return;
    commitEdit(notesRef.current.filter((item) => item.id !== selectedNoteId));
    setSelectedNoteId(null);
  }

  // A drag or resize starts: remember the state before it and lock scrolling
  function beginEdit(noteId: string) {
    dragBefore.current = { notes: notesRef.current, duration: latest.current.duration };
    setSelectedNoteId(noteId);
    setIsDragging(true);
  }

  // During a drag: change the note on screen only (saved when the finger is lifted)
  function updateNote(noteId: string, changes: Partial<RecordedNote>) {
    const nextNotes = notesRef.current.map((item) => (item.id === noteId ? { ...item, ...changes } : item));
    notesRef.current = nextNotes;
    setNotes(nextNotes);
  }

  function finishEdit() {
    const before = dragBefore.current;
    dragBefore.current = null;
    setIsDragging(false);
    if (!before || notesRef.current === before.notes) return; // nothing changed (just a tap)
    const nextDuration = Math.max(before.duration, ...notesRef.current.map((item) => item.at + item.duration));
    commitEdit(notesRef.current, nextDuration, before);
  }

  // ---------- drag and resize gestures (created once per note) ----------

  function createMoveResponder(noteId: string): PanResponderInstance {
    let startAt = 0;
    let startRow = 0;
    let wasSelected = false;
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        const item = notesRef.current.find((entry) => entry.id === noteId);
        if (!item) return;
        startAt = item.at;
        startRow = rowByNote.get(item.note) ?? 0;
        wasSelected = latest.current.selectedNoteId === noteId;
        actions.current.beginEdit(noteId);
        actions.current.preview(item.note);
      },
      onPanResponderMove: (_event, gesture) => {
        if (gesture.numberActiveTouches > 1) return;
        const item = notesRef.current.find((entry) => entry.id === noteId);
        if (!item) return;
        const { pxPerMs: scale, rowHeight: height } = latest.current;
        const row = Math.max(0, Math.min(pianoNotes.length - 1, startRow + Math.round(gesture.dy / height)));
        const nextName = pianoNotes[row];
        const nextAt = snapTime(Math.max(0, startAt + gesture.dx / scale));
        if (item.at === nextAt && item.note === nextName) return;
        if (nextName !== item.note) actions.current.preview(nextName);
        actions.current.updateNote(noteId, { at: nextAt, note: nextName });
      },
      onPanResponderRelease: (_event, gesture) => {
        const isTap = Math.abs(gesture.dx) < 5 && Math.abs(gesture.dy) < 5;
        if (isTap && wasSelected) setSelectedNoteId(null); // tapping a selected note deselects it
        actions.current.finishEdit();
      },
      onPanResponderTerminate: () => actions.current.finishEdit(),
    });
  }

  function createResizeResponder(noteId: string): PanResponderInstance {
    let startDuration = 0;
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        const item = notesRef.current.find((entry) => entry.id === noteId);
        if (!item) return;
        startDuration = item.duration;
        actions.current.beginEdit(noteId);
      },
      onPanResponderMove: (_event, gesture) => {
        if (gesture.numberActiveTouches > 1) return;
        const item = notesRef.current.find((entry) => entry.id === noteId);
        if (!item) return;
        const wanted = snapTime(Math.max(SNAP_MS, startDuration + gesture.dx / latest.current.pxPerMs));
        const nextDuration = Math.max(SNAP_MS, Math.min(wanted, gapToNextSamePitch(notesRef.current, item)));
        if (nextDuration !== item.duration) actions.current.updateNote(noteId, { duration: nextDuration });
      },
      onPanResponderRelease: () => actions.current.finishEdit(),
      onPanResponderTerminate: () => actions.current.finishEdit(),
    });
  }

  function getResponders(noteId: string) {
    if (!responders.current[noteId]) {
      responders.current[noteId] = { move: createMoveResponder(noteId), resize: createResizeResponder(noteId) };
    }
    return responders.current[noteId];
  }

  // ---------- zoom and seeking ----------

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

  // Tap on an empty part of the timeline: move the playhead there.
  // locationX is already measured from the left edge of the whole timeline, so the scroll offset is not added.
  function seek(event: any) {
    if (pinchStart.current) return;
    stopPlayback();
    const position = event.nativeEvent.locationX / pxPerMs;
    setPlayhead(Math.max(0, Math.min(duration, position)));
  }

  return (
    <View style={styles.root}>
      <PlayNavigation
        projectName={projectName}
        isRecording={false}
        isPlaying={isPlaying}
        hasRecording={notes.length > 0}
        onTogglePlayback={isPlaying ? stopPlayback : playRecording}
        isEditor
        showRecording={false}
      />
      <View style={styles.workspace}>
        <View style={styles.toolbar}>
          <Text style={styles.toolbarText}>Timeline</Text>
          <View style={styles.toolbarActions}>
            <TempoControl bpm={bpm} onChange={changeBpm} />
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
          <ScrollView
            ref={verticalScrollRef}
            scrollEnabled={!isPinching && !isDragging}
            nestedScrollEnabled
            showsVerticalScrollIndicator>
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
                  scrollEnabled={!isPinching && !isDragging}
                  nestedScrollEnabled
                  onScroll={(event) => { scrollOffset.current = event.nativeEvent.contentOffset.x; }}
                  scrollEventThrottle={16}
                  showsHorizontalScrollIndicator
                  contentContainerStyle={{ width: timelineWidth }}>
                  <View style={{ width: timelineWidth, height: timelineHeight }}>
                    {/* rows: tap to move the playhead, long press to add a note */}
                    {pianoNotes.map((note, index) => (
                      <Pressable
                        key={note}
                        delayLongPress={350}
                        onPress={seek}
                        onLongPress={(event) => setAddMenu({ note, at: snapTime(event.nativeEvent.locationX / pxPerMs) })}
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
                      const row = rowByNote.get(item.note);
                      if (row === undefined) return null;
                      const width = Math.max(4, noteLengths[index] * pxPerMs);
                      const handleWidth = Math.min(18, Math.max(6, width * 0.35));
                      const { move, resize } = getResponders(item.id);
                      return (
                        <View
                          key={item.id}
                          {...move.panHandlers}
                          accessibilityRole="button"
                          accessibilityLabel={`Note ${item.note}`}
                          style={[
                            styles.noteBlock,
                            selectedNoteId === item.id && styles.noteBlockSelected,
                            { left: item.at * pxPerMs, top: row * rowHeight, width, height: rowHeight },
                          ]}>
                          {rowHeight >= 12 && width >= 40 && (
                            <Text numberOfLines={1} style={styles.noteText}>{item.note}</Text>
                          )}
                          <View {...resize.panHandlers} style={[styles.resizeHandle, { width: handleWidth }]} />
                        </View>
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