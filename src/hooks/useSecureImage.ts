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
          return;
        }
        
        if (imageUrl.includes('supabase.co')) {
          const url = new URL(imageUrl);
          const pathSegments = url.pathname.split('/');
          
          const objectIndex = pathSegments.indexOf('object');
          if (objectIndex === -1 || objectIndex + 2 > pathSegments.length) {
            throw new Error("Invalid Supabase URL format. Cannot find 'object' segment.");
          }
          
          const bucketName = pathSegments[objectIndex + 2];
          const pathStartIndex = url.pathname.indexOf(bucketName) + bucketName.length + 1;
          const storagePath = decodeURIComponent(url.pathname.substring(pathStartIndex));

          if (!bucketName || !storagePath) {
            throw new Error(`Could not parse bucket or path from URL: ${imageUrl}`);
          }

          const MAX_RETRIES = 3;
          const RETRY_DELAY = 1000; // 1 second

          for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            const { data, error: downloadError } = await supabase.storage
              .from(bucketName)
              .download(storagePath);

            if (!downloadError) {
              objectUrl = URL.createObjectURL(data);
              setDisplayUrl(objectUrl);
              return; // Success, exit the function
            }

            if (attempt < MAX_RETRIES) {
              console.warn(`[useSecureImage] Failed to download ${storagePath} (attempt ${attempt}/${MAX_RETRIES}). Retrying in ${RETRY_DELAY}ms...`);
              await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
            } else {
              throw new Error(`Failed to download image after ${MAX_RETRIES} attempts: ${downloadError.message}`);
            }
          }
        } else {
          // Fallback for any other external URLs via proxy
          const { data, error: proxyError } = await supabase.functions.invoke('MIRA-AGENT-proxy-image-download', { body: { url: imageUrl } });
          if (proxyError) throw new Error(`Proxy failed: ${proxyError.message}`);
          if (data.base64 && data.mimeType) {
            setDisplayUrl(`data:${data.mimeType};base64,${data.base64}`);
          } else {
            throw new Error("Proxy did not return valid image data.");
          }
        }
      } catch (err: any) {
        console.error("useSecureImage error:", err);
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