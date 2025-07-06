import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { AlertTriangle, Loader2, CheckCircle, XCircle, Wand2 } from 'lucide-react';
import { useSecureImage } from '@/hooks/useSecureImage';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface Job {
  id: string;
  status: 'pending' | 'base_generation_complete' | 'awaiting_approval' | 'generating_poses' | 'polling_poses' | 'complete' | 'failed';
  base_model_image_url?: string | null;
  final_posed_images?: { status: string; is_upscaled?: boolean }[];
}

interface Props {
  job: Job;
  onClick: () => void;
  isSelected: boolean;
}

export const RecentJobThumbnail = ({ job, onClick, isSelected }: Props) => {
  const { displayUrl, isLoading, error } = useSecureImage(job.base_model_image_url);

  const getAggregateStatus = () => {
    if (job.status === 'failed') return { icon: <XCircle className="h-5 w-5 text-white" />, color: 'bg-destructive', tooltip: 'Job Failed' };
    if (['pending', 'base_generation_complete', 'awaiting_approval', 'generating_poses', 'polling_poses'].includes(job.status)) {
      return { icon: <Loader2 className="h-5 w-5 text-white animate-spin" />, color: 'bg-blue-500', tooltip: `In Progress: ${job.status.replace(/_/g, ' ')}` };
    }
    if (job.status === 'complete') {
      if (!job.final_posed_images || job.final_posed_images.length === 0) {
        return { icon: <AlertTriangle className="h-5 w-5 text-white" />, color: 'bg-yellow-500', tooltip: 'Complete, but no poses found' };
      }
      const totalPoses = job.final_posed_images.length;
      const upscaledPoses = job.final_posed_images.filter(p => p.is_upscaled).length;

      if (upscaledPoses === totalPoses) {
        return { icon: <CheckCircle className="h-5 w-5 text-white" />, color: 'bg-green-600', tooltip: 'All Poses Upscaled' };
      }
      if (upscaledPoses > 0) {
        return { icon: <AlertTriangle className="h-5 w-5 text-white" />, color: 'bg-yellow-500', tooltip: `${upscaledPoses}/${totalPoses} Poses Upscaled` };
      }
      return { icon: <Wand2 className="h-5 w-5 text-white" />, color: 'bg-blue-500', tooltip: 'Ready for Upscaling' };
    }
    return null;
  };

  const aggregateStatus = getAggregateStatus();

  const renderStatusIcon = () => {
    if (!aggregateStatus) return null;
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className={cn("absolute bottom-1 right-1 h-8 w-8 rounded-full flex items-center justify-center border-2 border-background", aggregateStatus.color)}>
              {aggregateStatus.icon}
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p>{aggregateStatus.tooltip}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
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
      {renderStatusIcon()}
    </button>
  );
};