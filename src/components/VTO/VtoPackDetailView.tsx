import { useVtoPackJobs } from '@/hooks/useVtoPackJobs';
import { Loader2, XCircle, CheckCircle, AlertTriangle } from 'lucide-react';
import { SecureImageDisplay } from './SecureImageDisplay';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useState } from 'react';
import { VtoJobDetailModal } from './VtoJobDetailModal';
import { BitStudioJob } from '@/types/vto';
import { Badge } from '@/components/ui/badge';
import { BeforeAfterThumbnail } from './BeforeAfterThumbnail';

export const VtoPackDetailView = ({ packId, isOpen }: { packId: string, isOpen: boolean }) => {
  const { data: childJobs, isLoading } = useVtoPackJobs(packId, isOpen);
  const [selectedJob, setSelectedJob] = useState<BitStudioJob | null>(null);

  if (isLoading) {
    return <div className="flex justify-center p-4"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  const getEngineName = (engine?: string) => {
    if (!engine) return '?';
    if (engine === 'google') return 'G';
    if (engine === 'bitstudio') return 'B';
    if (engine === 'bitstudio_fallback') return 'B+';
    return engine.charAt(0).toUpperCase();
  };

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {childJobs?.map(job => {
          if (job.metadata?.pass_number === 2) {
            return (
              <BeforeAfterThumbnail
                key={job.id}
                job={job}
                onClick={() => setSelectedJob(job)}
                isSelected={selectedJob?.id === job.id}
              />
            );
          }

          const isFailed = job.status === 'failed' || job.status === 'permanently_failed';
          const inProgressStatuses = ['processing', 'queued', 'segmenting', 'delegated', 'compositing', 'awaiting_fix', 'fixing', 'pending'];
          const isInProgress = inProgressStatuses.includes(job.status);
          const isComplete = job.status === 'complete' || job.status === 'done';

          return (
            <div 
              key={job.id} 
              className="w-32 h-32 relative group cursor-pointer"
              onClick={() => setSelectedJob(job)}
            >
              <SecureImageDisplay 
                imageUrl={job.final_image_url || job.source_person_image_url || null} 
                alt="Job result" 
                className="w-full h-full object-cover rounded-md"
              />
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="outline" className="absolute top-1 left-1 z-10">{getEngineName(job.metadata?.engine)}</Badge>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Engine: {job.metadata?.engine || 'Unknown'}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              {isComplete && <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity" />}
              {isFailed && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="absolute inset-0 bg-destructive/70 flex items-center justify-center rounded-md">
                        <XCircle className="h-8 w-8 text-destructive-foreground" />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="max-w-xs">{job.error_message || "Job failed"}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              {isInProgress && <div className="absolute inset-0 bg-black/70 flex items-center justify-center rounded-md"><Loader2 className="h-8 w-8 animate-spin text-white" /></div>}
            </div>
          )
        })}
      </div>
      <VtoJobDetailModal 
        isOpen={!!selectedJob}
        onClose={() => setSelectedJob(null)}
        job={selectedJob}
      />
    </>
  );
};