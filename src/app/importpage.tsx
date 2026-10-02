import { TopNavigation } from '@/components/top-navigation';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, Paths } from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import { useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useEffect, useState } from 'react';
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';

const PROJECTS_STORAGE_KEY = '@pocket-piano/projects';
const RECORDING_STORAGE_PREFIX = '@pocket-piano/recording/';
const EXPORT_FORMAT = 'pocket-piano-songs';
const EXPORT_VERSION = 1;

type SongNote = {
  id?: string;
  note: string;
  at: number;
  duration: number;
};

type StoredRecording = {
  notes: SongNote[];
  duration: number;
  bpm?: number;
};

type SongFileEntry = {
  projectName: string;
  recording: StoredRecording;
};

type SongExport = {
  format: typeof EXPORT_FORMAT;
  version: typeof EXPORT_VERSION;
  songs: SongFileEntry[];
};

function isValidRecording(value: unknown): value is StoredRecording {
  if (!value || typeof value !== 'object') return false;
  const recording = value as Partial<StoredRecording>;
  return Array.isArray(recording.notes)
    && recording.notes.every((note) => (
      Boolean(note)
      && typeof note.note === 'string'
      && typeof note.at === 'number'
      && typeof note.duration === 'number'
      && note.at >= 0
      && note.duration > 0
    ))
    && typeof recording.duration === 'number'
    && recording.duration >= 0
    && (recording.bpm === undefined || (typeof recording.bpm === 'number' && recording.bpm > 0));
}

function isValidSongFile(value: unknown): value is SongExport {
  if (!value || typeof value !== 'object') return false;
  const file = value as Partial<SongExport>;
  return file.format === EXPORT_FORMAT
    && file.version === EXPORT_VERSION
    && Array.isArray(file.songs)
    && file.songs.every((song) => (
      Boolean(song)
      && typeof song.projectName === 'string'
      && song.projectName.trim().length > 0
      && isValidRecording(song.recording)
    ));
}

export default function ImportPage() {
  const { project } = useLocalSearchParams<{ project?: string }>();
  const currentProject = Array.isArray(project) ? project[0] : project;
  const [isBusy, setIsBusy] = useState(false);
  const [projectCount, setProjectCount] = useState(0);
  const [pastedJson, setPastedJson] = useState('');

  useEffect(() => {
    AsyncStorage.getItem(PROJECTS_STORAGE_KEY)
      .then((stored) => setProjectCount(stored ? (JSON.parse(stored) as string[]).length : 0))
      .catch(() => undefined);
  }, []);

  async function exportSongs() {
    setIsBusy(true);
    try {
      const storedProjects = await AsyncStorage.getItem(PROJECTS_STORAGE_KEY);
      const projects = storedProjects ? JSON.parse(storedProjects) as string[] : [];
      const songs: SongFileEntry[] = [];

      for (const projectName of projects) {
        const storedRecording = await AsyncStorage.getItem(
          `${RECORDING_STORAGE_PREFIX}${encodeURIComponent(projectName)}`,
        );
        if (!storedRecording) continue;
        const recording = JSON.parse(storedRecording) as StoredRecording;
        if (isValidRecording(recording)) songs.push({ projectName, recording });
      }

      if (!songs.length) {
        Alert.alert('Nothing to export', 'Create or record a song before exporting.');
        return;
      }

      const exportData: SongExport = { format: EXPORT_FORMAT, version: EXPORT_VERSION, songs };
      const file = new File(Paths.cache, `pocket-piano-export-${Date.now()}.json`);
      file.create();
      file.write(JSON.stringify(exportData, null, 2));

      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert('Sharing unavailable', `The export was created at ${file.uri}.`);
        return;
      }
      await Sharing.shareAsync(file.uri, {
        mimeType: 'application/json',
        dialogTitle: 'Export Pocket Piano songs',
        UTI: 'public.json',
      });
    } catch (error) {
      console.warn('Could not export songs', error);
      Alert.alert('Export failed', 'The songs could not be exported.');
    } finally {
      setIsBusy(false);
    }
  }

  async function saveImportedSongs(parsed: SongExport) {
    const storedProjects = await AsyncStorage.getItem(PROJECTS_STORAGE_KEY);
    const existingProjects = storedProjects ? JSON.parse(storedProjects) as string[] : [];
    const projectSet = new Set(existingProjects);
    for (const song of parsed.songs) {
      await AsyncStorage.setItem(
        `${RECORDING_STORAGE_PREFIX}${encodeURIComponent(song.projectName)}`,
        JSON.stringify(song.recording),
      );
      projectSet.add(song.projectName);
    }
    const importedProjects = [...projectSet];
    await AsyncStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(importedProjects));
    setProjectCount(importedProjects.length);
  }

  async function saveToCurrentProject(parsed: SongExport) {
    if (!currentProject) {
      await saveImportedSongs(parsed);
      return;
    }

    const song = parsed.songs[0];
    if (!song) return;

    await AsyncStorage.setItem(
      `${RECORDING_STORAGE_PREFIX}${encodeURIComponent(currentProject)}`,
      JSON.stringify(song.recording),
    );
  }

  function showImportComplete(count: number, importedToCurrentProject: boolean, sourceName?: string) {
    Alert.alert(
      'Import complete',
      importedToCurrentProject
        ? `"${currentProject}" was replaced with "${sourceName ?? 'the imported song'}".`
        : `${count} song(s) imported.`,
    );
  }

  async function importSongs() {
    setIsBusy(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        // Some Android file providers (including messaging apps) report JSON
        // files as text/plain or application/octet-stream.
        type: '*/*',
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;

      const selectedFile = result.assets[0];
      if (!selectedFile) {
        Alert.alert('Invalid file', 'No file was selected.');
        return;
      }

      const file = new File(selectedFile.uri);
      const fileText = (await file.text()).replace(/^\uFEFF/, '').trim();
      const parsed: unknown = JSON.parse(fileText);
      if (!isValidSongFile(parsed)) {
        Alert.alert('Invalid file', 'This is not a valid Pocket Piano export file.');
        return;
      }

      await saveToCurrentProject(parsed);
      showImportComplete(parsed.songs.length, Boolean(currentProject), parsed.songs[0]?.projectName);
    } catch (error) {
      console.warn('Could not import songs', error);
      Alert.alert('Import failed', 'Choose a valid Pocket Piano JSON export file.');
    } finally {
      setIsBusy(false);
    }
  }

  async function importPastedJson() {
    setIsBusy(true);
    try {
      const parsed: unknown = JSON.parse(pastedJson);
      if (!isValidSongFile(parsed)) {
        Alert.alert('Invalid JSON', 'Paste a valid Pocket Piano JSON export.');
        return;
      }
      await saveToCurrentProject(parsed);
      setPastedJson('');
      showImportComplete(parsed.songs.length, Boolean(currentProject), parsed.songs[0]?.projectName);
    } catch (error) {
      console.warn('Could not import pasted JSON', error);
      Alert.alert('Invalid JSON', 'The pasted text is not valid JSON or not a Pocket Piano export.');
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <View style={styles.screen}>
      <TopNavigation />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardAvoidingView}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled">
          <Pressable onPress={Keyboard.dismiss} style={styles.content}>
            <Text style={styles.title}>Import songs</Text>
            <Text style={styles.subtitle}>Import or export your songs and backups.</Text>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Song data</Text>
              <Text style={styles.cardText}>
                {projectCount} saved project{projectCount === 1 ? '' : 's'}. Export creates a JSON backup of all projects.
              </Text>
              <Text style={styles.inputLabel}>Paste JSON directly</Text>
              <TextInput
                accessibilityLabel="Paste Pocket Piano JSON"
                blurOnSubmit
                multiline
                onChangeText={setPastedJson}
                onSubmitEditing={Keyboard.dismiss}
                placeholder="Paste the contents of song.json here"
                returnKeyType="done"
                style={styles.jsonInput}
                textAlignVertical="top"
                value={pastedJson}
              />
              <Pressable
                accessibilityRole="button"
                disabled={isBusy || !pastedJson.trim()}
                onPress={importPastedJson}
                style={[styles.button, styles.secondaryButton, (isBusy || !pastedJson.trim()) && styles.disabled]}>
                <Text style={styles.secondaryButtonText}>Import pasted JSON</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={isBusy}
                onPress={exportSongs}
                style={[styles.button, isBusy && styles.disabled]}>
                <Text style={styles.buttonText}>Export songs as JSON</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={isBusy}
                onPress={importSongs}
                style={[styles.button, styles.fileButton, isBusy && styles.disabled]}>
                <Text style={styles.secondaryButtonText}>Import songs from JSON</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={Keyboard.dismiss} style={styles.dismissButton}>
                <Text style={styles.dismissButtonText}>Done / hide keyboard</Text>
              </Pressable>
            </View>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = {
  screen: { flex: 1, backgroundColor: '#f8fafc' },
  keyboardAvoidingView: { flex: 1 },
  scrollContent: { paddingBottom: 48 },
  content: { alignItems: 'center' as const, padding: 24, width: '100%' as const },
  title: { marginTop: 32, fontSize: 28, fontWeight: '700' as const, color: '#111827' },
  subtitle: { marginTop: 8, color: '#4b5563', textAlign: 'center' as const },
  card: {
    width: '100%' as const,
    maxWidth: 420,
    marginTop: 32,
    padding: 20,
    borderRadius: 10,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  cardTitle: { fontSize: 19, fontWeight: '700' as const, color: '#111827' },
  cardText: { marginTop: 8, marginBottom: 20, lineHeight: 21, color: '#4b5563' },
  inputLabel: { marginBottom: 6, color: '#374151', fontWeight: '600' as const },
  jsonInput: {
    minHeight: 140,
    padding: 10,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 6,
    color: '#111827',
    backgroundColor: '#f8fafc',
    fontFamily: 'monospace',
  },
  button: {
    alignItems: 'center' as const,
    paddingVertical: 12,
    borderRadius: 6,
    backgroundColor: '#2563eb',
  },
  secondaryButton: { marginTop: 10, backgroundColor: '#dbeafe' },
  fileButton: { backgroundColor: '#e0e7ff' },
  dismissButton: { alignItems: 'center' as const, marginTop: 12, paddingVertical: 8 },
  dismissButtonText: { color: '#4b5563', fontWeight: '600' as const },
  buttonText: { color: '#ffffff', fontWeight: '700' as const },
  secondaryButtonText: { color: '#1d4ed8', fontWeight: '700' as const },
  disabled: { opacity: 0.5 },
};
