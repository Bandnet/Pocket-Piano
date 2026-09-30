import { Stack } from 'expo-router';

export default function Layout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: 'Startseite' }} />
      <Stack.Screen name="editpage" options={{ title: 'Edit Page', headerShown: false }} />
      <Stack.Screen name="playpage" options={{ title: 'Play Page', headerShown: false }} />
      <Stack.Screen name="notenpage" options={{ title: 'Noten Page', headerShown: false }} />
      <Stack.Screen name="settingspage" options={{ title: 'Settings Page', headerShown: false }} />
    </Stack>
  );
}