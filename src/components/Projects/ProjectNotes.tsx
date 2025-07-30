import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";
import { showError, showSuccess } from "@/utils/toast";
import { useLanguage } from "@/context/LanguageContext";

interface Note {
  id: string;
  content: string;
}

export const ProjectNotes = ({ projectId }: { projectId: string }) => {
  const { supabase, session } = useSession();
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [noteContent, setNoteContent] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const { data: note, isLoading } = useQuery<Note | null>({
    queryKey: ['projectNote', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_notes')
        .select('id, content')
        .eq('project_id', projectId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!projectId,
  });

  useEffect(() => {
    if (note) {
      setNoteContent(note.content || '');
      setIsDirty(false);
    } else {
      setNoteContent('');
    }
  }, [note]);

  const handleSave = async () => {
    if (!session?.user) return;
    setIsSaving(true);
    try {
      const { error } = await supabase.from('project_notes').upsert({
        id: note?.id,
        project_id: projectId,
        user_id: session.user.id,
        content: noteContent,
      });
      if (error) throw error;
      showSuccess(t('noteSaved'));
      setIsDirty(false);
      queryClient.invalidateQueries({ queryKey: ['projectNote', projectId] });
    } catch (err: any) {
      showError(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('notes')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? <Loader2 className="h-6 w-6 animate-spin" /> : (
          <Textarea
            value={noteContent}
            onChange={(e) => {
              setNoteContent(e.target.value);
              setIsDirty(true);
            }}
            placeholder={t('addNote')}
            rows={8}
          />
        )}
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={!isDirty || isSaving}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('saveNote')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};