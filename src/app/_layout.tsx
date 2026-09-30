import { Stack } from 'expo-router';

export default function Layout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: 'Startseite' }} />
      <Stack.Screen name="editpage" options={{ title: 'Edit Page' }} />
      <Stack.Screen name="playpage" options={{ title: 'Play Page' }} />
      <Stack.Screen name="notenpage" options={{ title: 'Noten Page' }} />
    </Stack>
  );
}