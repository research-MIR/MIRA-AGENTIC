import { useMemo, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from '@/components/Auth/SessionContextProvider';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { AlertTriangle, CheckCircle, Loader2, XCircle, Download, HardDriveDownload } from 'lucide-react';
import { useImagePreview } from '@/context/ImagePreviewContext';
import { SecureImageDisplay } from './SecureImageDisplay';
import { BitStudioJob } from '@/types/vto';
import { RealtimeChannel } from '@supabase/supabase-js';
import { Button } from '../ui/button';
import { showError, showLoading, dismissToast, showSuccess } from '@/utils/toast';
import JSZip from 'jszip';

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
  const [isDownloadingResults, setIsDownloadingResults] = useState<string | null>(null);
  const [isDownloadingDebug, setIsDownloadingDebug] = useState<string | null>(null);

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

  const handleDownloadResults = async (packId: string) => {
    setIsDownloadingResults(packId);
    const toastId = showLoading("Fetching job results...");
    try {
      const { data: jobs, error } = await supabase
        .from('mira-agent-bitstudio-jobs')
        .select('id, final_image_url')
        .eq('vto_pack_job_id', packId)
        .eq('status', 'complete')
        .not('final_image_url', 'is', null);
      if (error) throw error;

      if (jobs.length === 0) {
        dismissToast(toastId);
        showSuccess("No completed images to download for this pack.");
        return;
      }

      dismissToast(toastId);
      showLoading(`Downloading ${jobs.length} images...`);

      const zip = new JSZip();
      const imagePromises = jobs.map(async (job) => {
        try {
          const response = await fetch(job.final_image_url!);
          if (!response.ok) return null;
          const blob = await response.blob();
          zip.file(`result_${job.id}.png`, blob);
        } catch (e) {
          console.error(`Failed to fetch ${job.final_image_url}`, e);
        }
      });
      await Promise.all(imagePromises);

      dismissToast(toastId);
      showLoading("Zipping files...");

      const content = await zip.generateAsync({ type: "blob" });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(content);
      link.download = `results_pack_${packId}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);

      dismissToast(toastId);
      showSuccess("Download started!");
    } catch (err: any) {
      dismissToast(toastId);
      showError(`Download failed: ${err.message}`);
    } finally {
      setIsDownloadingResults(null);
    }
  };

  const handleDownloadDebugPack = async (packId: string) => {
    setIsDownloadingDebug(packId);
    const toastId = showLoading("Fetching all job assets...");
    try {
      const { data: jobs, error } = await supabase
        .from('mira-agent-bitstudio-jobs')
        .select('id, source_person_image_url, source_garment_image_url, final_image_url')
        .eq('vto_pack_job_id', packId);
      if (error) throw error;

      if (jobs.length === 0) {
        dismissToast(toastId);
        showSuccess("No jobs found in this pack.");
        return;
      }

      dismissToast(toastId);
      showLoading(`Processing ${jobs.length} jobs for debug pack...`);

      const zip = new JSZip();
      const individualAssetsFolder = zip.folder("individual_assets");
      const comparisonSheetsFolder = zip.folder("_comparison_sheets");

      const jobPromises = jobs.map(async (job) => {
        try {
          const [personBlob, garmentBlob, resultBlob] = await Promise.all([
            fetch(job.source_person_image_url!).then(res => res.ok ? res.blob() : null),
            fetch(job.source_garment_image_url!).then(res => res.ok ? res.blob() : null),
            job.final_image_url ? fetch(job.final_image_url).then(res => res.ok ? res.blob() : null) : Promise.resolve(null)
          ]);

          const jobFolder = individualAssetsFolder!.folder(job.id);
          if (personBlob) jobFolder!.file("source_person.png", personBlob);
          if (garmentBlob) jobFolder!.file("source_garment.png", garmentBlob);
          if (resultBlob) jobFolder!.file("final_result.png", resultBlob);

          // Create comparison sheet
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          if (!ctx) return;

          const personImg = personBlob ? await createImageBitmap(personBlob) : null;
          const garmentImg = garmentBlob ? await createImageBitmap(garmentBlob) : null;
          const resultImg = resultBlob ? await createImageBitmap(resultBlob) : null;

          const imgWidth = 512;
          const imgHeight = 512;
          const padding = 20;
          const labelHeight = 40;

          canvas.width = (imgWidth * 3) + (padding * 4);
          canvas.height = imgHeight + (padding * 2) + labelHeight;
          ctx.fillStyle = '#f0f0f0';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = '#333';
          ctx.font = '20px sans-serif';
          ctx.textAlign = 'center';

          const drawImageWithLabel = (img: ImageBitmap | null, x: number, label: string) => {
            ctx.fillText(label, x + imgWidth / 2, padding + 15);
            const targetX = x;
            const targetY = padding + labelHeight;
            
            if (img) {
              const hRatio = imgWidth / img.width;
              const vRatio = imgHeight / img.height;
              const ratio = Math.min(hRatio, vRatio);
              const scaledWidth = img.width * ratio;
              const scaledHeight = img.height * ratio;
              const xOffset = (imgWidth - scaledWidth) / 2;
              const yOffset = (imgHeight - scaledHeight) / 2;
              ctx.drawImage(img, targetX + xOffset, targetY + yOffset, scaledWidth, scaledHeight);
            } else {
              ctx.fillStyle = '#ddd';
              ctx.fillRect(targetX, targetY, imgWidth, imgHeight);
            }
          };

          drawImageWithLabel(personImg, padding, "Source Person");
          drawImageWithLabel(garmentImg, imgWidth + padding * 2, "Garment");
          drawImageWithLabel(resultImg, (imgWidth * 2) + padding * 3, "Final Result");

          const comparisonBlob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
          if (comparisonBlob) {
            comparisonSheetsFolder!.file(`${job.id}_comparison.png`, comparisonBlob);
          }
        } catch (e) {
          console.error(`Failed to process job ${job.id}:`, e);
        }
      });

      await Promise.all(jobPromises);

      dismissToast(toastId);
      showLoading("Zipping debug files...");

      const content = await zip.generateAsync({ type: "blob" });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(content);
      link.download = `debug_pack_${packId}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);

      dismissToast(toastId);
      showSuccess("Debug pack download started!");
    } catch (err: any) {
      dismissToast(toastId);
      showError(`Download failed: ${err.message}`);
    } finally {
      setIsDownloadingDebug(null);
    }
  };

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
            <AccordionTrigger asChild>
              <div className="p-4 flex justify-between items-center w-full cursor-pointer">
                <div className="text-left">
                  <p className="font-semibold">Batch from {new Date(pack.created_at).toLocaleString()}</p>
                  <p className="text-sm text-muted-foreground">
                    {pack.completed_jobs} / {pack.metadata?.total_pairs || pack.total_jobs} completed
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="icon" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); handleDownloadResults(pack.pack_id); }} disabled={isDownloadingResults === pack.pack_id}>
                    {isDownloadingResults === pack.pack_id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  </Button>
                  <Button variant="outline" size="icon" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); handleDownloadDebugPack(pack.pack_id); }} disabled={isDownloadingDebug === pack.pack_id}>
                    {isDownloadingDebug === pack.pack_id ? <Loader2 className="h-4 w-4 animate-spin" /> : <HardDriveDownload className="h-4 w-4" />}
                  </Button>
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