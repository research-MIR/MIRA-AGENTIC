import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, X, RefreshCw } from "lucide-react";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { useQueryClient } from "@tanstack/react-query";
import { showError } from "@/utils/toast";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface ComfyJob {
  id: string;
  status: 'queued' | 'processing' | 'complete' | 'failed';
  metadata?: {
    source_image_url?: string;
  };
}

interface ActiveJobsModalProps {
  isOpen: boolean;
  onClose: () => void;
  jobs: ComfyJob[];
}

export const ActiveJobsModal = ({ isOpen, onClose, jobs }: ActiveJobsModalProps) => {
  const { supabase, session } = useSession();
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleCancelJob = async (jobId: string) => {
    try {
      const { error } = await supabase.rpc('cancel_comfyui_job_by_id', { p_job_id: jobId });
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['activeComfyJobs'] });
    } catch (err: any) {
      showError(`Failed to cancel job: ${err.message}`);
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['activeComfyJobs', session?.user?.id] });
    // A short delay to give visual feedback
    setTimeout(() => setIsRefreshing(false), 500);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <div className="flex justify-between items-center">
            <div>
              <DialogTitle>Active Background Jobs</DialogTitle>
              <DialogDescription>
                These jobs are running in the background. Your results will be downloaded automatically when complete.
              </DialogDescription>
            </div>
            <Button variant="outline" size="icon" onClick={handleRefresh} disabled={isRefreshing}>
              <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
            </Button>
          </div>
        </DialogHeader>
        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
          {jobs.length > 0 ? jobs.map((job) => (
            <Card key={job.id}>
              <CardContent className="p-3 flex items-center gap-4">
                {job.metadata?.source_image_url && (
                  <img
                    src={job.metadata.source_image_url}
                    alt="Source"
                    className="w-16 h-16 object-cover rounded-md bg-muted"
                  />
                )}
                <div className="flex-1">
                  <p className="text-sm font-medium capitalize flex items-center">
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {job.status}...
                  </p>
                  <p className="text-xs text-muted-foreground truncate">Job ID: {job.id}</p>
                </div>
                <Button variant="ghost" size="icon" onClick={() => handleCancelJob(job.id)}>
                  <X className="h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          )) : (
            <p className="text-center text-muted-foreground py-8">No active jobs.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};