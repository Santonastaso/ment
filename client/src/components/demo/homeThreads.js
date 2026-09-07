export function threadStore(client, userId) {
  if (!userId) throw new Error('Authentication required');
  return {
    async list() {
      const { data, error } = await client.from('discovery_threads').select('*').eq('user_id', userId).eq('archived', false).order('updated_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    async save(thread) {
      if (thread.user_id !== userId) throw new Error('Thread owner mismatch');
      const { error } = await client.from('discovery_threads').upsert({
        id: thread.id, user_id: userId, title: thread.title, intent: thread.intent,
        turns: thread.turns, selected_person_id: thread.selected_person_id || null,
        archived: !!thread.archived, updated_at: new Date().toISOString(),
      }, { onConflict: 'id' });
      if (error) throw error;
    },
  };
}
