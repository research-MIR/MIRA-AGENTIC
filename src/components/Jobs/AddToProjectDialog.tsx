import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
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
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!isMoveToProjectModalOpen) {
      setSelectedProjectId(null);
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

  return (
    <Dialog open={isMoveToProjectModalOpen} onOpenChange={closeMoveToProjectModal}>
      <DialogContent className="bg-background text-foreground">
        <DialogHeader>
          <DialogTitle>{t('moveToProject')}</DialogTitle>
          <DialogDescription>
            Select an existing project to move this chat into. To create a new project, please go to the 'Clients' page.
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
        </div>
        <DialogFooter className="gap-2 sm:justify-end">
          <Button variant="outline" onClick={closeMoveToProjectModal} disabled={isLoading}>
            {t('cancel')}
          </Button>
          <Button onClick={handleMoveToProject} disabled={isLoading || !selectedProjectId}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('move')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};