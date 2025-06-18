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
        if (imageUrl.startsWith('data:image') || imageUrl.startsWith('blob:')) {
          setDisplayUrl(imageUrl);
        } else if (imageUrl.includes('supabase.co')) {
          const url = new URL(imageUrl);
          
          // More robust regex to handle URLs with or without /public/
          const bucketMatch = url.pathname.match(/\/object\/public\/([a-zA-Z0-9_-]+)\/|\/object\/([a-zA-Z0-9_-]+)\//);
          if (!bucketMatch) {
            throw new Error("Could not determine bucket name from Supabase URL.");
          }
          const bucketName = bucketMatch[1] || bucketMatch[2];
          const pathStartIndex = url.pathname.indexOf(bucketMatch[0]);
          const storagePath = decodeURIComponent(url.pathname.substring(pathStartIndex + bucketMatch[0].length));

          const { data, error } = await supabase.storage.from(bucketName).download(storagePath);
          if (error) {
            throw error;
          }
          objectUrl = URL.createObjectURL(data);
          setDisplayUrl(objectUrl);
        } else {
          const { data, error } = await supabase.functions.invoke('MIRA-AGENT-proxy-image-download', { body: { url: imageUrl } });
          if (error) throw new Error(`Proxy failed: ${error.message}`);
          if (data.base64 && data.mimeType) {
            setDisplayUrl(`data:${data.mimeType};base64,${data.base64}`);
          } else {
            throw new Error("Proxy did not return valid image data.");
          }
        }
      } catch (err: any) {
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