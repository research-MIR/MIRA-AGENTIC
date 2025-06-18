import { useSecureImage } from '@/hooks/useSecureImage';
import { Loader2, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SecureImageDisplayProps {
  imageUrl: string | null;
  alt: string;
  className?: string;
}

export const SecureImageDisplay = ({ imageUrl, alt, className }: SecureImageDisplayProps) => {
  const { displayUrl, isLoading, error } = useSecureImage(imageUrl);

  if (isLoading) {
    return <div className={cn("w-full h-full flex items-center justify-center bg-muted rounded-md", className)}><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  }

  if (error) {
    return <div className={cn("w-full h-full flex items-center justify-center bg-destructive/10 rounded-md text-destructive text-sm p-2 text-center", className)}><AlertTriangle className="h-6 w-6 mb-2" /><br/>Error loading image.</div>;
  }

  if (!displayUrl) {
    return <div className={cn("w-full h-full bg-muted rounded-md", className)} />;
  }

  return <img src={displayUrl} alt={alt} className={className} />;
};