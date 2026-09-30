import { PianoKey } from '@/components/piano-key';
import { TopNavigation } from '@/components/top-navigation';
import { preload, setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import { useEffect } from 'react';
import { Text, View } from 'react-native';

const C4_SOUND = 'https://tonejs.github.io/audio/salamander/C4.mp3';

preload(C4_SOUND).catch(() => undefined);

export default function PlayPage() {
  const pianoPlayer = useAudioPlayer(C4_SOUND);

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true }).catch(() => undefined);
  }, []);

  function playC4() {
    pianoPlayer.seekTo(0);
    pianoPlayer.play();
  }

  return (
    <View style={{ flex: 1 }}>
      <TopNavigation />
      <View style={styles.content}>
        <Text>Play Page</Text>
        <View style={styles.piano}>
          <PianoKey isBlack={false} note="C4" onPress={playC4} />
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
    marginTop: 24,
  },
};