import { useLanguage } from "@/context/LanguageContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useImagePreview } from "@/context/ImagePreviewContext";
import { SecureImageDisplay } from "@/components/VTO/SecureImageDisplay";
import { Badge } from "@/components/ui/badge";
import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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
}

interface UpscaledPosesGalleryProps {
  jobs: Job[];
}

export const UpscaledPosesGallery = ({ jobs }: UpscaledPosesGalleryProps) => {
  const { t } = useLanguage();
  const { showImage } = useImagePreview();

  const upscaledPoses = jobs
    .flatMap(job => (job.final_posed_images || []).map(pose => ({ ...pose, jobId: job.id })))
    .filter(pose => pose.is_upscaled);

  const handleInfoClick = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    navigator.clipboard.writeText(id);
    showSuccess("Pose ID copied to clipboard!");
  };

  if (upscaledPoses.length === 0) {
    return (
      <Card className="h-full flex items-center justify-center">
        <div className="text-center text-muted-foreground">
          <p>{t('noUpscaledPoses')}</p>
        </div>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      {upscaledPoses.map((pose, index) => (
        <div key={`${pose.jobId}-${index}`} className="space-y-2">
          <div 
            className="relative group aspect-square cursor-pointer"
            onClick={() => showImage({ images: upscaledPoses.map(p => ({ url: p.final_url, jobId: p.jobId })), currentIndex: index })}
          >
            <SecureImageDisplay imageUrl={pose.final_url} alt={pose.pose_prompt} />
            {pose.analysis && (
              <>
                <Badge variant="secondary" className="absolute top-1 left-1 z-10 capitalize">{pose.analysis.shoot_focus.replace('_', ' ')}</Badge>
                <Badge variant="default" className="absolute top-1 right-1 z-10 capitalize">{pose.analysis.garment.coverage.replace('_', ' ')}</Badge>
              </>
            )}
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
  );
};