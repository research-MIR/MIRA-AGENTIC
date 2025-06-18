import { useState, useEffect } from 'react';
import { useSession } from '@/components/Auth/SessionContextProvider';

export const useSecureImage = (imageUrl: string | null | undefined) => {
  const { supabase } = useSession();
  const [displayUrl, setDisplayUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadImage = async () => {
      if (!imageUrl) {
        setDisplayUrl(null);
        return;
      }
      
      setIsLoading(true);
      setError(null);

      try {
        // If it's already a data URL or a local blob, just use it directly.
        if (imageUrl.startsWith('data:image') || imageUrl.startsWith('blob:')) {
          setDisplayUrl(imageUrl);
        } else {
          // For all other URLs, get a secure, short-lived signed URL from our proxy.
          const { data: proxyData, error: proxyError } = await supabase.functions.invoke('MIRA-AGENT-proxy-image-download', { body: { url: imageUrl } });
          
          if (proxyError) {
            throw new Error(`Proxy failed: ${proxyError.message}`);
          }
          
          if (proxyData.signedUrl) {
            setDisplayUrl(proxyData.signedUrl);
          } else {
            throw new Error("Proxy did not return a signed URL.");
          }
        }
      } catch (err: any) {
        console.error(`[useSecureImage] Failed to load image from ${imageUrl}:`, err);
        setError(err.message);
        setDisplayUrl(null);
      } finally {
        setIsLoading(false);
      }
    };

    loadImage();

  }, [imageUrl, supabase]);

  return { displayUrl, isLoading, error };
};