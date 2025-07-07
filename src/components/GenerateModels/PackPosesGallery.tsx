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

interface PackPosesGalleryProps {
  poses: Pose[];
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

export const PackPosesGallery = ({ poses }: PackPosesGalleryProps) => {
  const { t } = useLanguage();
  const { showImage } = useImagePreview();

  if (poses.length === 0) {
    return (
      <Card className="h-full flex items-center justify-center">
        <div className="text-center text-muted-foreground">
          <p>{t('noPosesGenerated')}</p>
        </div>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
      {poses.map((pose, index) => (
        <div key={`${pose.jobId}-${index}`} className="space-y-2">
          <div 
            className="relative group aspect-square cursor-pointer"
            onClick={() => showImage({ images: poses.map(p => ({ url: p.final_url, jobId: p.jobId })), currentIndex: index })}
          >
            <SecureImageDisplay imageUrl={pose.final_url} alt={pose.pose_prompt} />
            <PoseStatusIcon pose={pose} />
          </div>
          <p className="text-xs text-muted-foreground truncate">{pose.pose_prompt}</p>
        </div>
      ))}
    </div>
  );
};