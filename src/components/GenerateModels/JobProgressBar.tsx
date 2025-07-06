import { Progress } from "@/components/ui/progress";

interface JobProgressBarProps {
  completedPoses: number;
  totalPoses: number;
}

export const JobProgressBar = ({ completedPoses, totalPoses }: JobProgressBarProps) => {
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