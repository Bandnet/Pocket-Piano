import { Pressable, Text, TextInput, View } from 'react-native';
import { useEffect, useState } from 'react';
import { MAX_BPM, MIN_BPM, normalizeBpm } from '@/constants/tempo';

type TempoControlProps = {
  bpm: number;
  onChange: (bpm: number) => void;
};

export function TempoControl({ bpm, onChange }: TempoControlProps) {
  const [draft, setDraft] = useState(String(bpm));

  useEffect(() => {
    setDraft(String(bpm));
  }, [bpm]);

  function changeBpm(value: string) {
    setDraft(value.replace(/[^0-9]/g, ''));
  }

  function commitBpm() {
    const parsed = Number(draft);
    onChange(Number.isFinite(parsed) && parsed > 0 ? normalizeBpm(parsed) : bpm);
  }

  return (
    <View style={styles.container}>
      <Text style={styles.label}>BPM</Text>
      <Pressable
        accessibilityLabel="Decrease BPM"
        disabled={bpm <= MIN_BPM}
        onPress={() => onChange(normalizeBpm(bpm - 1))}
        style={[styles.button, bpm <= MIN_BPM && styles.disabled]}>
        <Text style={styles.buttonText}>-</Text>
      </Pressable>
      <TextInput
        accessibilityLabel="Beats per minute"
        keyboardType="number-pad"
        onChangeText={changeBpm}
        onEndEditing={commitBpm}
        selectTextOnFocus
        style={styles.input}
        value={draft}
      />
      <Pressable
        accessibilityLabel="Increase BPM"
        disabled={bpm >= MAX_BPM}
        onPress={() => onChange(normalizeBpm(bpm + 1))}
        style={[styles.button, bpm >= MAX_BPM && styles.disabled]}>
        <Text style={styles.buttonText}>+</Text>
      </Pressable>
    </View>
  );
}

const styles = {
  container: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
  },
  label: {
    marginRight: 2,
    color: '#4b5563',
    fontSize: 12,
    fontWeight: '600' as const,
  },
  button: {
    width: 26,
    height: 30,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderRadius: 4,
    backgroundColor: '#dbeafe',
  },
  buttonText: {
    color: '#1d4ed8',
    fontSize: 18,
    lineHeight: 20,
  },
  input: {
    width: 42,
    height: 30,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: '#93c5fd',
    borderRadius: 4,
    color: '#111827',
    textAlign: 'center' as const,
    backgroundColor: '#ffffff',
  },
  disabled: {
    opacity: 0.4,
  },
};
