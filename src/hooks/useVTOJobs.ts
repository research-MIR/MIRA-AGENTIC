import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from '@/components/Auth/SessionContextProvider';
import { BitStudioJob } from '@/types/vto';
import { RealtimeChannel } from '@supabase/supabase-js';

export const useVTOJobs = () => {
  const { supabase, session } = useSession();
  const queryClient = useQueryClient();

  const { data: jobs, isLoading, error } = useQuery<BitStudioJob[]>({
    queryKey: ['bitstudioJobs', session?.user?.id],
    queryFn: async () => {
      if (!session?.user) return [];

      const bitstudioPromise = supabase
        .from('mira-agent-bitstudio-jobs')
        .select('*')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false })
        .limit(50);

      const batchPairPromise = supabase
        .from('mira-agent-batch-inpaint-pair-jobs')
        .select('*')
        .eq('user_id', session.user.id)
        .in('status', ['pending', 'processing', 'segmenting', 'delegated', 'failed', 'permanently_failed'])
        .order('created_at', { ascending: false })
        .limit(20);

      const [bitstudioResult, batchPairResult] = await Promise.all([bitstudioPromise, batchPairPromise]);

      if (bitstudioResult.error) throw bitstudioResult.error;
      if (batchPairResult.error) throw batchPairResult.error;

      const bitstudioJobs: BitStudioJob[] = (bitstudioResult.data as any[]) || [];
      const batchPairJobs = batchPairResult.data || [];

      const processedPairJobIds = new Set(bitstudioJobs.map(j => j.batch_pair_job_id).filter(Boolean));

      const pendingProJobs = batchPairJobs
        .filter(job => !processedPairJobIds.has(job.id))
        .map(job => ({
          id: job.id,
          status: job.status as BitStudioJob['status'],
          source_person_image_url: job.source_person_image_url,
          source_garment_image_url: job.source_garment_image_url,
          final_image_url: undefined,
          error_message: job.error_message,
          mode: 'inpaint',
          created_at: job.created_at,
          metadata: {
            prompt_used: job.prompt_appendix
          }
        } as BitStudioJob));

      const unifiedJobs: BitStudioJob[] = [...bitstudioJobs, ...pendingProJobs];

      unifiedJobs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      return unifiedJobs;
    },
    enabled: !!session?.user,
  });

  useEffect(() => {
    if (!session?.user?.id) return;

    const handleUpdate = (payload: any) => {
      console.log(`[useVTOJobs] Realtime event received from table: ${payload.table}. Invalidating queries.`);
      queryClient.invalidateQueries({ queryKey: ['bitstudioJobs', session.user.id] });
    };

    const channel: RealtimeChannel = supabase
      .channel(`vto-jobs-tracker-${session.user.id}`)
      .on<BitStudioJob>(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'mira-agent-bitstudio-jobs', filter: `user_id=eq.${session.user.id}` },
        handleUpdate
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'mira-agent-batch-inpaint-pair-jobs', filter: `user_id=eq.${session.user.id}` },
        handleUpdate
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [session?.user?.id, supabase, queryClient]);

  return { jobs, isLoading, error };
};