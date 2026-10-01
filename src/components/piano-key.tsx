import { StyleProp, Text, View, ViewStyle } from 'react-native';

type PianoKeyProps = {
  isBlack: boolean;
  note: string;
  pressed?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function PianoKey({ isBlack, note, pressed = false, style }: PianoKeyProps) {
  return (
    <View
      pointerEvents="none"
      style={[
        styles.key,
        isBlack ? styles.blackKey : styles.whiteKey,
        style,
        pressed && styles.pressedKey,
      ]}>
      <Text style={isBlack ? styles.blackKeyText : styles.whiteKeyText}>{note}</Text>
    </View>
  );
}

const styles = {
  key: {
    alignItems: 'center' as const,
    justifyContent: 'flex-end' as const,
    width: 72,
    height: 220,
    paddingBottom: 16,
    borderRadius: 0,
    borderWidth: 1,
  },
  whiteKey: {
    borderColor: '#9ca3af',
    backgroundColor: '#ffffff',
  },
  blackKey: {
    width: 48,
    height: 140,
    borderColor: '#111827',
    backgroundColor: '#111827',
    zIndex: 1,
  },
  pressedKey: {
    opacity: 0.7,
  },
  whiteKeyText: {
    color: '#111827',
  },
  blackKeyText: {
    color: '#ffffff',
  },
};