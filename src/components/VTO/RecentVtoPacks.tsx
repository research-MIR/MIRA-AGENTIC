import { useMemo, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from '@/components/Auth/SessionContextProvider';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { AlertTriangle, CheckCircle, Loader2, XCircle } from 'lucide-react';
import { useImagePreview } from '@/context/ImagePreviewContext';
import { SecureImageDisplay } from './SecureImageDisplay';
import { BitStudioJob } from '@/types/vto';
import { RealtimeChannel } from '@supabase/supabase-js';

interface VtoPackSummary {
  pack_id: string;
  created_at: string;
  metadata: {
    total_pairs: number;
    engine?: 'google' | 'bitstudio';
  };
  total_jobs: number;
  completed_jobs: number;
  failed_jobs: number;
  in_progress_jobs: number;
}

const VtoPackDetailView = ({ packId, isOpen }: { packId: string, isOpen: boolean }) => {
  const { supabase, session } = useSession();
  const { showImage } = useImagePreview();

  const { data: childJobs, isLoading } = useQuery<BitStudioJob[]>({
    queryKey: ['vtoPackChildJobs', packId],
    queryFn: async () => {
      if (!session?.user) return [];
      const { data, error } = await supabase
        .from('mira-agent-bitstudio-jobs')
        .select('*')
        .eq('vto_pack_job_id', packId);
      if (error) throw error;
      return data as BitStudioJob[];
    },
    enabled: isOpen, // Lazy-load trigger
  });

  if (isLoading) {
    return <div className="flex justify-center p-4"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {childJobs?.map(job => (
        <div 
          key={job.id} 
          className="w-32 h-32 relative group cursor-pointer"
          onClick={() => job.final_image_url && showImage({ images: [{ url: job.final_image_url }], currentIndex: 0 })}
        >
          <SecureImageDisplay 
            imageUrl={job.final_image_url || job.source_person_image_url || null} 
            alt="Job result" 
            className="w-full h-full object-cover rounded-md"
          />
          {job.status === 'complete' && <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity" />}
          {job.status === 'failed' && <div className="absolute inset-0 bg-destructive/70 flex items-center justify-center rounded-md"><XCircle className="h-8 w-8 text-destructive-foreground" /></div>}
          {(job.status === 'processing' || job.status === 'queued') && <div className="absolute inset-0 bg-black/70 flex items-center justify-center rounded-md"><Loader2 className="h-8 w-8 animate-spin text-white" /></div>}
        </div>
      ))}
    </div>
  );
};

export const RecentVtoPacks = () => {
  const { supabase, session } = useSession();
  const queryClient = useQueryClient();
  const [openPackId, setOpenPackId] = useState<string | null>(null);

  const { data: packs, isLoading: isLoadingPacks, error: packsError } = useQuery<VtoPackSummary[]>({
    queryKey: ['recentVtoPackSummaries', session?.user?.id],
    queryFn: async () => {
      if (!session?.user) return [];
      const { data, error } = await supabase.rpc('get_vto_pack_summaries', { p_user_id: session.user.id });
      if (error) throw error;
      return data;
    },
    enabled: !!session?.user,
  });

  useEffect(() => {
    if (!session?.user?.id) return;

    const channel: RealtimeChannel = supabase
      .channel(`vto-pack-summary-tracker-${session.user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'mira-agent-bitstudio-jobs', filter: `user_id=eq.${session.user.id}` },
        (payload) => {
          if (payload.new.vto_pack_job_id) {
            console.log('[RecentVtoPacks] Realtime update received, invalidating summaries.');
            queryClient.invalidateQueries({ queryKey: ['recentVtoPackSummaries', session.user.id] });
            queryClient.invalidateQueries({ queryKey: ['vtoPackChildJobs', payload.new.vto_pack_job_id] });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [session?.user?.id, supabase, queryClient]);

  if (isLoadingPacks) {
    return <div className="space-y-4"><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /></div>;
  }

  if (packsError) {
    return <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Error</AlertTitle><AlertDescription>{packsError.message}</AlertDescription></Alert>;
  }

  if (!packs || packs.length === 0) {
    return <p className="text-center text-muted-foreground py-8">No recent batch jobs found.</p>;
  }

  return (
    <Accordion type="single" collapsible className="w-full space-y-4" onValueChange={setOpenPackId}>
      {packs.map(pack => {
        const inProgress = pack.in_progress_jobs > 0;
        const hasFailures = pack.failed_jobs > 0;
        const isComplete = !inProgress && pack.total_jobs > 0;

        return (
          <AccordionItem key={pack.pack_id} value={pack.pack_id} className="border rounded-md">
            <AccordionTrigger className="p-4 hover:no-underline">
              <div className="flex justify-between items-center w-full">
                <div className="text-left">
                  <p className="font-semibold">Batch from {new Date(pack.created_at).toLocaleString()}</p>
                  <p className="text-sm text-muted-foreground">
                    {pack.completed_jobs} / {pack.metadata?.total_pairs || pack.total_jobs} completed
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {inProgress && <Loader2 className="h-5 w-5 animate-spin text-primary" />}
                  {hasFailures && <XCircle className="h-5 w-5 text-destructive" />}
                  {isComplete && !hasFailures && <CheckCircle className="h-5 w-5 text-green-600" />}
                </div>
              </div>
            </AccordionTrigger>
            <AccordionContent className="p-4 pt-0">
              <VtoPackDetailView packId={pack.pack_id} isOpen={openPackId === pack.pack_id} />
            </AccordionContent>
          </AccordionItem>
        )
      })}
    </Accordion>
  );
};