import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, Calendar as CalendarIcon, Loader2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { format } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { showError, showSuccess, showLoading, dismissToast } from "@/utils/toast";
import { useLanguage } from "@/context/LanguageContext";

interface Deadline {
  id: string;
  title: string;
  due_date: string | null;
  status: 'pending' | 'completed';
}

export const ProjectDeadlines = ({ projectId }: { projectId: string }) => {
  const { supabase, session } = useSession();
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDate, setNewDate] = useState<Date | undefined>(undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data: deadlines, isLoading } = useQuery<Deadline[]>({
    queryKey: ['projectDeadlines', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_deadlines')
        .select('*')
        .eq('project_id', projectId)
        .order('due_date', { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!projectId,
  });

  const handleAddDeadline = async () => {
    if (!newTitle.trim() || !session?.user) return;
    setIsSubmitting(true);
    const toastId = showLoading("Adding deadline...");
    try {
      const { error } = await supabase.from('project_deadlines').insert({
        project_id: projectId,
        user_id: session.user.id,
        title: newTitle,
        due_date: newDate ? newDate.toISOString() : null,
      });
      if (error) throw error;
      dismissToast(toastId);
      showSuccess("Deadline added.");
      queryClient.invalidateQueries({ queryKey: ['projectDeadlines', projectId] });
      setIsModalOpen(false);
      setNewTitle('');
      setNewDate(undefined);
    } catch (err: any) {
      dismissToast(toastId);
      showError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleStatus = async (deadline: Deadline) => {
    const newStatus = deadline.status === 'pending' ? 'completed' : 'pending';
    const { error } = await supabase.from('project_deadlines').update({ status: newStatus }).eq('id', deadline.id);
    if (error) showError(error.message);
    else queryClient.invalidateQueries({ queryKey: ['projectDeadlines', projectId] });
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('project_deadlines').delete().eq('id', id);
    if (error) showError(error.message);
    else {
      showSuccess("Deadline deleted.");
      queryClient.invalidateQueries({ queryKey: ['projectDeadlines', projectId] });
    }
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{t('deadlines')}</CardTitle>
          <Button size="sm" onClick={() => setIsModalOpen(true)}><Plus className="h-4 w-4 mr-2" />{t('addDeadline')}</Button>
        </CardHeader>
        <CardContent>
          {isLoading ? <Loader2 className="h-6 w-6 animate-spin" /> : (
            <div className="space-y-2">
              {deadlines?.map(d => (
                <div key={d.id} className="flex items-center justify-between p-2 rounded-md hover:bg-muted">
                  <div className="flex items-center gap-3">
                    <Checkbox checked={d.status === 'completed'} onCheckedChange={() => toggleStatus(d)} />
                    <div>
                      <p className={cn("font-medium", d.status === 'completed' && "line-through text-muted-foreground")}>{d.title}</p>
                      {d.due_date && <p className="text-xs text-muted-foreground">{format(new Date(d.due_date), 'PPP')}</p>}
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDelete(d.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </div>
              ))}
              {deadlines?.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">No deadlines yet.</p>}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('newDeadline')}</DialogTitle>
            <DialogDescription>Add a new deadline or task to your project.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div>
              <Label htmlFor="title">{t('title')}</Label>
              <Input id="title" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
            </div>
            <div>
              <Label>{t('dueDate')}</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant={"outline"} className={cn("w-full justify-start text-left font-normal", !newDate && "text-muted-foreground")}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {newDate ? format(newDate, "PPP") : <span>Pick a date</span>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0"><Calendar mode="single" selected={newDate} onSelect={setNewDate} initialFocus /></PopoverContent>
              </Popover>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsModalOpen(false)}>{t('cancel')}</Button>
            <Button onClick={handleAddDeadline} disabled={isSubmitting || !newTitle.trim()}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('addDeadline')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};