import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, Calendar as CalendarIcon, Loader2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { format, addDays } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { showError, showSuccess, showLoading, dismissToast } from "@/utils/toast";
import { useLanguage } from "@/context/LanguageContext";
import { cn } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

interface Deadline {
  id: string;
  title: string;
  due_date: string | null;
  status: 'pending' | 'completed';
  category: string | null;
}

const categories = ["VTO", "Shooting", "Model Creation", "General"];

export const ProjectDeadlines = ({ projectId }: { projectId: string }) => {
  const { supabase, session } = useSession();
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [dateInputMode, setDateInputMode] = useState<'date' | 'days'>('date');
  const [newDate, setNewDate] = useState<Date | undefined>(undefined);
  const [daysFromNow, setDaysFromNow] = useState<number | ''>('');
  const [newCategory, setNewCategory] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data: deadlines, isLoading } = useQuery<Deadline[]>({
    queryKey: ['projectDeadlines', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_deadlines')
        .select('*')
        .eq('project_id', projectId)
        .order('due_date', { ascending: true, nullsFirst: false });
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
      let finalDueDate: string | null = null;
      if (dateInputMode === 'date' && newDate) {
        finalDueDate = newDate.toISOString();
      } else if (dateInputMode === 'days' && daysFromNow && Number(daysFromNow) > 0) {
        finalDueDate = addDays(new Date(), Number(daysFromNow)).toISOString();
      }

      const { error } = await supabase.from('project_deadlines').insert({
        project_id: projectId,
        user_id: session.user.id,
        title: newTitle,
        due_date: finalDueDate,
        category: newCategory || null,
      });
      if (error) throw error;
      dismissToast(toastId);
      showSuccess("Deadline added.");
      queryClient.invalidateQueries({ queryKey: ['projectDeadlines', projectId] });
      setIsModalOpen(false);
      setNewTitle('');
      setNewDate(undefined);
      setDaysFromNow('');
      setNewCategory('');
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
              {deadlines && deadlines.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[50px]"></TableHead>
                      <TableHead>{t('title')}</TableHead>
                      <TableHead>{t('deadlineCategory')}</TableHead>
                      <TableHead>{t('dueDate')}</TableHead>
                      <TableHead className="text-right"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {deadlines.map(d => (
                      <TableRow key={d.id}>
                        <TableCell><Checkbox checked={d.status === 'completed'} onCheckedChange={() => toggleStatus(d)} /></TableCell>
                        <TableCell className={cn("font-medium", d.status === 'completed' && "line-through text-muted-foreground")}>{d.title}</TableCell>
                        <TableCell>{d.category && <Badge variant="secondary">{d.category}</Badge>}</TableCell>
                        <TableCell className="text-muted-foreground text-xs">{d.due_date ? format(new Date(d.due_date), 'PPP') : 'No date'}</TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDelete(d.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">No deadlines yet.</p>
              )}
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
              <Label>{t('deadlineCategory')}</Label>
              <Select onValueChange={setNewCategory}>
                <SelectTrigger>
                  <SelectValue placeholder={t('selectCategory')} />
                </SelectTrigger>
                <SelectContent>
                  {categories.map(cat => <SelectItem key={cat} value={cat}>{cat}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t('dueDate')}</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant={"outline"} className={cn("w-full justify-start text-left font-normal", !newDate && "text-muted-foreground", dateInputMode === 'days' && 'opacity-50')} disabled={dateInputMode === 'days'}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {newDate ? format(newDate, "PPP") : <span>Pick a date</span>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0"><Calendar mode="single" selected={newDate} onSelect={(date) => { setNewDate(date); setDateInputMode('date'); setDaysFromNow(''); }} initialFocus /></PopoverContent>
              </Popover>
            </div>
            <div className="relative flex items-center">
              <div className="flex-grow border-t border-muted"></div>
              <span className="flex-shrink mx-4 text-muted-foreground text-xs">{t('orSetDaysFromToday')}</span>
              <div className="flex-grow border-t border-muted"></div>
            </div>
            <div>
              <Label htmlFor="days">{t('days')}</Label>
              <Input id="days" type="number" value={daysFromNow} onChange={(e) => { setDaysFromNow(Number(e.target.value)); setDateInputMode('days'); setNewDate(undefined); }} placeholder="e.g., 7" />
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