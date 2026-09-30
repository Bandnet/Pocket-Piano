import { useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

export default function NotenPage() {
  const router = useRouter();

  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <Text>Noten Page</Text>
      <Pressable
        onPress={() => router.back()}
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}>
        <Text style={styles.buttonText}>Zurück</Text>
      </Pressable>
    </View>
  );
}

const styles = {
  button: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#2563eb',
  },
  buttonPressed: {
    opacity: 0.7,
  },
  buttonText: {
    color: '#ffffff',
  },
};