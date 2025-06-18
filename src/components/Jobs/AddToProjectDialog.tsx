import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { useSession } from '@/components/Auth/SessionContextProvider';
import { showError, showSuccess, showLoading, dismissToast } from '@/utils/toast';
import { useLanguage } from '@/context/LanguageContext';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';

interface Project {
  id: string;
  name: string;
}

interface Job {
  id: string;
}

interface AddToProjectDialogProps {
  job: Job | null;
  projects: Project[];
  isOpen: boolean;
  onClose: () => void;
}

export const AddToProjectDialog = ({ job, projects, isOpen, onClose }: AddToProjectDialogProps) => {
  const { supabase, session } = useSession();
  const queryClient = useQueryClient();
  const { t } = useLanguage();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [isMoving, setIsMoving] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setSelectedProjectId(null);
      setNewProjectName('');
      setIsMoving(false);
      setIsCreating(false);
    }
  }, [isOpen]);

  const handleMoveToProject = async () => {
    if (!job || !selectedProjectId) return;
    setIsMoving(true);
    try {
      const { error } = await supabase
        .from('mira-agent-jobs')
        .update({ project_id: selectedProjectId })
        .eq('id', job.id);
      if (error) throw error;
      showSuccess("Chat moved to project.");
      queryClient.invalidateQueries({ queryKey: ['jobHistory'] });
      onClose();
    } catch (err: any) {
      showError(`Failed to move chat: ${err.message}`);
    } finally {
      setIsMoving(false);
    }
  };

  const handleCreateAndMove = async () => {
    if (!job || !newProjectName.trim() || !session?.user) return;
    setIsCreating(true);
    const toastId = showLoading("Creating project...");
    try {
      const { data: newProject, error: createError } = await supabase
        .from('projects')
        .insert({ name: newProjectName.trim(), user_id: session.user.id })
        .select('id')
        .single();
      
      if (createError) throw createError;
      if (!newProject) throw new Error("Failed to get new project ID.");

      dismissToast(toastId);
      const moveToastId = showLoading("Moving chat...");

      const { error: moveError } = await supabase
        .from('mira-agent-jobs')
        .update({ project_id: newProject.id })
        .eq('id', job.id);
      
      if (moveError) throw moveError;

      dismissToast(moveToastId);
      showSuccess(`Chat moved to new project "${newProjectName.trim()}".`);
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['jobHistory'] });
      onClose();

    } catch (err: any) {
      dismissToast(toastId);
      showError(`Operation failed: ${err.message}`);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.moveToProject}</DialogTitle>
        </DialogHeader>
        <div className="py-4 space-y-4">
          <div>
            <Label htmlFor="project-select">{t.selectAnExistingProject}</Label>
            <Select onValueChange={setSelectedProjectId} value={selectedProjectId || ""}>
              <SelectTrigger id="project-select">
                <SelectValue placeholder={t.chooseAProject} />
              </SelectTrigger>
              <SelectContent>
                {projects.map(p => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center">
            <Separator className="flex-1" />
            <span className="px-2 text-xs text-muted-foreground">{t.orCreateNew}</span>
            <Separator className="flex-1" />
          </div>
          <div>
            <Label htmlFor="new-project-name">{t.newProjectName}</Label>
            <div className="flex gap-2 mt-1">
              <Input 
                id="new-project-name" 
                placeholder="e.g. Marketing Campaign Q3"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                disabled={isCreating}
              />
              <Button onClick={handleCreateAndMove} disabled={isCreating || !newProjectName.trim()}>
                {isCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t.createAndMove}
              </Button>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{t.cancel}</Button>
          <Button onClick={handleMoveToProject} disabled={isMoving || !selectedProjectId}>
            {isMoving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t.move}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};