import { useLanguage } from "@/context/LanguageContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { AlertTriangle, CheckCircle, Loader2, Wand2, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useImagePreview } from "@/context/ImagePreviewContext";
import { SecureImageDisplay } from "@/components/VTO/SecureImageDisplay";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { showSuccess } from "@/utils/toast";

interface PoseAnalysis {
  shoot_focus: 'upper_body' | 'lower_body' | 'full_body';
  garment: {
    description: string;
    coverage: 'upper_body' | 'lower_body' | 'full_body';
    is_identical_to_base_garment: boolean;
  };
}

interface Pose {
  final_url: string;
  is_upscaled?: boolean;
  status: string;
  pose_prompt: string;
  jobId: string;
  analysis?: PoseAnalysis;
  comfyui_prompt_id?: string;
}

interface Job {
    id: string;
    final_posed_images?: Pose[];
    model_description?: string;
}

interface JobPoseDisplayProps {
  job: Job | null;
}

const PoseStatusIcon = ({ pose }: { pose: Pose }) => {
  let statusIcon = null;
  let tooltipText = '';
  let color = '';

  switch (pose.status) {
    case 'complete':
      if (pose.is_upscaled) {
        statusIcon = <CheckCircle className="h-5 w-5 text-white" />;
        tooltipText = 'Upscaled & Ready';
        color = 'bg-green-600';
      } else {
        statusIcon = <Wand2 className="h-5 w-5 text-white" />;
        tooltipText = 'Ready for Upscaling';
        color = 'bg-blue-500';
      }
      break;
    case 'analyzing':
    case 'processing':
    case 'pending':
      statusIcon = <Loader2 className="h-5 w-5 text-white animate-spin" />;
      tooltipText = pose.status === 'analyzing' ? 'Analyzing...' : 'Generating...';
      color = 'bg-gray-500';
      break;
    default: // failed
      statusIcon = <AlertTriangle className="h-5 w-5 text-white" />;
      tooltipText = 'Failed';
      color = 'bg-destructive';
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={cn(
            "absolute bottom-1 right-1 h-8 w-8 rounded-full flex items-center justify-center border-2 border-background",
            color
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

  const handleInfoClick = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    navigator.clipboard.writeText(id);
    showSuccess("Pose ID copied to clipboard!");
  };

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
            {job.model_description && (
                <CardDescription>
                    <strong>Prompt Used:</strong> {job.model_description}
                </CardDescription>
            )}
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
                    {pose.analysis && (
                      <>
                        <Badge variant="secondary" className="absolute top-1 left-1 z-10 capitalize">{pose.analysis.shoot_focus.replace('_', ' ')}</Badge>
                        {pose.analysis.garment.is_identical_to_base_garment ? (
                          <Badge variant="outline" className="absolute top-1 right-1 z-10 capitalize bg-green-100 text-green-800 border-green-300 dark:bg-green-900/50 dark:text-green-300 dark:border-green-700">
                            Base Underwear
                          </Badge>
                        ) : (
                          <Badge variant="default" className="absolute top-1 right-1 z-10 capitalize">
                            {pose.analysis.garment.coverage.replace('_', ' ')}
                          </Badge>
                        )}
                      </>
                    )}
                    <PoseStatusIcon pose={pose} />
                    {pose.comfyui_prompt_id && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="absolute bottom-1 left-1 h-6 w-6 z-10 bg-black/50 hover:bg-black/70 text-white hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={(e) => handleInfoClick(e, pose.comfyui_prompt_id!)}
                            >
                              <Info className="h-3 w-3" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" align="start" onClick={(e) => e.stopPropagation()}>
                            <p className="text-xs">Click to copy Pose ID</p>
                            <p className="text-xs font-mono max-w-xs break-all">{pose.comfyui_prompt_id}</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                </div>
                <p className="text-xs text-muted-foreground truncate">{pose.pose_prompt}</p>
                </div>
            ))}
            </div>
        </CardContent>
    </Card>
  );
};