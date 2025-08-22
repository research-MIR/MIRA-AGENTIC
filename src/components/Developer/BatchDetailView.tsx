import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { TiledUpscaleJobThumbnail } from './TiledUpscaleJobThumbnail';
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Download, Loader2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

interface BatchDetailViewProps {
  batchJob: any;
  onSelectJob: (jobId: string) => void;
  onDownload: (batchJob: any) => void;
  isDownloading: boolean;
}

export const BatchDetailView = ({ batchJob, onSelectJob, onDownload, isDownloading }: BatchDetailViewProps) => {
  const { supabase } = useSession();

  const { data: individualJobs, isLoading: isLoadingJobs } = useQuery({
    queryKey: ['batchJobs', batchJob.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('mira_agent_tiled_upscale_jobs')
        .select('id, source_image_url, status')
        .eq('batch_id', batchJob.id)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!batchJob?.id,
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="font-semibold">{batchJob.name}</h3>
          <p className="text-sm text-muted-foreground">
            {batchJob.completed_jobs} / {batchJob.total_jobs} jobs complete
          </p>
        </div>
        <Button 
          onClick={() => onDownload(batchJob)} 
          disabled={isDownloading || batchJob.status !== 'complete'}
        >
          {isDownloading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
          Download ZIP
        </Button>
      </div>
      <div className="w-full bg-muted rounded-full h-2.5">
        <div 
          className="bg-primary h-2.5 rounded-full" 
          style={{ width: `${(batchJob.completed_jobs / batchJob.total_jobs) * 100}%` }}
        />
      </div>
      <ScrollArea className="h-[300px] pr-3">
        {isLoadingJobs ? (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
            {Array.from({ length: batchJob.total_jobs }).map((_, i) => <Skeleton key={i} className="aspect-square rounded-md" />)}
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
            {individualJobs?.map(job => (
              <TiledUpscaleJobThumbnail 
                key={job.id} 
                job={job} 
                onClick={() => onSelectJob(job.id)}
                isSelected={false} // Individual selection not yet implemented in this view
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
};