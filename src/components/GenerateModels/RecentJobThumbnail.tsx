import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { AlertTriangle, Loader2, CheckCircle, XCircle, Wand2, Info } from 'lucide-react';
import { useSecureImage } from '@/hooks/useSecureImage';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { Button } from '@/components/ui/button';
import { showSuccess } from '@/utils/toast';

interface Job {
  id: string;
  status: 'pending' | 'base_generation_complete' | 'awaiting_approval' | 'generating_poses' | 'polling_poses' | 'upscaling_poses' | 'complete' | 'failed';
  base_model_image_url?: string | null;
  final_posed_images?: { status: string; is_upscaled?: boolean }[];
  pose_prompts?: any[];
  gender?: 'male' | 'female' | null;
}

interface Props {
  job: Job;
  onClick: () => void;
  isSelected: boolean;
}

export const RecentJobThumbnail = ({ job, onClick, isSelected }: Props) => {
  const { displayUrl, isLoading, error } = useSecureImage(job.base_model_image_url, { width: 200, height: 200, resize: 'cover' });

  const handleInfoClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(job.id);
    showSuccess("Job ID copied to clipboard!");
  };

  const getAggregateStatus = () => {
    if (job.status === 'failed') return { icon: <XCircle className="h-5 w-5 text-white" />, color: 'bg-destructive', tooltip: 'Job Failed' };
    
    if (job.status === 'upscaling_poses') {
        const totalPoses = job.final_posed_images?.length || 0;
        const upscaledPoses = job.final_posed_images?.filter(p => p.is_upscaled).length || 0;
        return { icon: <Loader2 className="h-5 w-5 text-white animate-spin" />, color: 'bg-blue-500', tooltip: `Upscaling (${upscaledPoses}/${totalPoses})` };
    }

    if (['pending', 'base_generation_complete', 'awaiting_approval', 'generating_poses'].includes(job.status)) {
      return { icon: <Loader2 className="h-5 w-5 text-white animate-spin" />, color: 'bg-blue-500', tooltip: `In Progress: ${job.status.replace(/_/g, ' ')}` };
    }
    if (job.status === 'polling_poses') {
        const totalPoses = job.pose_prompts?.length || 0;
        const completedPoses = job.final_posed_images?.filter((p: any) => p.status === 'complete').length || 0;
        return { icon: <Loader2 className="h-5 w-5 text-white animate-spin" />, color: 'bg-blue-500', tooltip: `Generating Poses (${completedPoses}/${totalPoses})` };
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
            <div className={cn(
              "absolute bottom-1 right-1 h-8 w-8 rounded-full flex items-center justify-center border-2 border-background",
              aggregateStatus.color
            )}>
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

  const renderContent = () => {
    if (isLoading) {
      return <Skeleton className="w-full h-full" />;
    }
    if (error || !displayUrl) {
      return <div className="w-full h-full bg-muted rounded-md flex items-center justify-center text-xs text-muted-foreground text-center p-1"><AlertTriangle className="h-6 w-6 text-destructive/50" /></div>;
    }
    return (
      <div className="relative w-full h-full">
        <img src={displayUrl} alt="Job source" className="w-full h-full object-cover rounded-md" />
        {job.gender && (
          <Badge variant="secondary" className="absolute top-1 left-1 z-10 h-6 w-6 flex items-center justify-center p-0 font-bold text-xs">
            {job.gender.charAt(0).toUpperCase()}
          </Badge>
        )}
        {renderStatusIcon()}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="absolute bottom-1 left-1 h-6 w-6 z-10 bg-black/50 hover:bg-black/70 text-white hover:text-white"
                onClick={handleInfoClick}
              >
                <Info className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="start" onClick={(e) => e.stopPropagation()}>
              <p className="text-xs">Click to copy Job ID</p>
              <p className="text-xs font-mono max-w-xs break-all">{job.id}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    );
  };

  return (
    <button onClick={onClick} className={cn("border-2 rounded-lg p-1 flex-shrink-0 w-24 h-24 relative", isSelected ? "border-primary" : "border-transparent")}>
      {renderContent()}
    </button>
  );
};