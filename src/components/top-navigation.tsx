import { useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const navigationItems = [
  { label: 'Home', route: '/' },
  { label: 'Play', route: '/playpage' },
  { label: 'Edit', route: '/editpage' },
  { label: 'Noten', route: '/notenpage' },
  { label: 'Import', route: '/importpage' },
] as const;

export function TopNavigation() {
  const router = useRouter();

  return (
    <SafeAreaView edges={['top']} style={styles.navigation}>
      <View style={styles.navigationContent}>
        {navigationItems.map((item) => (
          <Pressable
            key={item.route}
            onPress={() => router.push(item.route)}
            style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}>
            <Text style={styles.itemText}>{item.label}</Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = {
  navigation: {
    width: '100%' as const,
    backgroundColor: '#f3f4f6',
  },
  navigationContent: {
    flexDirection: 'row' as const,
    justifyContent: 'space-around' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 8,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#d1d5db',
  },
  item: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
  },
  itemPressed: {
    backgroundColor: '#dbeafe',
  },
  itemText: {
    color: '#1d4ed8',
    fontWeight: '600' as const,
  },
};
