import { Progress } from "@/components/ui/progress";

interface Job {
  status: string;
  final_posed_images?: { status: string }[];
  pose_prompts?: any[];
}

interface JobProgressBarProps {
  job: Job | null | undefined;
}

export const JobProgressBar = ({ job }: JobProgressBarProps) => {
  if (!job || !['polling_poses', 'complete'].includes(job.status)) {
    return null;
  }

  const totalPoses = job.pose_prompts?.length || 0;
  const completedPoses = job.final_posed_images?.filter((p: any) => p.status === 'complete').length || 0;

  if (totalPoses === 0) {
    return null;
  }

  const progressPercentage = (completedPoses / totalPoses) * 100;

  return (
    <div className="flex items-center gap-2 w-full max-w-xs">
      <Progress value={progressPercentage} className="w-full h-2" />
      <span className="text-sm text-muted-foreground font-mono whitespace-nowrap">
        {completedPoses} / {totalPoses}
      </span>
    </div>
  );
};