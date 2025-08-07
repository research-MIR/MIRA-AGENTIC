import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { AlertTriangle, Loader2, CheckCircle } from 'lucide-react';
import { useSecureImage } from '@/hooks/useSecureImage';

interface Job {
  id: string;
  status: 'queued' | 'processing' | 'complete' | 'failed';
  final_result?: any; // Use any to handle multiple possible result structures
  metadata?: {
    source_image_url?: string;
  };
  context?: { // For reframe jobs
    base_image_url?: string;
  }
}

interface Props {
  job: Job;
  onClick: () => void;
  isSelected: boolean;
}

export const RecentJobThumbnail = ({ job, onClick, isSelected }: Props) => {
  // Robustly get the image URL, checking for different possible data structures
  const imageUrl = job.status === 'complete' 
    ? job.final_result?.publicUrl || job.final_result?.images?.[0]?.publicUrl
    : job.metadata?.source_image_url || job.context?.base_image_url;
    
  const { displayUrl, isLoading, error } = useSecureImage(imageUrl, { width: 200, height: 200, resize: 'cover' });

  const renderContent = () => {
    if (isLoading) {
      return <div className="w-full h-full bg-muted rounded-md flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
    }
    if (error || !displayUrl) {
      return <div className="w-full h-full bg-muted rounded-md flex items-center justify-center text-xs text-muted-foreground text-center p-1"><AlertTriangle className="h-6 w-6 text-destructive/50" /></div>;
    }
    return (
      <div className="relative w-full h-full">
        <img src={displayUrl} alt="Job source" className="w-full h-full object-cover rounded-md" />
        {job.status === 'complete' && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <CheckCircle className="h-8 w-8 text-white" />
          </div>
        )}
        {(job.status === 'processing' || job.status === 'queued') && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <Loader2 className="h-8 w-8 text-white animate-spin" />
          </div>
        )}
      </div>
    );
  };

  return (
    <button onClick={onClick} className={cn("border-2 rounded-lg p-1 flex-shrink-0 w-24 h-24", isSelected ? "border-primary" : "border-transparent")}>
      {renderContent()}
    </button>
  );
};