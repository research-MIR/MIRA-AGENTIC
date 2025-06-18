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
        // If it's a local blob or data URL, use it directly.
        if (imageUrl.startsWith('data:image') || imageUrl.startsWith('blob:')) {
          setDisplayUrl(imageUrl);
        // If it's a Supabase URL, trust it and use it directly.
        // The RLS policies on the bucket should allow public access if the URL is valid.
        } else if (imageUrl.includes('supabase.co')) {
          setDisplayUrl(imageUrl);
        } else {
          // For any other external URLs, use the proxy to fetch it securely.
          const { data, error: proxyError } = await supabase.functions.invoke('MIRA-AGENT-proxy-image-download', { body: { url: imageUrl } });
          if (proxyError) throw new Error(`Proxy failed: ${proxyError.message}`);
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

  }, [imageUrl, supabase]);

  return { displayUrl, isLoading, error };
};