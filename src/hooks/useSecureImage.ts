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
        if (imageUrl.startsWith('data:image') || imageUrl.startsWith('blob:')) {
          setDisplayUrl(imageUrl);
        } else if (imageUrl.includes('supabase.co')) {
          // This is a Supabase URL. Instead of downloading, we will reconstruct the public URL
          // to ensure it's correct, even if the stored one is malformed.
          const url = new URL(imageUrl);
          const pathSegments = url.pathname.split('/');
          
          // Find the bucket name, which is typically after 'object' or 'object/public'
          const objectIndex = pathSegments.indexOf('object');
          if (objectIndex === -1 || objectIndex + 2 > pathSegments.length) {
            throw new Error("Invalid Supabase URL format.");
          }
          
          // The bucket is the segment after 'public' or 'object'
          const bucketName = pathSegments[objectIndex + 1] === 'public' ? pathSegments[objectIndex + 2] : pathSegments[objectIndex + 1];
          const pathStartIndex = url.pathname.indexOf(bucketName) + bucketName.length + 1;
          const storagePath = decodeURIComponent(url.pathname.substring(pathStartIndex));

          const { data } = supabase.storage.from(bucketName).getPublicUrl(storagePath);
          
          if (!data.publicUrl) {
            throw new Error("Could not generate public URL for the image.");
          }
          
          // Use the newly generated, guaranteed-correct public URL
          setDisplayUrl(data.publicUrl);

        } else {
          // Fallback for any other external URLs
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

  }, [imageUrl, supabase]);

  return { displayUrl, isLoading, error };
};