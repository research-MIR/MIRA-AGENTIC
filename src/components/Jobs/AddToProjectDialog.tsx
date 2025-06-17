import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { useSession } from '@/components/Auth/SessionContextProvider';
import { showError, showSuccess } from '@/utils/toast';

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
  const { supabase } = useSession();
  const queryClient = useQueryClient();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [isMoving, setIsMoving] = useState(false);

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

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move Chat to Project</DialogTitle>
        </DialogHeader>
        <div className="py-4">
          <Label htmlFor="project-select">Select a project</Label>
          <Select onValueChange={setSelectedProjectId}>
            <SelectTrigger id="project-select">
              <SelectValue placeholder="Choose a project..." />
            </SelectTrigger>
            <SelectContent>
              {projects.map(p => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleMoveToProject} disabled={isMoving || !selectedProjectId}>
            {isMoving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Move
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};