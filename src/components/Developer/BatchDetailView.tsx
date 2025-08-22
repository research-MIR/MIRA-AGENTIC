import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { TiledUpscaleJobThumbnail } from "./TiledUpscaleJobThumbnail";

interface BatchJob {
  id: string;
  name: string;
  status: string;
  total_jobs: number;
  completed_jobs: number;
}

interface Props {
  batchJob: BatchJob;
  onSelectJob: (jobId: string) => void;
}

export const BatchDetailView = ({ batchJob, onSelectJob }: Props) => {
  const { supabase } = useSession();

  const { data: individualJobs, isLoading } = useQuery({
    queryKey: ['batchIndividualJobs', batchJob.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('mira_agent_tiled_upscale_jobs')
        .select('id, status, source_image_url, metadata')
        .eq('batch_id', batchJob.id);
      if (error) throw error;
      return data;
    },
    enabled: !!batchJob.id,
    refetchInterval: 5000,
  });

  const progress = batchJob.total_jobs > 0 ? (batchJob.completed_jobs / batchJob.total_jobs) * 100 : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{batchJob.name}</CardTitle>
        <div className="flex items-center gap-4 pt-2">
          <Progress value={progress} className="w-full" />
          <span className="text-sm font-medium text-muted-foreground whitespace-nowrap">{batchJob.completed_jobs} / {batchJob.total_jobs}</span>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="grid grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="aspect-square" />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {individualJobs?.map(job => (
              <div key={job.id} className="aspect-square">
                <TiledUpscaleJobThumbnail
                  job={job as any}
                  onClick={() => onSelectJob(job.id)}
                  isSelected={false}
                />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};