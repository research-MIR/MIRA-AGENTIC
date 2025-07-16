import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSession } from '@/components/Auth/SessionContextProvider';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { AlertTriangle, CheckCircle, Loader2, XCircle } from 'lucide-react';
import { useImagePreview } from '@/context/ImagePreviewContext';
import { SecureImageDisplay } from './SecureImageDisplay';
import { BitStudioJob } from '@/types/vto';

interface VtoPackJob {
  id: string;
  created_at: string;
  metadata: {
    total_pairs: number;
    engine?: 'google' | 'bitstudio';
  };
}

interface RecentVtoPacksProps {
  engine: 'google' | 'bitstudio';
}

export const RecentVtoPacks = ({ engine }: RecentVtoPacksProps) => {
  const { supabase, session } = useSession();
  const { showImage } = useImagePreview();

  const { data: packs, isLoading: isLoadingPacks, error: packsError } = useQuery<VtoPackJob[]>({
    queryKey: ['recentVtoPacks', session?.user?.id],
    queryFn: async () => {
      if (!session?.user) return [];
      const { data, error } = await supabase
        .from('mira-agent-vto-packs-jobs')
        .select('*')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      return data;
    },
    enabled: !!session?.user,
  });

  const packIds = useMemo(() => packs?.map(p => p.id) || [], [packs]);

  const { data: childJobs, isLoading: isLoadingChildren } = useQuery<BitStudioJob[]>({
    queryKey: ['vtoPackChildJobs', packIds],
    queryFn: async () => {
      if (packIds.length === 0) return [];
      const { data, error } = await supabase
        .from('mira-agent-bitstudio-jobs')
        .select('*')
        .in('vto_pack_job_id', packIds);
      if (error) throw error;
      return data as BitStudioJob[];
    },
    enabled: packIds.length > 0,
  });

  const groupedJobs = useMemo(() => {
    if (!childJobs) return {};
    return childJobs.reduce((acc, job) => {
      const packId = job.vto_pack_job_id;
      if (packId) {
        if (!acc[packId]) acc[packId] = [];
        acc[packId].push(job);
      }
      return acc;
    }, {} as Record<string, BitStudioJob[]>);
  }, [childJobs]);

  const filteredPacks = useMemo(() => {
    if (!packs) return [];
    return packs.filter(pack => (pack.metadata?.engine || 'bitstudio') === engine);
  }, [packs, engine]);

  if (isLoadingPacks) {
    return <div className="space-y-4"><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /></div>;
  }

  if (packsError) {
    return <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Error</AlertTitle><AlertDescription>{packsError.message}</AlertDescription></Alert>;
  }

  if (!filteredPacks || filteredPacks.length === 0) {
    return <p className="text-center text-muted-foreground py-8">No recent batch jobs found for the selected engine.</p>;
  }

  return (
    <Accordion type="single" collapsible className="w-full space-y-4">
      {filteredPacks.map(pack => {
        const jobsInPack = groupedJobs[pack.id] || [];
        const completedJobs = jobsInPack.filter(j => j.status === 'complete');
        const failedJobs = jobsInPack.filter(j => j.status === 'failed');
        const inProgress = jobsInPack.length < (pack.metadata?.total_pairs || jobsInPack.length) || jobsInPack.some(j => j.status === 'processing' || j.status === 'queued');

        return (
          <AccordionItem key={pack.id} value={pack.id} className="border rounded-md">
            <AccordionTrigger className="p-4 hover:no-underline">
              <div className="flex justify-between items-center w-full">
                <div className="text-left">
                  <p className="font-semibold">Batch from {new Date(pack.created_at).toLocaleString()}</p>
                  <p className="text-sm text-muted-foreground">
                    {completedJobs.length} / {pack.metadata?.total_pairs || jobsInPack.length} completed
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {inProgress && <Loader2 className="h-5 w-5 animate-spin text-primary" />}
                  {failedJobs.length > 0 && <XCircle className="h-5 w-5 text-destructive" />}
                  {completedJobs.length > 0 && !inProgress && <CheckCircle className="h-5 w-5 text-green-600" />}
                </div>
              </div>
            </AccordionTrigger>
            <AccordionContent className="p-4 pt-0">
              {isLoadingChildren ? <Loader2 className="h-6 w-6 animate-spin" /> : (
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
                  {jobsInPack.map(job => (
                    <div key={job.id} className="aspect-square relative group">
                      <SecureImageDisplay 
                        imageUrl={job.final_image_url || job.source_person_image_url || null} 
                        alt="Job result" 
                        onClick={() => job.final_image_url && showImage({ images: [{ url: job.final_image_url }], currentIndex: 0 })}
                      />
                      {job.status === 'complete' && <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity" />}
                      {job.status === 'failed' && <div className="absolute inset-0 bg-destructive/70 flex items-center justify-center"><XCircle className="h-8 w-8 text-destructive-foreground" /></div>}
                      {(job.status === 'processing' || job.status === 'queued') && <div className="absolute inset-0 bg-black/70 flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-white" /></div>}
                    </div>
                  ))}
                </div>
              )}
            </AccordionContent>
          </AccordionItem>
        )
      })}
    </Accordion>
  );
};