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
      
      console.log(`[useSecureImage] Received URL: ${imageUrl}`);
      setIsLoading(true);
      setError(null);

      try {
        if (imageUrl.startsWith('data:image') || imageUrl.startsWith('blob:')) {
          console.log("[useSecureImage] Handling local data/blob URL directly.");
          setDisplayUrl(imageUrl);
        } else if (imageUrl.includes('supabase.co')) {
          console.log("[useSecureImage] Handling Supabase URL.");
          const url = new URL(imageUrl);
          const pathParts = url.pathname.split('/public/');
          
          if (pathParts.length < 2) {
            throw new Error(`Could not parse public Supabase URL: ${imageUrl}`);
          }
          
          const pathWithBucket = pathParts[1];
          const [bucketName, ...filePathParts] = pathWithBucket.split('/');
          const storagePath = filePathParts.join('/');

          console.log(`[useSecureImage] Parsed Bucket: ${bucketName}, Path: ${storagePath}`);

          if (!bucketName || !storagePath) {
            throw new Error(`Invalid bucket name or storage path parsed from URL: ${imageUrl}`);
          }

          const { data, error: downloadError } = await supabase.storage.from(bucketName).download(storagePath);
          
          if (downloadError) {
            console.error(`[useSecureImage] Supabase download error for path "${storagePath}" in bucket "${bucketName}":`, downloadError);
            throw downloadError;
          }
          
          console.log(`[useSecureImage] Successfully downloaded blob of size ${data.size}.`);
          objectUrl = URL.createObjectURL(data);
          setDisplayUrl(objectUrl);
        } else {
          console.log("[useSecureImage] Handling external URL via proxy.");
          const { data: proxyData, error: proxyError } = await supabase.functions.invoke('MIRA-AGENT-proxy-image-download', { body: { url: imageUrl } });
          if (proxyError) throw new Error(`Proxy failed: ${proxyError.message}`);
          if (proxyData.base64 && proxyData.mimeType) {
            setDisplayUrl(`data:${proxyData.mimeType};base64,${proxyData.base64}`);
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

    return () => {
      if (objectUrl) {
        console.log(`[useSecureImage] Revoking object URL: ${objectUrl}`);
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [imageUrl, supabase]);

  return { displayUrl, isLoading, error };
};