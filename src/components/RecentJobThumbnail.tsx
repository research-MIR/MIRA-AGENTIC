import { Skeleton } from './ui/skeleton';
import { cn } from '@/lib/utils';
import { AlertTriangle } from 'lucide-react';

interface Job {
  id: string;
  source_garment_image_url: string;
}

interface Props {
  job: Job;
  onClick: () => void;
  isSelected: boolean;
}

export const RecentJobThumbnail = ({ job, onClick, isSelected }: Props) => {
  const imageUrl = job.source_garment_image_url;

  if (!imageUrl) {
    return (
      <div className={cn("border-2 rounded-lg p-1 flex-shrink-0 w-24 h-24", isSelected ? "border-primary" : "border-transparent")}>
        <div className="w-full h-full bg-muted rounded-md flex items-center justify-center text-xs text-muted-foreground text-center p-1">
            <AlertTriangle className="h-6 w-6 text-destructive/50" />
        </div>
      </div>
    );
  }

  return (
    <button onClick={onClick} className={cn("border-2 rounded-lg p-1 flex-shrink-0", isSelected ? "border-primary" : "border-transparent")}>
      <img src={imageUrl} alt="Job source" className="w-24 h-24 object-cover rounded-md" />
    </button>
  );
};