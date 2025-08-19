import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { AlertTriangle, Loader2, CheckCircle } from 'lucide-react';
import { useSecureImage } from '@/hooks/useSecureImage';

interface Job {
  id: string;
  status: 'tiling' | 'generating' | 'compositing' | 'complete' | 'failed';
  source_image_url: string;
}

interface Props {
  job: Job;
  onClick: () => void;
  isSelected: boolean;
}

export const RecentJobThumbnail = ({ job, onClick, isSelected }: Props) => {
  const { displayUrl, isLoading, error } = useSecureImage(job.source_image_url, { width: 200, height: 200, resize: 'cover' });

  const renderContent = () => {
    if (isLoading) {
      return <Skeleton className="w-full h-full" />;
    }
    if (error || !displayUrl) {
      return <div className="w-full h-full bg-muted rounded-md flex items-center justify-center text-xs text-muted-foreground text-center p-1"><AlertTriangle className="h-6 w-6 text-destructive/50" /></div>;
    }
    return (
      <div className="relative w-full h-full group">
        <img src={displayUrl} alt="Job source" className="w-full h-full object-cover rounded-md" />
        {job.status === 'complete' && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <CheckCircle className="h-8 w-8 text-white" />
          </div>
        )}
        {job.status !== 'complete' && job.status !== 'failed' && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <Loader2 className="h-8 w-8 text-white animate-spin" />
          </div>
        )}
        {job.status === 'failed' && (
          <div className="absolute inset-0 bg-destructive/70 flex items-center justify-center">
            <AlertTriangle className="h-8 w-8 text-destructive-foreground" />
          </div>
        )}
      </div>
    );
  };

  return (
    <button 
      onClick={onClick} 
      className={cn("border-2 rounded-lg p-1 flex-shrink-0 w-24 h-24", isSelected ? "border-primary" : "border-transparent")}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onClick()}
    >
      {renderContent()}
    </button>
  );
};