import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from './Auth/SessionContextProvider';
import { Button } from './ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { Loader2 } from 'lucide-react';
import { RealtimeChannel } from '@supabase/supabase-js';
import { showSuccess, showError } from '@/utils/toast';
import { downloadImage } from '@/lib/utils';
import { ActiveJobsModal } from './ActiveJobsModal';

interface ComfyJob {
  id: string;
  status: 'queued' | 'processing' | 'complete' | 'failed';
  final_result?: { publicUrl: string };
  error_message?: string;
  metadata?: {
    source_image_url?: string;
  };
}

export const ActiveJobsTracker = () => {
  const { supabase, session } = useSession();
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);

  const { data: activeJobs, isLoading } = useQuery<ComfyJob[]>({
    queryKey: ['activeComfyJobs'],
    queryFn: async () => {
      if (!session?.user) return [];
      const { data, error } = await supabase
        .from('mira-agent-comfyui-jobs')
        .select('*')
        .eq('user_id', session.user.id)
        .in('status', ['queued', 'processing']);
      if (error) {
        console.error("Error fetching active jobs:", error);
        return [];
      }
      return data;
    },
    enabled: !!session?.user,
    refetchInterval: 60000, // Poll every minute as a fallback
  });

  useEffect(() => {
    if (!activeJobs || activeJobs.length === 0) return;

    const channels: RealtimeChannel[] = [];
    activeJobs.forEach(job => {
      const channel = supabase.channel(`comfyui-job-tracker-${job.id}`)
        .on<ComfyJob>(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'mira-agent-comfyui-jobs', filter: `id=eq.${job.id}` },
          (payload) => {
            const updatedJob = payload.new as ComfyJob;
            if (updatedJob.status === 'complete' || updatedJob.status === 'failed') {
              if (updatedJob.status === 'complete' && updatedJob.final_result?.publicUrl) {
                showSuccess(`Upscale complete! Downloading now...`);
                downloadImage(updatedJob.final_result.publicUrl, `upscaled-${job.id.substring(0, 8)}.png`);
              } else if (updatedJob.status === 'failed') {
                showError(`Upscale failed: ${updatedJob.error_message || 'Unknown error'}`);
              }
              
              // Optimistically update the UI by removing the completed job from the cache
              queryClient.setQueryData(['activeComfyJobs'], (oldData: ComfyJob[] | undefined) => {
                return oldData ? oldData.filter(j => j.id !== updatedJob.id) : [];
              });

              // Invalidate gallery query to show the new image
              queryClient.invalidateQueries({ queryKey: ['generatedImages'] });
            }
          }
        )
        .subscribe();
      channels.push(channel);
    });

    return () => {
      channels.forEach(channel => supabase.removeChannel(channel));
    };
  }, [activeJobs, supabase, queryClient]);

  if (isLoading || !activeJobs || activeJobs.length === 0) {
    return null;
  }

  return (
    <>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" className="w-full justify-start gap-2 text-primary" onClick={() => setIsModalOpen(true)}>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{activeJobs.length} job(s) in progress</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Click to view details. Your upscaled images will be downloaded automatically when ready.</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <ActiveJobsModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} jobs={activeJobs} />
    </>
  );
};