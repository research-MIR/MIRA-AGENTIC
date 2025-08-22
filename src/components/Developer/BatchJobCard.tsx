import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { Loader2, CheckCircle, XCircle } from "lucide-react";

interface BatchJob {
  id: string;
  name: string;
  status: 'processing' | 'complete' | 'failed';
  total_jobs: number;
  completed_jobs: number;
}

interface Props {
  job: BatchJob;
  onClick: () => void;
  isSelected: boolean;
}

export const BatchJobCard = ({ job, onClick, isSelected }: Props) => {
  const progress = job.total_jobs > 0 ? (job.completed_jobs / job.total_jobs) * 100 : 0;

  const getStatusIcon = () => {
    if (job.status === 'processing') return <Loader2 className="h-4 w-4 animate-spin" />;
    if (job.status === 'complete') return <CheckCircle className="h-4 w-4 text-green-500" />;
    if (job.status === 'failed') return <XCircle className="h-4 w-4 text-destructive" />;
    return null;
  };

  return (
    <button onClick={onClick} className={cn("w-full text-left p-1 rounded-lg", isSelected && "ring-2 ring-primary")}>
      <Card className="hover:bg-muted/50">
        <CardContent className="p-3">
          <div className="flex justify-between items-center">
            <p className="font-semibold truncate pr-2">{job.name}</p>
            <div className="flex items-center gap-2">
              {getStatusIcon()}
              <span className="text-xs text-muted-foreground">{job.completed_jobs}/{job.total_jobs}</span>
            </div>
          </div>
          <Progress value={progress} className="h-2 mt-2" />
        </CardContent>
      </Card>
    </button>
  );
};