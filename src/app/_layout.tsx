import { Stack } from 'expo-router';

export default function Layout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ headerShown: false, orientation: 'all' }} />
      <Stack.Screen name="editpage" options={{ title: 'Edit Page', headerShown: false, orientation: 'landscape' }} />
      <Stack.Screen name="playpage" options={{ title: 'Play Page', headerShown: false, orientation: 'landscape' }} />
      <Stack.Screen name="notenpage" options={{ title: 'Noten Page', headerShown: false, orientation: 'all' }} />
      <Stack.Screen name="importpage" options={{ title: 'Import Page', headerShown: false, orientation: 'all' }} />
    </Stack>
  );
}