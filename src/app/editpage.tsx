import { EditorWorkspace } from '@/components/editor-workspace';
import { useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

export default function EditPage() {
  const { project } = useLocalSearchParams<{ project?: string }>();
  const projectName = Array.isArray(project) ? project[0] : project || 'default';

  return (
    <View style={{ flex: 1 }}>
      <EditorWorkspace projectName={projectName} />
    </View>
  );
}
