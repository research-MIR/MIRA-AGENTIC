import { useState, useEffect, useCallback } from 'react';
import { useSession } from '@/components/Auth/SessionContextProvider';

export const useSecureImage = (
  imageUrl: string | null | undefined,
  options?: { width?: number; height?: number; resize?: 'cover' | 'contain' }
) => {
  const { supabase } = useSession();
  const [displayUrl, setDisplayUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    const logPrefix = `[useSecureImage]`;

    const loadImage = async () => {
      console.log(`${logPrefix} Hook triggered. Received URL:`, imageUrl);

      if (!imageUrl) {
        setDisplayUrl(null);
        console.log(`${logPrefix} URL is null or undefined. Clearing display URL.`);
        return;
      }
      
      setIsLoading(true);
      setError(null);
      console.log(`${logPrefix} Set loading to true for URL: ${imageUrl}`);

      try {
        if (imageUrl.startsWith('data:image') || imageUrl.startsWith('blob:')) {
          setDisplayUrl(imageUrl);
          console.log(`${logPrefix} URL is a data/blob URL. Set directly.`);
          return;
        }
        
        if (imageUrl.includes('supabase.co')) {
          if (imageUrl.includes('/storage/v1/object/public/')) {
            console.log(`${logPrefix} URL is in a public bucket. Setting directly.`);
            setDisplayUrl(imageUrl);
            return;
          }

          console.log(`${logPrefix} URL is a private Supabase URL. Proceeding with download.`);
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
          console.log(`${logPrefix} Parsed path: Bucket='${bucketName}', Path='${storagePath}'`);

          const transformOptions = options?.width && options?.height
            ? { width: options.width, height: options.height, resize: options.resize || 'cover' }
            : undefined;
          console.log(`${logPrefix} Using transform options:`, transformOptions);

          const MAX_RETRIES = 3;
          const RETRY_DELAY = 1000;

          for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            const { data, error: downloadError } = await supabase.storage
              .from(bucketName)
              .download(storagePath, transformOptions ? { transform: transformOptions } : undefined);

            if (!downloadError) {
              objectUrl = URL.createObjectURL(data);
              setDisplayUrl(objectUrl);
              console.log(`${logPrefix} Successfully downloaded and created object URL for ${storagePath}.`);
              return;
            }

            if (attempt < MAX_RETRIES) {
              const delay = RETRY_DELAY * attempt;
              console.warn(`${logPrefix} Failed to download ${storagePath} (attempt ${attempt}/${MAX_RETRIES}). Retrying in ${delay}ms... Error:`, downloadError);
              await new Promise(resolve => setTimeout(resolve, delay));
            } else {
              throw new Error(`Failed to download image after ${MAX_RETRIES} attempts: ${downloadError.message}`);
            }
          }
        } else {
          console.log(`${logPrefix} URL is external. Using proxy function.`);
          const { data, error: proxyError } = await supabase.functions.invoke('MIRA-AGENT-proxy-image-download', { body: { url: imageUrl } });
          if (proxyError) throw new Error(`Proxy failed: ${proxyError.message}`);
          if (data.base64 && data.mimeType) {
            setDisplayUrl(`data:${data.mimeType};base64,${data.base64}`);
          } else {
            throw new Error("Proxy did not return valid image data.");
          }
        }
      } catch (err: any) {
        console.error(`${logPrefix} Error loading image ${imageUrl}:`, err);
        setError(err.message);
        setDisplayUrl(null);
      } finally {
        setIsLoading(false);
        console.log(`${logPrefix} Set loading to false for URL: ${imageUrl}`);
      }
    };

    loadImage();

    return () => {
      if (objectUrl) {
        console.log(`${logPrefix} Revoking object URL: ${objectUrl}`);
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [imageUrl, supabase, options?.width, options?.height, options?.resize]);

  return { displayUrl, isLoading, error };
};