import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { AlertTriangle, Loader2, CheckCircle } from 'lucide-react';
import { useSecureImage } from '@/hooks/useSecureImage';

interface Job {
  id: string;
  status: 'pending' | 'base_generation_complete' | 'awaiting_approval' | 'generating_poses' | 'polling_poses' | 'complete' | 'failed';
  base_model_image_url?: string | null;
}

interface Props {
  job: Job;
  onClick: () => void;
  isSelected: boolean;
}

export const RecentJobThumbnail = ({ job, onClick, isSelected }: Props) => {
  const { displayUrl, isLoading, error } = useSecureImage(job.base_model_image_url);

  const renderOverlay = () => {
    switch (job.status) {
      case 'pending':
      case 'base_generation_complete':
      case 'awaiting_approval':
      case 'generating_poses':
      case 'polling_poses':
        return <div className="absolute inset-0 bg-black/50 flex items-center justify-center"><Loader2 className="h-6 w-6 text-white animate-spin" /></div>;
      case 'complete':
        return <div className="absolute inset-0 bg-green-800/50 flex items-center justify-center"><CheckCircle className="h-6 w-6 text-white" /></div>;
      case 'failed':
        return <div className="absolute inset-0 bg-destructive/50 flex items-center justify-center"><AlertTriangle className="h-6 w-6 text-white" /></div>;
      default:
        return null;
    }
  };

  return (
    <button onClick={onClick} className={cn("border-2 rounded-lg p-1 flex-shrink-0 w-24 h-24 relative", isSelected ? "border-primary" : "border-transparent")}>
      {isLoading ? (
        <Skeleton className="w-full h-full" />
      ) : error || !displayUrl ? (
        <div className="w-full h-full bg-muted rounded-md flex items-center justify-center text-xs text-muted-foreground text-center p-1">
            <AlertTriangle className="h-6 w-6 text-destructive/50" />
        </div>
      ) : (
        <img src={displayUrl} alt="Job source" className="w-full h-full object-cover rounded-md" />
      )}
      {renderOverlay()}
    </button>
  );
};