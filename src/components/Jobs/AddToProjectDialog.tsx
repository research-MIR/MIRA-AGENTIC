import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Loader2 } from 'lucide-react';
import { useSession } from '@/components/Auth/SessionContextProvider';
import { showError, showSuccess, showLoading, dismissToast } from '@/utils/toast';
import { useLanguage } from '@/context/LanguageContext';
import { useModalStore } from '@/store/modalStore';

interface Project {
  id: string;
  name: string;
}

interface AddToProjectDialogProps {
  projects: Project[];
}

export const AddToProjectDialog = ({ projects }: AddToProjectDialogProps) => {
  const { supabase, session } = useSession();
  const queryClient = useQueryClient();
  const { t } = useLanguage();
  const { isMoveToProjectModalOpen, movingJob, closeMoveToProjectModal } = useModalStore();

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [newProjectName, setNewProjectName] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!isMoveToProjectModalOpen) {
      setSelectedProjectId(null);
      setNewProjectName('');
      setIsLoading(false);
    }
  }, [isMoveToProjectModalOpen]);

  const handleMoveToProject = async () => {
    if (!movingJob || !selectedProjectId) return;
    setIsLoading(true);
    const toastId = showLoading("Moving chat...");
    try {
      const { error } = await supabase.rpc('update_job_project', { p_job_id: movingJob.id, p_project_id: selectedProjectId });
      if (error) throw error;
      dismissToast(toastId);
      showSuccess("Chat moved to project.");
      queryClient.invalidateQueries({ queryKey: ['jobHistory'] });
      queryClient.invalidateQueries({ queryKey: ['projectPreviews'] });
      queryClient.invalidateQueries({ queryKey: ['projectJobs', selectedProjectId] });
      closeMoveToProjectModal();
    } catch (err: any) {
      dismissToast(toastId);
      showError(`Failed to move chat: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateAndMove = async () => {
    if (!movingJob || !newProjectName.trim() || !session?.user) return;
    setIsLoading(true);
    const toastId = showLoading("Creating project and moving chat...");
    try {
      const { data: newProject, error: createError } = await supabase
        .from('mira-agent-projects')
        .insert({ name: newProjectName.trim(), user_id: session.user.id })
        .select('id')
        .single();
      
      if (createError) throw createError;
      if (!newProject) throw new Error("Failed to get new project ID.");

      const { error: moveError } = await supabase.rpc('update_job_project', { p_job_id: movingJob.id, p_project_id: newProject.id });
      if (moveError) throw moveError;

      dismissToast(toastId);
      showSuccess(`Chat moved to new project "${newProjectName.trim()}".`);
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['jobHistory'] });
      queryClient.invalidateQueries({ queryKey: ['projectPreviews'] });
      closeMoveToProjectModal();
    } catch (err: any) {
      dismissToast(toastId);
      showError(`Operation failed: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={isMoveToProjectModalOpen} onOpenChange={closeMoveToProjectModal}>
      <DialogContent className="bg-background text-foreground">
        <DialogHeader>
          <DialogTitle>{t('moveToProject')}</DialogTitle>
          <DialogDescription>
            {t('moveToProjectDescription')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="project-select">{t('selectAnExistingProject')}</Label>
            <Select onValueChange={setSelectedProjectId} value={selectedProjectId || ""} disabled={isLoading}>
              <SelectTrigger id="project-select">
                <SelectValue placeholder={t('chooseAProject')} />
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
            <span className="px-4 text-xs uppercase text-muted-foreground">{t('orCreateNew')}</span>
            <Separator className="flex-1" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-project-name">{t('newProjectName')}</Label>
            <div className="flex gap-2">
              <Input 
                id="new-project-name" 
                placeholder={t('newProjectPlaceholder')}
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                disabled={isLoading}
              />
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="outline" onClick={closeMoveToProjectModal} disabled={isLoading}>
            {t('cancel')}
          </Button>
          <div className="flex gap-2">
            <Button onClick={handleCreateAndMove} disabled={isLoading || !newProjectName.trim()}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('createAndMove')}
            </Button>
            <Button onClick={handleMoveToProject} disabled={isLoading || !selectedProjectId}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('move')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};