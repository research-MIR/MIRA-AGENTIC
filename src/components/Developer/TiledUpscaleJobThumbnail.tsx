import { useSecureImage } from '@/hooks/useSecureImage';
import { Loader2, AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface TiledUpscaleJobThumbnailProps {
  job: {
    id: string;
    source_image_url: string;
    status: string;
  };
  onClick: () => void;
  isSelected: boolean;
}

export const TiledUpscaleJobThumbnail = ({ job, onClick, isSelected }: TiledUpscaleJobThumbnailProps) => {
  console.log(`[TiledUpscaleJobThumbnail] Received job prop:`, job);
  const { displayUrl, isLoading } = useSecureImage(job.source_image_url, { width: 200, height: 200 });
  console.log(`[TiledUpscaleJobThumbnail][${job.id.substring(0,8)}] useSecureImage state: isLoading=${isLoading}, displayUrl=${displayUrl?.substring(0, 100)}...`);

  return (
    <div 
      className={`relative aspect-square bg-muted rounded-md overflow-hidden flex items-center justify-center cursor-pointer group border-2 ${isSelected ? 'border-primary' : 'border-transparent'}`}
      onClick={onClick}
    >
      <p className="absolute top-1 left-1 text-xs bg-background/80 px-1.5 py-0.5 rounded z-10">Job source</p>
      {isLoading ? (
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      ) : displayUrl ? (
        <img src={displayUrl} alt="Job source" className="w-full h-full object-cover transition-transform group-hover:scale-105" />
      ) : (
        <div className="text-xs text-muted-foreground p-2 text-center">
          <AlertTriangle className="h-6 w-6 mx-auto mb-1" />
          Error loading image
        </div>
      )}
      <div className="absolute inset-0 bg-black/20 group-hover:bg-black/40 transition-colors" />
      <Badge variant={job.status === 'complete' ? 'default' : 'secondary'} className="absolute bottom-1 right-1 text-xs capitalize z-10">{job.status.replace(/_/g, ' ')}</Badge>
    </div>
  );
};