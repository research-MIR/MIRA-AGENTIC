import { useState, useEffect } from 'react';
import { Skeleton } from './ui/skeleton';
import { cn } from '@/lib/utils';
import { AlertTriangle, Loader2 } from 'lucide-react';

interface Job {
  id: string;
  status: 'queued' | 'processing' | 'complete' | 'failed';
  final_result?: {
    images?: { publicUrl: string }[];
  };
}

interface Props {
  job: Job;
  onClick: () => void;
  isSelected: boolean;
}

export const GeneratorJobThumbnail = ({ job, onClick, isSelected }: Props) => {
  const imageUrl = job.final_result?.images?.[0]?.publicUrl;

  if (job.status === 'processing' || job.status === 'queued') {
    return (
      <div className={cn("border-2 rounded-lg p-1 flex-shrink-0 w-24 h-24", isSelected ? "border-primary" : "border-transparent")}>
        <div className="w-full h-full bg-muted rounded-md flex items-center justify-center text-xs text-muted-foreground text-center p-1">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      </div>
    );
  }

  if (job.status === 'failed' || !imageUrl) {
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