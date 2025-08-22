import { useState, useEffect } from 'react';
import { useSession } from '@/components/Auth/SessionContextProvider';

export const useSecureImage = (
  imageUrl: string | null | undefined,
  options?: { width?: number; height?: number; resize?: 'cover' | 'contain' }
) => {
  const { supabase } = useSession();
  const [displayUrl, setDisplayUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    const logPrefix = `[useSecureImage]`;

    const loadImage = async () => {
      if (!imageUrl) {
        setDisplayUrl(null);
        setIsLoading(false);
        return;
      }
      
      setIsLoading(true);
      setError(null);

      try {
        if (imageUrl.startsWith('data:image') || imageUrl.startsWith('blob:')) {
          setDisplayUrl(imageUrl);
        } else if (imageUrl.includes('cloudfront.net')) {
          // CloudFront URLs are safe to load directly and must be, to avoid proxy issues.
          setDisplayUrl(imageUrl);
        } else if (imageUrl.includes('supabase.co')) {
          // Force ALL Supabase URLs (public or private) through the download method
          // to avoid potential browser extension interference with direct src loading.
          const url = new URL(imageUrl);
          const pathSegments = url.pathname.split('/');
          const objectIndex = pathSegments.indexOf('object');
          if (objectIndex === -1 || objectIndex + 2 > pathSegments.length) throw new Error("Invalid Supabase URL format.");
          
          const bucketName = pathSegments[objectIndex + 2];
          const pathStartIndex = url.pathname.indexOf(bucketName) + bucketName.length + 1;
          const storagePath = decodeURIComponent(url.pathname.substring(pathStartIndex));
          if (!bucketName || !storagePath) throw new Error(`Could not parse bucket or path from URL: ${imageUrl}`);

          const transformOptions = options?.width && options?.height ? { width: options.width, height: options.height, resize: options.resize || 'cover' } : undefined;

          const { data, error: downloadError } = await supabase.storage.from(bucketName).download(storagePath, transformOptions ? { transform: transformOptions } : undefined);
          if (downloadError) throw downloadError;

          objectUrl = URL.createObjectURL(data);
          setDisplayUrl(objectUrl);
        } else {
          // Fallback to proxy for any other external URLs
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
      }
    };

    loadImage();

    return () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [imageUrl, supabase, options?.width, options?.height, options?.resize]);

  return { displayUrl, isLoading, error };
};