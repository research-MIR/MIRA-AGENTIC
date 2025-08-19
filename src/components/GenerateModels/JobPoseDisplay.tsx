import { useLanguage } from "@/context/LanguageContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { AlertTriangle, CheckCircle, Loader2, Wand2, Info, RefreshCw } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useImagePreview } from "@/context/ImagePreviewContext";
import { SecureImageDisplay } from "@/components/VTO/SecureImageDisplay";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { showSuccess } from "@/utils/toast";

interface PoseAnalysis {
  qa_status: 'pass' | 'fail';
  reasoning: string;
  failure_modes?: string[];
  garment_analysis?: {
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
  prompt_context_for_gemini?: string;
  qa_history?: any[];
  retry_count?: number;
}

interface Job {
    id: string;
    final_posed_images?: Pose[];
    model_description?: string;
    auto_approve: boolean;
    status: 'pending' | 'base_generation_complete' | 'awaiting_approval' | 'generating_poses' | 'polling_poses' | 'upscaling_poses' | 'complete' | 'failed';
}

interface JobPoseDisplayProps {
  job: Job | null;
  onViewHistory: (pose: Pose) => void;
  onForceRetry: (pose: Pose, jobId: string) => void;
  retryingPoseId: string | null;
  onRetryBaseModel: (jobId: string) => void;
  isRetryingBase: boolean;
}

const getPassBadgeInfo = (pose: Pose) => {
  if (pose.status !== 'complete') return null;
  
  const retryCount = pose.retry_count || 0;
  
  if (retryCount === 0) {
    return { text: 'Original Pass', variant: 'success' as const };
  }
  if (retryCount === 1) {
    return { text: '1st Retry Pass', variant: 'warning' as const };
  }
  if (retryCount === 2) {
    return { text: '2nd Retry Pass', variant: 'warning' as const };
  }
  return { text: `${retryCount}th Retry Pass`, variant: 'warning' as const };
};

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

const handleInfoClick = (e: React.MouseEvent, pose: Pose) => {
  e.stopPropagation();
  const idToCopy = pose.comfyui_prompt_id || pose.jobId;
  navigator.clipboard.writeText(idToCopy);
  showSuccess("ID copied to clipboard!");
};

export const JobPoseDisplay = ({ job, onViewHistory, onForceRetry, retryingPoseId, onRetryBaseModel, isRetryingBase }: JobPoseDisplayProps) => {
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
            <div className="flex justify-between items-center">
                <CardTitle>Generated Poses for Job</CardTitle>
                {job.auto_approve && (job.status === 'complete' || job.status === 'failed') && (
                    <Button variant="outline" size="sm" onClick={() => onRetryBaseModel(job.id)} disabled={isRetryingBase}>
                        {isRetryingBase ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                        Retry Base Model
                    </Button>
                )}
            </div>
            {job.model_description && (
                <CardDescription>
                    <strong>Prompt Used:</strong> {job.model_description}
                </CardDescription>
            )}
        </CardHeader>
        <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {poses.map((pose, index) => {
              const passBadge = getPassBadgeInfo(pose);
              const isRetryable = pose.status === 'complete' || pose.status === 'failed';
              return (
                <div key={`${job.id}-${index}`} className="space-y-2">
                <div 
                    className="relative group aspect-square cursor-pointer"
                    onClick={() => showImage({ images: poses.map(p => ({ url: p.final_url, jobId: job.id })), currentIndex: index })}
                >
                    <SecureImageDisplay imageUrl={pose.final_url} alt={pose.pose_prompt} />
                    {passBadge && (
                      <Badge className={cn(
                        "absolute top-1 left-1 z-10",
                        passBadge.variant === 'success' && "bg-green-600 text-white hover:bg-green-700",
                        passBadge.variant === 'warning' && "bg-yellow-500 text-black hover:bg-yellow-600"
                      )}>
                        {passBadge.text}
                      </Badge>
                    )}
                    <PoseStatusIcon pose={pose} />
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="absolute bottom-1 left-1 h-6 w-6 z-10 bg-black/50 hover:bg-black/70 text-white hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={(e) => handleInfoClick(e, pose)}
                          >
                            <Info className="h-3 w-3" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" align="start" onClick={(e) => e.stopPropagation()}>
                          <p className="text-xs">View Details & History</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    {isRetryable && (
                      <div className="absolute inset-0 bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          {retryingPoseId === pose.pose_prompt ? (
                              <Loader2 className="h-8 w-8 text-white animate-spin" />
                          ) : (
                              <Button variant="secondary" size="sm" onClick={(e) => { e.stopPropagation(); onForceRetry(pose, job!.id); }}>
                                  <RefreshCw className="h-4 w-4 mr-2" />
                                  Retry
                              </Button>
                          )}
                      </div>
                    )}
                </div>
                <p className="text-xs text-muted-foreground truncate">{pose.pose_prompt}</p>
                </div>
              )
            })}
            </div>
        </CardContent>
    </Card>
  );
};