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
      
      console.log(`[useSecureImage] Received URL: ${imageUrl}`);
      setIsLoading(true);
      setError(null);

      try {
        // If it's already a data URL or a local blob, just use it directly.
        if (imageUrl.startsWith('data:image') || imageUrl.startsWith('blob:')) {
          console.log("[useSecureImage] Handling local data/blob URL directly.");
          setDisplayUrl(imageUrl);
        } else {
          // For ANY other URL (Supabase or external), use our reliable server-side proxy.
          console.log("[useSecureImage] Using proxy to fetch image.");
          const { data: proxyData, error: proxyError } = await supabase.functions.invoke('MIRA-AGENT-proxy-image-download', { body: { url: imageUrl } });
          
          if (proxyError) {
            console.error(`[useSecureImage] Proxy error for URL "${imageUrl}":`, proxyError);
            throw new Error(`Proxy failed: ${proxyError.message}`);
          }
          
          if (proxyData.base64 && proxyData.mimeType) {
            const dataUrl = `data:${proxyData.mimeType};base64,${proxyData.base64}`;
            setDisplayUrl(dataUrl);
            console.log(`[useSecureImage] Successfully created data URL from proxy.`);
          } else {
            throw new Error("Proxy did not return valid image data.");
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