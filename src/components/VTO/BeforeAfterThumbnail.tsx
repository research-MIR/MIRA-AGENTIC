import { cn } from '@/lib/utils';
import { SecureImageDisplay } from './SecureImageDisplay';
import { CheckCircle, Loader2, XCircle } from 'lucide-react';
import { BitStudioJob } from '@/types/vto';

interface BeforeAfterThumbnailProps {
  job: BitStudioJob;
  onClick: () => void;
  isSelected: boolean;
}

export const BeforeAfterThumbnail = ({ job, onClick, isSelected }: BeforeAfterThumbnailProps) => {
  const beforeUrl = job.source_person_image_url;
  const afterUrl = job.final_image_url;
  const isFailed = job.status === 'failed' || job.status === 'permanently_failed';
  const isComplete = job.status === 'complete' || job.status === 'done';
  const inProgressStatuses = ['processing', 'queued', 'segmenting', 'delegated', 'compositing', 'awaiting_fix', 'fixing', 'pending'];
  const isInProgress = inProgressStatuses.includes(job.status);

  return (
    <button onClick={onClick} className={cn("border-2 rounded-lg p-0.5 flex-shrink-0 w-32 h-32 relative group", isSelected ? "border-primary" : "border-transparent")}>
      <div className="relative w-full h-full rounded-md overflow-hidden">
        <div className="absolute inset-0">
          <SecureImageDisplay imageUrl={beforeUrl || null} alt="Before" />
        </div>
        <div 
          className="absolute inset-0"
          style={{ clipPath: 'polygon(0 0, 100% 0, 0 100%)' }}
        >
          <SecureImageDisplay imageUrl={afterUrl || null} alt="After" />
        </div>
        {isComplete && (
          <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            <CheckCircle className="h-8 w-8 text-white" />
          </div>
        )}
        {isFailed && (
          <div className="absolute inset-0 bg-destructive/70 flex items-center justify-center">
            <XCircle className="h-8 w-8 text-destructive-foreground" />
          </div>
        )}
        {isInProgress && (
          <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-white" />
          </div>
        )}
      </div>
    </button>
  );
};