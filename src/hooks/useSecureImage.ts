import { useState, useEffect } from 'react';
import { useSession } from '@/components/Auth/SessionContextProvider';

export const useSecureImage = (imageUrl: string | null | undefined) => {
  const { supabase } = useSession();
  const [displayUrl, setDisplayUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    const loadImage = async () => {
      if (!imageUrl) {
        setDisplayUrl(null);
        return;
      }
      
      setIsLoading(true);
      setError(null);

      try {
        let blob: Blob;
        if (imageUrl.includes('supabase.co')) {
          const url = new URL(imageUrl);
          const bucketIdentifier = '/public/mira-agent-user-uploads/';
          const pathStartIndex = url.pathname.indexOf(bucketIdentifier);
          if (pathStartIndex === -1) throw new Error("Invalid Supabase URL path.");
          const storagePath = decodeURIComponent(url.pathname.substring(pathStartIndex + bucketIdentifier.length));
          const { data, error } = await supabase.storage.from('mira-agent-user-uploads').download(storagePath);
          if (error) throw error;
          blob = data;
        } else {
          // Use a proxy for external URLs to avoid CORS issues in the browser
          const { data, error } = await supabase.functions.invoke('MIRA-AGENT-proxy-image-download', { body: { url: imageUrl } });
          if (error) throw new Error(`Image proxy failed: ${error.message || 'Unknown error'}`);
          blob = data;
        }
        objectUrl = URL.createObjectURL(blob);
        setDisplayUrl(objectUrl);
      } catch (err: any) {
        console.error(`Failed to load image from ${imageUrl}:`, err);
        setError(err.message);
        setDisplayUrl(null);
      } finally {
        setIsLoading(false);
      }
    };

    loadImage();

    return () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [imageUrl, supabase]);

  return { displayUrl, isLoading, error };
};