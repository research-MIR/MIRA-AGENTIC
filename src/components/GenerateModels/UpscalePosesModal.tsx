import { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CheckCircle, Loader2, Wand2 } from 'lucide-react';
import { useSession } from '@/components/Auth/SessionContextProvider';
import { showError, showSuccess, showLoading, dismissToast } from '@/utils/toast';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/context/LanguageContext';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuPortal, DropdownMenuSubContent } from "@/components/ui/dropdown-menu";

interface Pose {
  final_url: string;
  is_upscaled?: boolean;
  status: string;
}

interface Job {
  id: string;
  final_posed_images?: Pose[];
}

interface UpscalePosesModalProps {
  isOpen: boolean;
  onClose: () => void;
  jobs: Job[];
  packId: string;
}

export const UpscalePosesModal = ({ isOpen, onClose, jobs, packId }: UpscalePosesModalProps) => {
  const { supabase } = useSession();
  const queryClient = useQueryClient();
  const { t } = useLanguage();
  const [selectedPoseUrls, setSelectedPoseUrls] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);

  const posesReadyForUpscale = useMemo(() => {
    if (!jobs) return [];
    return jobs.flatMap(job => 
      (job.final_posed_images || [])
        .filter(pose => pose.status === 'complete' && !pose.is_upscaled)
        .map(pose => ({ ...pose, jobId: job.id }))
    );
  }, [jobs]);

  const toggleSelection = (url: string) => {
    setSelectedPoseUrls(prev => {
      const newSet = new Set(prev);
      if (newSet.has(url)) {
        newSet.delete(url);
      } else {
        newSet.add(url);
      }
      return newSet;
    });
  };

  const handleUpscale = async (urlsToProcess: string[], factor: number) => {
    if (urlsToProcess.length === 0) return;
    setIsLoading(true);
    const toastId = showLoading(`Starting upscale for ${urlsToProcess.length} poses...`);

    try {
      const jobToUpdate = jobs.find(job => 
        job.final_posed_images?.some(pose => urlsToProcess.includes(pose.final_url))
      );

      if (!jobToUpdate) throw new Error("Could not find the parent job for the selected poses.");

      const { error } = await supabase.functions.invoke('start_poses_upscaling', {
        body: {
          p_job_id: jobToUpdate.id,
          p_pose_urls: urlsToProcess,
          p_upscale_factor: factor
        }
      });

      if (error) throw error;

      dismissToast(toastId);
      showSuccess(`${urlsToProcess.length} poses have been queued for upscaling.`);
      queryClient.invalidateQueries({ queryKey: ['modelsForPack', packId] });
      onClose();
    } catch (err: any) {
      dismissToast(toastId);
      showError(`Failed to start upscaling: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Upscale & Prepare Poses for VTO</DialogTitle>
          <DialogDescription>Select the poses you want to upscale to high resolution. This prepares them for use in the Virtual Try-On tool.</DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh] my-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pr-4">
            {posesReadyForUpscale.map((pose) => {
              const isSelected = selectedPoseUrls.has(pose.final_url);
              return (
                <div key={pose.final_url} className="relative cursor-pointer" onClick={() => toggleSelection(pose.final_url)}>
                  <img src={pose.final_url} alt="Pose to upscale" className="w-full h-full object-cover rounded-md" />
                  {isSelected && (
                    <div className="absolute inset-0 bg-black/60 flex items-center justify-center rounded-md">
                      <CheckCircle className="h-8 w-8 text-white" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {posesReadyForUpscale.length === 0 && (
            <p className="text-center text-muted-foreground py-8">All generated poses have been upscaled.</p>
          )}
        </ScrollArea>
        <DialogFooter className="gap-2 sm:justify-between">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" disabled={isLoading || posesReadyForUpscale.length === 0}>
                {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
                Upscale All ({posesReadyForUpscale.length})
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={() => handleUpscale(posesReadyForUpscale.map(p => p.final_url), 1.5)}>Upscale x1.5</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => handleUpscale(posesReadyForUpscale.map(p => p.final_url), 2.0)}>Upscale x2.0</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => handleUpscale(posesReadyForUpscale.map(p => p.final_url), 2.5)}>Upscale x2.5</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button disabled={isLoading || selectedPoseUrls.size === 0}>
                {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
                Upscale Selected ({selectedPoseUrls.size})
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={() => handleUpscale(Array.from(selectedPoseUrls), 1.5)}>Upscale x1.5</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => handleUpscale(Array.from(selectedPoseUrls), 2.0)}>Upscale x2.0</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => handleUpscale(Array.from(selectedPoseUrls), 2.5)}>Upscale x2.5</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};