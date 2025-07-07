import { useLanguage } from "@/context/LanguageContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, CheckCircle, Loader2, Wand2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useImagePreview } from "@/context/ImagePreviewContext";
import { SecureImageDisplay } from "@/components/VTO/SecureImageDisplay";

interface Pose {
  final_url: string;
  is_upscaled?: boolean;
  status: string;
  pose_prompt: string;
  jobId: string;
}

interface Job {
    id: string;
    final_posed_images?: Pose[];
}

interface JobPoseDisplayProps {
  job: Job | null;
}

const PoseStatusIcon = ({ pose }: { pose: Pose }) => {
  let statusIcon = null;
  let tooltipText = '';

  if (pose.status === 'complete') {
    if (pose.is_upscaled) {
      statusIcon = <CheckCircle className="h-5 w-5 text-white" />;
      tooltipText = 'Upscaled & Ready';
    } else {
      statusIcon = <Wand2 className="h-5 w-5 text-white" />;
      tooltipText = 'Ready for Upscaling';
    }
  } else if (pose.status === 'processing' || pose.status === 'pending') {
    statusIcon = <Loader2 className="h-5 w-5 text-white animate-spin" />;
    tooltipText = 'Generating...';
  } else {
    statusIcon = <AlertTriangle className="h-5 w-5 text-white" />;
    tooltipText = 'Failed';
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={cn(
            "absolute bottom-1 right-1 h-8 w-8 rounded-full flex items-center justify-center border-2 border-background",
            pose.status === 'complete' && pose.is_upscaled && 'bg-green-600',
            pose.status === 'complete' && !pose.is_upscaled && 'bg-blue-500',
            (pose.status === 'processing' || pose.status === 'pending') && 'bg-gray-500',
            pose.status === 'failed' && 'bg-destructive'
          )}>
            {statusIcon}
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p>{tooltipText}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export const JobPoseDisplay = ({ job }: JobPoseDisplayProps) => {
  const { t } = useLanguage();
  const { showImage } = useImagePreview();
  const poses = job?.final_posed_images || [];

  if (!job) {
    return (
      <Card className="h-full flex items-center justify-center">
        <div className="text-center text-muted-foreground">
          <p>{t('selectJobToViewPoses')}</p>
        </div>
      </Card>
    );
  }

  return (
    <Card>
        <CardHeader>
            <CardTitle>Generated Poses for Job</CardTitle>
        </CardHeader>
        <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {poses.map((pose, index) => (
                <div key={`${job.id}-${index}`} className="space-y-2">
                <div 
                    className="relative group aspect-square cursor-pointer"
                    onClick={() => showImage({ images: poses.map(p => ({ url: p.final_url, jobId: job.id })), currentIndex: index })}
                >
                    <SecureImageDisplay imageUrl={pose.final_url} alt={pose.pose_prompt} />
                    <PoseStatusIcon pose={pose} />
                </div>
                <p className="text-xs text-muted-foreground truncate">{pose.pose_prompt}</p>
                </div>
            ))}
            </div>
        </CardContent>
    </Card>
  );
};