import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useSession } from '@/components/Auth/SessionContextProvider';
import { showError, showSuccess, showLoading, dismissToast } from '@/utils/toast';
import { Skeleton } from '@/components/ui/skeleton';
import { CheckCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SecureImageDisplay } from '@/components/VTO/SecureImageDisplay';
import { BitStudioJob } from '@/types/vto';

interface AddVtoJobsModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
}

export const AddVtoJobsModal = ({ isOpen, onClose, projectId }: AddVtoJobsModalProps) => {
  const { supabase, session } = useSession();
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isAdding, setIsAdding] = useState(false);

  const { data: unassignedJobs, isLoading } = useQuery<BitStudioJob[]>({
    queryKey: ['unassignedVtoJobs', session?.user?.id],
    queryFn: async () => {
      if (!session?.user) return [];
      const { data, error } = await supabase.rpc('get_unassigned_vto_jobs', { p_user_id: session.user.id });
      if (error) throw error;
      return data;
    },
    enabled: isOpen && !!session?.user,
  });

  const toggleSelection = (id: string) => {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) newSet.delete(id);
      else newSet.add(id);
      return newSet;
    });
  };

  const handleAddJobs = async () => {
    if (selectedIds.size === 0 || !session?.user) return;
    setIsAdding(true);
    const toastId = showLoading(`Adding ${selectedIds.size} job(s)...`);
    try {
      const { error } = await supabase.rpc('assign_vto_jobs_to_project', {
        p_job_ids: Array.from(selectedIds),
        p_project_id: projectId,
        p_user_id: session.user.id
      });
      if (error) throw error;
      dismissToast(toastId);
      showSuccess(`${selectedIds.size} job(s) added to project.`);
      queryClient.invalidateQueries({ queryKey: ['projectVtoJobs', projectId] });
      queryClient.invalidateQueries({ queryKey: ['unassignedVtoJobs'] });
      onClose();
    } catch (err: any) {
      dismissToast(toastId);
      showError(`Failed to add jobs: ${err.message}`);
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Add VTO Jobs to Project</DialogTitle>
          <DialogDescription>Select from your unassigned Virtual Try-On jobs to link them to this project.</DialogDescription>
        </DialogHeader>
        <ScrollArea className="h-96 my-4">
          <div className="grid grid-cols-4 gap-4 pr-4">
            {isLoading ? (
              [...Array(8)].map((_, i) => <Skeleton key={i} className="aspect-square w-full" />)
            ) : unassignedJobs && unassignedJobs.length > 0 ? (
              unassignedJobs.map(job => {
                const isSelected = selectedIds.has(job.id);
                return (
                  <div key={job.id} className="relative cursor-pointer" onClick={() => toggleSelection(job.id)}>
                    <SecureImageDisplay imageUrl={job.final_image_url || job.source_person_image_url} alt={`VTO Job ${job.id}`} />
                    {isSelected && (
                      <div className="absolute inset-0 bg-black/60 flex items-center justify-center rounded-md">
                        <CheckCircle className="h-8 w-8 text-white" />
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              <p className="col-span-4 text-center text-muted-foreground">No unassigned VTO jobs found.</p>
            )}
          </div>
        </ScrollArea>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleAddJobs} disabled={isAdding || selectedIds.size === 0}>
            {isAdding && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Add Selected ({selectedIds.size})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};