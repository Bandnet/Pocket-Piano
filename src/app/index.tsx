import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

export default function HomeScreen() {
  const router = useRouter();
  const [projectName, setProjectName] = useState('');
  const [projects, setProjects] = useState<string[]>([]);
  const [isModalVisible, setIsModalVisible] = useState(false);

  function addProject() {
    const name = projectName.trim();

    if (!name || projects.includes(name)) {
      return;
    }

    setProjects((currentProjects) => [...currentProjects, name]);
    setProjectName('');
    setIsModalVisible(false);
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Pocket Piano</Text>
        <Text style={styles.subtitle}>Choose a project to open it.</Text>

        {projects.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No projects yet</Text>
            <Text style={styles.emptyText}>
              Tap the + button below to create your first project or song.
            </Text>
          </View>
        ) : (
          <View style={styles.projectList}>
            {projects.map((project) => (
              <Pressable
                key={project}
                onPress={() => router.push('/playpage')}
                style={({ pressed }) => [styles.project, pressed && styles.projectPressed]}>
                <Text style={styles.projectText}>{project}</Text>
                <Text style={styles.projectHint}>Open</Text>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>

      <Pressable
        accessibilityLabel="Add project"
        onPress={() => setIsModalVisible(true)}
        style={({ pressed }) => [styles.fab, pressed && styles.buttonPressed]}>
        <Text style={styles.fabText}>+</Text>
      </Pressable>

      <Modal
        animationType="fade"
        transparent
        visible={isModalVisible}
        onRequestClose={() => setIsModalVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>New project</Text>
            <Text style={styles.modalText}>Give your song or project a name.</Text>
            <TextInput
              autoFocus
              value={projectName}
              onChangeText={setProjectName}
              onSubmitEditing={addProject}
              placeholder="Project name"
              returnKeyType="done"
              style={styles.input}
            />
            <View style={styles.modalActions}>
              <Pressable onPress={() => setIsModalVisible(false)} style={styles.cancelButton}>
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable onPress={addProject} style={styles.createButton}>
                <Text style={styles.buttonText}>Create</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = {
  screen: {
    flex: 1,
  },
  content: {
    alignItems: 'center' as const,
    padding: 24,
    paddingBottom: 120,
  },
  title: {
    marginTop: 32,
    fontSize: 28,
    fontWeight: '700' as const,
  },
  subtitle: {
    marginTop: 8,
    color: '#4b5563',
    textAlign: 'center' as const,
  },
  emptyState: {
    alignItems: 'center' as const,
    maxWidth: 320,
    marginTop: 80,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600' as const,
  },
  emptyText: {
    marginTop: 10,
    color: '#6b7280',
    textAlign: 'center' as const,
    lineHeight: 21,
  },
  projectList: {
    width: '100%' as const,
    maxWidth: 640,
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    justifyContent: 'space-between' as const,
    marginTop: 28,
  },
  project: {
    width: '48%' as const,
    minHeight: 120,
    justifyContent: 'space-between' as const,
    marginBottom: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    backgroundColor: '#ffffff',
  },
  projectPressed: {
    backgroundColor: '#eff6ff',
    borderColor: '#2563eb',
  },
  projectText: {
    fontSize: 16,
    fontWeight: '600' as const,
  },
  projectHint: {
    color: '#6b7280',
    fontSize: 12,
  },
  fab: {
    position: 'absolute' as const,
    right: 24,
    bottom: 24,
    width: 58,
    height: 58,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderRadius: 29,
    backgroundColor: '#2563eb',
    elevation: 5,
    shadowColor: '#000000',
    shadowOpacity: 0.2,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 3 },
  },
  fabText: {
    color: '#ffffff',
    fontSize: 30,
    fontWeight: '300' as const,
    lineHeight: 32,
  },
  modalBackdrop: {
    flex: 1,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    padding: 24,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  modalCard: {
    width: '100%' as const,
    maxWidth: 420,
    padding: 24,
    borderRadius: 12,
    backgroundColor: '#ffffff',
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: '700' as const,
  },
  modalText: {
    marginTop: 8,
    color: '#4b5563',
  },
  input: {
    minHeight: 48,
    marginTop: 20,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#9ca3af',
    borderRadius: 8,
    backgroundColor: '#ffffff',
  },
  modalActions: {
    flexDirection: 'row' as const,
    justifyContent: 'flex-end' as const,
    marginTop: 24,
  },
  cancelButton: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  cancelText: {
    color: '#4b5563',
    fontWeight: '600' as const,
  },
  createButton: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#2563eb',
  },
  buttonPressed: {
    opacity: 0.7,
  },
  buttonText: {
    color: '#ffffff',
    textAlign: 'center' as const,
  },
};