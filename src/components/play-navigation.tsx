import { TempoControl } from '@/components/tempo-control';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type PlayNavigationProps = {
  isPlaying: boolean;
  isRecording: boolean;
  hasRecording: boolean;
  onTogglePlayback: () => void;
  onToggleRecording?: () => void;
  projectName: string;
  isEditor?: boolean;
  showRecording?: boolean;
  bpm?: number;
  onBpmChange?: (bpm: number) => void;
};

export function PlayNavigation({
  hasRecording,
  isPlaying,
  isRecording,
  onTogglePlayback,
  onToggleRecording,
  projectName,
  isEditor = false,
  showRecording = true,
  bpm,
  onBpmChange,
}: PlayNavigationProps) {
  const [isMenuVisible, setIsMenuVisible] = useState(false);

  const { width: windowWidth } = useWindowDimensions();
  // Zwei Zeilen nur auf schmalen Bildschirmen (Handy). Auf breiten passt alles in eine Zeile.
  const twoRows = bpm !== undefined && windowWidth < 720;

  function closeMenu() {
    setIsMenuVisible(false);
  }

  function openRoute(route: '/' | '/playpage' | '/editpage' | '/notenpage' | '/settingspage') {
    closeMenu();
    router.push({ pathname: route, params: { project: projectName } });
  }

  return (
    <>
      <SafeAreaView edges={['top']} style={styles.navigation}>
        <View style={[styles.navigationContent, twoRows && styles.navigationContentWithTempo]}>
          <View style={styles.topRow}>
            <Pressable
              accessibilityLabel="Open navigation menu"
              accessibilityRole="button"
              onPress={() => setIsMenuVisible(true)}
              style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
              <Ionicons name="menu-outline" size={28} color="#1f2937" />
            </Pressable>
            <Text numberOfLines={1} ellipsizeMode="tail" style={styles.projectName}>
              {projectName}
            </Text>
            {bpm !== undefined && onBpmChange ? (
              <View style={styles.headerTempo}>
                <TempoControl bpm={bpm} onChange={onBpmChange} />
              </View>
            ) : null}
            <Pressable
              accessibilityLabel={isEditor ? 'Return to play page' : 'Open edit page'}
              accessibilityRole="button"
              onPress={() => openRoute(isEditor ? '/playpage' : '/editpage')}
              style={({ pressed }) => [styles.editButton, pressed && styles.pressed]}>
              <Text style={styles.editText}>{isEditor ? 'Play' : 'Edit'}</Text>
              <Ionicons name={isEditor ? 'arrow-back-outline' : 'arrow-forward-outline'} size={22} color="#1d4ed8" />
            </Pressable>
          </View>
          <View pointerEvents="box-none" style={twoRows ? styles.actionsWithTempo : styles.actions}>
            {showRecording && onToggleRecording ? (
              <Pressable
                accessibilityLabel={isRecording ? 'Stop recording' : 'Start recording'}
                accessibilityRole="button"
                onPress={onToggleRecording}
                style={[styles.recordButton, isRecording && styles.stopButton]}>
                <View style={[styles.recordIcon, isRecording && styles.stopIcon]} />
                <Text style={styles.actionText}>{isRecording ? 'Stop' : 'Record'}</Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityLabel={isPlaying ? 'Stop playback' : 'Play recording'}
              accessibilityRole="button"
              disabled={!hasRecording}
              onPress={onTogglePlayback}
              style={[styles.playButton, !hasRecording && styles.disabledButton]}>
              <Ionicons name={isPlaying ? 'stop' : 'play'} size={14} color="#ffffff" />
              <Text style={styles.actionText}>{isPlaying ? 'Stop' : 'Play'}</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>

      <Modal
        animationType="fade"
        transparent
        visible={isMenuVisible}
        onRequestClose={closeMenu}>
        <Pressable style={styles.backdrop} onPress={closeMenu}>
          <View style={styles.menu}>
            <Text style={styles.menuTitle}>Navigation</Text>
            <Pressable onPress={() => openRoute('/')} style={styles.menuItem}>
              <Ionicons name="home-outline" size={20} color="#1f2937" />
              <Text style={styles.menuText}>Home</Text>
            </Pressable>
            <Pressable onPress={() => openRoute('/playpage')} style={styles.menuItem}>
              <Ionicons name="musical-notes-outline" size={20} color="#1f2937" />
              <Text style={styles.menuText}>Play</Text>
            </Pressable>
            <Pressable onPress={() => openRoute('/editpage')} style={styles.menuItem}>
              <Ionicons name="create-outline" size={20} color="#1f2937" />
              <Text style={styles.menuText}>Edit</Text>
            </Pressable>
            <Pressable onPress={() => openRoute('/notenpage')} style={styles.menuItem}>
              <Ionicons name="document-text-outline" size={20} color="#1f2937" />
              <Text style={styles.menuText}>Notes</Text>
            </Pressable>
            <Pressable onPress={() => openRoute('/settingspage')} style={styles.menuItem}>
              <Ionicons name="settings-outline" size={20} color="#1f2937" />
              <Text style={styles.menuText}>Settings</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = {
  navigation: {
    width: '100%' as const,
    backgroundColor: '#f3f4f6',
  },
  navigationContent: {
    position: 'relative' as const,
    minHeight: 56,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#d1d5db',
  },
    navigationContentWithTempo: {
    paddingTop: 2,
    paddingBottom: 6,
  },
  topRow: {
    width: '100%' as const,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    minHeight: 48,
  },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  editButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'flex-end' as const,
    width: 72,
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  projectName: {
    flex: 1,
    marginHorizontal: 12,
    textAlign: 'left' as const,
    fontSize: 17,
    fontWeight: '600' as const,
    color: '#111827',
  },
  headerTempo: {
    marginLeft: 4,
  },
    actions: {
    position: 'absolute' as const,
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 6,
  },
  actionsWithTempo: {
    width: '100%' as const,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 6,
    paddingTop: 2,
  },
  recordButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    minWidth: 78,
    justifyContent: 'center' as const,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#dc2626',
  },
  stopButton: {
    backgroundColor: '#991b1b',
  },
  recordIcon: {
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: '#ffffff',
  },
  stopIcon: {
    borderRadius: 2,
  },
  playButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 6,
    minWidth: 62,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#2563eb',
  },
  disabledButton: {
    opacity: 0.45,
  },
  actionText: {
    color: '#ffffff',
    fontWeight: '600' as const,
  },
  editText: {
    color: '#1d4ed8',
    fontWeight: '600' as const,
  },
  pressed: {
    opacity: 0.6,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(17, 24, 39, 0.35)',
  },
  menu: {
    width: 260,
    minHeight: '100%' as const,
    paddingTop: 64,
    paddingHorizontal: 20,
    backgroundColor: '#ffffff',
    shadowColor: '#000000',
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 8,
  },
  menuTitle: {
    marginBottom: 20,
    fontSize: 20,
    fontWeight: '700' as const,
    color: '#111827',
  },
  menuItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    paddingVertical: 14,
  },
  menuText: {
    fontSize: 16,
    color: '#1f2937',
  },
};
