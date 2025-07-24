import { useLanguage } from "@/context/LanguageContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useImagePreview } from "@/context/ImagePreviewContext";
import { SecureImageDisplay } from "@/components/VTO/SecureImageDisplay";
import { Badge } from "@/components/ui/badge";

interface PoseAnalysis {
  shoot_focus: 'upper_body' | 'lower_body' | 'full_body';
  garment: {
    description: string;
    coverage: 'upper_body' | 'lower_body' | 'full_body';
  };
}

interface Pose {
  final_url: string;
  is_upscaled?: boolean;
  status: string;
  pose_prompt: string;
  jobId: string;
  analysis?: PoseAnalysis;
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
          </div>
          <p className="text-xs text-muted-foreground truncate">{pose.pose_prompt}</p>
        </div>
      ))}
    </div>
  );
};