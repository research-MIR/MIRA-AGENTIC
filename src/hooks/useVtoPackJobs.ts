import { useQuery } from '@tanstack/react-query';
import { useSession } from '@/components/Auth/SessionContextProvider';
import { BitStudioJob } from '@/types/vto';

export const useVtoPackJobs = (packId: string | null, enabled: boolean = true) => {
  const { supabase, session } = useSession();

  return useQuery<BitStudioJob[]>({
    queryKey: ['vtoPackJobs', packId],
    queryFn: async () => {
      if (!session?.user || !packId) return [];
      
      // Fetch standard bitstudio jobs
      const { data: bitstudioJobs, error: bitstudioError } = await supabase
          .from('mira-agent-bitstudio-jobs')
          .select('*')
          .eq('vto_pack_job_id', packId);
      if (bitstudioError) throw bitstudioError;

      // Check if it's a refinement pack
      const { data: packMeta, error: packError } = await supabase
          .from('mira-agent-vto-packs-jobs')
          .select('metadata')
          .eq('id', packId)
          .single();
      if (packError) throw packError;

      if (packMeta.metadata?.refinement_of_pack_id) {
          const { data: batchJobs, error: batchError } = await supabase
              .from('mira-agent-batch-inpaint-jobs')
              .select('id')
              .eq('metadata->>refinement_vto_pack_id', packId);
          if (batchError) throw batchError;

          if (batchJobs && batchJobs.length > 0) {
              const batchJobIds = batchJobs.map(j => j.id);
              const { data: pairJobs, error: pairError } = await supabase
                  .from('mira-agent-batch-inpaint-pair-jobs')
                  .select('*')
                  .in('batch_job_id', batchJobIds);
              if (pairError) throw pairError;

              const processedPairJobIds = new Set((bitstudioJobs || []).map(j => j.batch_pair_job_id).filter(Boolean));
              
              const precursorJobs = (pairJobs || [])
                  .filter(job => !processedPairJobIds.has(job.id))
                  .map(job => ({
                      id: job.id,
                      status: job.status,
                      source_person_image_url: job.source_person_image_url,
                      source_garment_image_url: job.source_garment_image_url,
                      final_image_url: job.final_image_url,
                      error_message: job.error_message,
                      mode: 'inpaint',
                      created_at: job.created_at,
                      metadata: job.metadata,
                  } as BitStudioJob));
              
              return [...(bitstudioJobs || []), ...precursorJobs].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
          }
      }
      
      return (bitstudioJobs || []).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    },
    enabled: !!session?.user && !!packId && enabled,
  });
};