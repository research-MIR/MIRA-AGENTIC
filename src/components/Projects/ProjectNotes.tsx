import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, Edit, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { showError, showSuccess, showLoading, dismissToast } from "@/utils/toast";
import { useLanguage } from "@/context/LanguageContext";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Note {
  id: string;
  title: string;
  content: string;
  updated_at: string;
}

export const ProjectNotes = ({ projectId }: { projectId: string }) => {
  const { supabase, session } = useSession();
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [noteTitle, setNoteTitle] = useState('');
  const [noteContent, setNoteContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const { data: notes, isLoading } = useQuery<Note[]>({
    queryKey: ['projectNotes', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_notes')
        .select('*')
        .eq('project_id', projectId)
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!projectId,
  });

  const openModalForNew = () => {
    setEditingNote(null);
    setNoteTitle('');
    setNoteContent('');
    setIsModalOpen(true);
  };

  const openModalForEdit = (note: Note) => {
    setEditingNote(note);
    setNoteTitle(note.title);
    setNoteContent(note.content);
    setIsModalOpen(true);
  };

  const handleSave = async () => {
    if (!noteTitle.trim() || !session?.user) return;
    setIsSaving(true);
    const toastId = showLoading(editingNote ? "Updating note..." : "Saving note...");
    try {
      const { error } = await supabase.from('project_notes').upsert({
        id: editingNote?.id,
        project_id: projectId,
        user_id: session.user.id,
        title: noteTitle,
        content: noteContent,
      });
      if (error) throw error;
      dismissToast(toastId);
      showSuccess(t('noteSaved'));
      queryClient.invalidateQueries({ queryKey: ['projectNotes', projectId] });
      setIsModalOpen(false);
    } catch (err: any) {
      dismissToast(toastId);
      showError(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (noteId: string) => {
    const { error } = await supabase.from('project_notes').delete().eq('id', noteId);
    if (error) showError(error.message);
    else {
      showSuccess("Note deleted.");
      queryClient.invalidateQueries({ queryKey: ['projectNotes', projectId] });
    }
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{t('notes')}</CardTitle>
          <Button size="sm" onClick={openModalForNew}><Plus className="h-4 w-4 mr-2" />{t('addNote')}</Button>
        </CardHeader>
        <CardContent>
          {isLoading ? <Loader2 className="h-6 w-6 animate-spin" /> : (
            notes && notes.length > 0 ? (
              <Accordion type="single" collapsible className="w-full">
                {notes.map(note => (
                  <AccordionItem key={note.id} value={note.id}>
                    <AccordionTrigger>
                      <div className="flex justify-between items-center w-full pr-4">
                        <span className="font-semibold truncate">{note.title}</span>
                        <span className="text-xs text-muted-foreground">{new Date(note.updated_at).toLocaleDateString()}</span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="prose prose-sm dark:prose-invert max-w-none markdown-content">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{note.content}</ReactMarkdown>
                      </div>
                      <div className="flex justify-end gap-2 mt-4">
                        <Button variant="ghost" size="sm" onClick={() => openModalForEdit(note)}><Edit className="h-3 w-3 mr-2" />{t('editNote')}</Button>
                        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => handleDelete(note.id)}><Trash2 className="h-3 w-3 mr-2" />{t('deleteNote')}</Button>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">No notes for this project yet.</p>
            )
          )}
        </CardContent>
      </Card>

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingNote ? t('editNote') : t('addNote')}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div>
              <Label htmlFor="note-title">{t('noteTitle')}</Label>
              <Input id="note-title" value={noteTitle} onChange={(e) => setNoteTitle(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="note-content">{t('noteContent')}</Label>
              <Textarea id="note-content" value={noteContent} onChange={(e) => setNoteContent(e.target.value)} rows={10} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsModalOpen(false)}>{t('cancel')}</Button>
            <Button onClick={handleSave} disabled={isSaving || !noteTitle.trim()}>
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('saveNote')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};