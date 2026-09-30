import { TopNavigation } from '@/components/top-navigation';
import { Text, View } from 'react-native';

export default function NotenPage() {
  return (
    <View style={{ flex: 1 }}>
      <TopNavigation />
      <View style={styles.content}>
        <Text>Noten Page</Text>
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
};