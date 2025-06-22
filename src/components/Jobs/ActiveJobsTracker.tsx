import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from '@/components/Auth/SessionContextProvider';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Loader2 } from 'lucide-react';
import { showSuccess, showError } from '@/utils/toast';
import { downloadImage } from '@/lib/utils';
import { ActiveJobsModal, UnifiedJob } from './ActiveJobsModal';

export const ActiveJobsTracker = () => {
  const { supabase, session } = useSession();
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);

  const { data: activeJobs, isLoading } = useQuery<UnifiedJob[]>({
    queryKey: ['activeJobs', session?.user?.id],
    queryFn: async () => {
      if (!session?.user) return [];
      console.log('[ActiveJobsTracker] Polling for ALL active jobs...');

      const comfyPromise = supabase
        .from('mira-agent-comfyui-jobs')
        .select('id, status, metadata')
        .eq('user_id', session.user.id)
        .in('status', ['queued', 'processing']);

      const vtoPromise = supabase
        .from('mira-agent-bitstudio-jobs')
        .select('id, status, source_person_image_url')
        .eq('user_id', session.user.id)
        .in('status', ['queued', 'processing']);

      const [comfyResult, vtoResult] = await Promise.all([comfyPromise, vtoPromise]);

      if (comfyResult.error) throw new Error(`ComfyUI jobs fetch failed: ${comfyResult.error.message}`);
      if (vtoResult.error) throw new Error(`VTO jobs fetch failed: ${vtoResult.error.message}`);

      const comfyJobs: UnifiedJob[] = (comfyResult.data || []).map(job => ({
        id: job.id,
        type: 'refine',
        status: job.status as 'queued' | 'processing',
        sourceImageUrl: job.metadata?.source_image_url,
      }));

      const vtoJobs: UnifiedJob[] = (vtoResult.data || []).map(job => ({
        id: job.id,
        type: 'vto',
        status: job.status as 'queued' | 'processing',
        sourceImageUrl: job.source_person_image_url,
      }));

      return [...comfyJobs, ...vtoJobs];
    },
    enabled: !!session?.user,
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
    retry: 2,
  });

  useEffect(() => {
    if (!session?.user?.id) return;

    const updateQueryData = (queryKey: any[], updatedJob: any) => {
      queryClient.setQueryData(queryKey, (oldData: any) => {
        if (!oldData) return oldData;
        const newPages = oldData.pages.map((page: any[]) =>
          page.map((job: any) =>
            job.id === updatedJob.id ? { ...job, ...updatedJob } : job
          )
        );
        return { ...oldData, pages: newPages };
      });
    };

    const handleComfyUpdate = (payload: any) => {
      console.log('[ActiveJobsTracker] Realtime ComfyUI event:', payload.eventType, payload.new.id);
      const updatedJob = payload.new;
      
      // Immediately update the UI by modifying the query cache
      updateQueryData(['recentRefinerJobs', session.user.id], updatedJob);
      queryClient.invalidateQueries({ queryKey: ['activeJobs', session.user.id] });

      if (payload.eventType === 'UPDATE' && (updatedJob.status === 'complete' || updatedJob.status === 'failed')) {
        if (updatedJob.status === 'complete' && updatedJob.final_result?.publicUrl) {
          showSuccess(`Upscale complete! Downloading now...`, { duration: 10000 });
          downloadImage(updatedJob.final_result.publicUrl, `upscaled-${updatedJob.id.substring(0, 8)}.png`);
        } else if (updatedJob.status === 'failed') {
          showError(`Upscale failed: ${updatedJob.error_message || 'Unknown error'}`);
        }
        // Invalidate gallery queries to ensure they refetch eventually
        queryClient.invalidateQueries({ queryKey: ['galleryAgentJobs'] });
      }
    };

    const handleVtoUpdate = (payload: any) => {
      console.log('[ActiveJobsTracker] Realtime VTO event:', payload.eventType, payload.new.id);
      const updatedJob = payload.new;

      // Immediately update the UI by modifying the query cache
      updateQueryData(['bitstudioJobs', session.user.id], updatedJob);
      queryClient.invalidateQueries({ queryKey: ['activeJobs', session.user.id] });

      if (payload.eventType === 'UPDATE' && (updatedJob.status === 'complete' || updatedJob.status === 'failed')) {
        if (updatedJob.status === 'complete' && updatedJob.final_image_url) {
          showSuccess(`Virtual Try-On complete! Downloading now...`, { duration: 10000 });
          downloadImage(updatedJob.final_image_url, `vto-${updatedJob.id.substring(0, 8)}.png`);
        } else if (updatedJob.status === 'failed') {
          showError(`Virtual Try-On failed: ${updatedJob.error_message || 'Unknown error'}`);
        }
        // Invalidate gallery queries to ensure they refetch eventually
        queryClient.invalidateQueries({ queryKey: ['galleryVtoJobs'] });
      }
    };

    const comfyChannel = supabase.channel('comfyui-jobs-tracker')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mira-agent-comfyui-jobs', filter: `user_id=eq.${session.user.id}` }, handleComfyUpdate)
      .subscribe();

    const vtoChannel = supabase.channel('bitstudio-jobs-tracker')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mira-agent-bitstudio-jobs', filter: `user_id=eq.${session.user.id}` }, handleVtoUpdate)
      .subscribe();

    return () => {
      supabase.removeChannel(comfyChannel);
      supabase.removeChannel(vtoChannel);
    };
  }, [supabase, session?.user?.id, queryClient]);

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
            <p>Click to view details. Your results will be downloaded automatically when ready.</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <ActiveJobsModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} jobs={activeJobs} />
    </>
  );
};