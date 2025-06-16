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
        // If it's already a data URL (e.g., from a file upload preview), just use it.
        if (imageUrl.startsWith('data:')) {
            setDisplayUrl(imageUrl);
            return;
        }

        // For all other remote URLs (Supabase or external), use the secure proxy function.
        // This function runs with service_role and can access any file.
        const { data, error: proxyError } = await supabase.functions.invoke('MIRA-AGENT-proxy-image-download', { body: { url: imageUrl } });
        
        if (proxyError) {
            throw new Error(`Image proxy failed: ${proxyError.message}`);
        }

        if (data.base64 && data.mimeType) {
            setDisplayUrl(`data:${data.mimeType};base64,${data.base64}`);
        } else {
            throw new Error("Proxy did not return valid image data.");
        }

      } catch (err: any) {
        console.error(`Failed to load image from ${imageUrl}:`, err);
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