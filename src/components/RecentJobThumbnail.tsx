import { useState, useEffect } from 'react';
import { useSession } from './Auth/SessionContextProvider';
import { Skeleton } from './ui/skeleton';
import { cn } from '@/lib/utils';
import { AlertTriangle } from 'lucide-react';

interface ComfyJob {
  id: string;
  source_garment_image_url: string;
}

interface Props {
  job: ComfyJob;
  onClick: () => void;
  isSelected: boolean;
}

export const RecentJobThumbnail = ({ job, onClick, isSelected }: Props) => {
  const { supabase } = useSession();
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;

    const fetchImage = async () => {
      const sourceUrl = job.source_garment_image_url;
      if (!sourceUrl) {
        setIsLoading(false);
        setHasError(true);
        return;
      }
      
      setIsLoading(true);
      setHasError(false);

      try {
        const bucketIdentifier = '/mira-agent-user-uploads/';
        const url = new URL(sourceUrl);
        const pathStartIndex = url.pathname.indexOf(bucketIdentifier);

        if (pathStartIndex === -1) {
            throw new Error(`Could not find bucket identifier '${bucketIdentifier}' in URL path: ${url.pathname}`);
        }
        
        const storagePath = decodeURIComponent(url.pathname.substring(pathStartIndex + bucketIdentifier.length));
        
        const { data: blob, error } = await supabase.storage
          .from('mira-agent-user-uploads')
          .download(storagePath);
        
        if (error) throw error;

        objectUrl = URL.createObjectURL(blob);
        setImageUrl(objectUrl);
      } catch (err) {
        console.error(`[RecentJobThumbnail][${job.id}] Failed to load thumbnail. Error:`, err);
        setHasError(true);
      } finally {
        setIsLoading(false);
      }
    };

    fetchImage();

    return () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [job.id, job.source_garment_image_url, supabase]);

  if (isLoading) {
    return <Skeleton className="w-24 h-24 flex-shrink-0" />;
  }

  if (hasError || !imageUrl) {
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