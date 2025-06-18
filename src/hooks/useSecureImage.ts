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
      console.log('[useSecureImage] Hook triggered. Input imageUrl:', imageUrl);

      if (!imageUrl) {
        console.log('[useSecureImage] ImageUrl is null or undefined. Clearing displayUrl.');
        setDisplayUrl(null);
        return;
      }
      
      setIsLoading(true);
      setError(null);

      try {
        if (imageUrl.startsWith('data:image') || imageUrl.startsWith('blob:')) {
          console.log('[useSecureImage] Handling local data/blob URL.');
          setDisplayUrl(imageUrl);
        } else if (imageUrl.includes('supabase.co')) {
          console.log('[useSecureImage] Handling Supabase URL.');
          const url = new URL(imageUrl);
          
          const bucketMatch = url.pathname.match(/\/public\/([a-zA-Z0-9_-]+)\//);
          console.log('[useSecureImage] Bucket match result:', bucketMatch);
          if (!bucketMatch || !bucketMatch[1]) {
            throw new Error("Could not determine bucket name from Supabase URL.");
          }
          const bucketName = bucketMatch[1];
          const pathStartIndex = url.pathname.indexOf(bucketMatch[0]);
          const storagePath = decodeURIComponent(url.pathname.substring(pathStartIndex + bucketMatch[0].length));
          console.log(`[useSecureImage] Parsed bucket: '${bucketName}', path: '${storagePath}'`);

          const { data, error } = await supabase.storage.from(bucketName).download(storagePath);
          if (error) {
            console.error(`[useSecureImage] Supabase download error for path ${storagePath}:`, error);
            throw error;
          }
          console.log(`[useSecureImage] Supabase download successful for path ${storagePath}. Blob size: ${data.size}`);
          objectUrl = URL.createObjectURL(data);
          setDisplayUrl(objectUrl);
        } else {
          console.log('[useSecureImage] Handling external URL via proxy.');
          const { data, error } = await supabase.functions.invoke('MIRA-AGENT-proxy-image-download', { body: { url: imageUrl } });
          if (error) throw new Error(`Proxy failed: ${error.message}`);
          if (data.base64 && data.mimeType) {
            setDisplayUrl(`data:${data.mimeType};base64,${data.base64}`);
          } else {
            throw new Error("Proxy did not return valid image data.");
          }
        }
      } catch (err: any) {
        console.error(`[useSecureImage] CATCH BLOCK: Failed to load image from ${imageUrl}:`, err);
        setError(err.message);
        setDisplayUrl(null);
      } finally {
        setIsLoading(false);
        console.log('[useSecureImage] Hook finished execution.');
      }
    };

    loadImage();

    return () => {
      if (objectUrl) {
        console.log('[useSecureImage] Cleanup: Revoking object URL.');
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [imageUrl, supabase]);

  return { displayUrl, isLoading, error };
};