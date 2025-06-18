import { useState, useCallback } from 'react';
import { useSession } from '@/components/Auth/SessionContextProvider';
import { showError, showSuccess, showLoading, dismissToast } from '@/utils/toast';
import { optimizeImage, sanitizeFilename } from '@/lib/utils';

export interface UploadedFile {
  file: File; // Added the file object itself
  name: string;
  path: string;
  previewUrl: string;
  isImage: boolean;
  upload: (supabase: any, bucket: string) => Promise<{ path: string, publicUrl: string }>;
}

export const useFileUpload = () => {
  const { supabase, session } = useSession();
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  const handleFileUpload = useCallback(async (files: FileList | null): Promise<UploadedFile[]> => {
    if (!files || files.length === 0) return [];
    
    const validFiles: File[] = [];
    const invalidFiles: string[] = [];

    Array.from(files).forEach(file => {
      if (file.type.startsWith('video/') || file.type === 'image/avif') {
        invalidFiles.push(file.name);
      } else {
        validFiles.push(file);
      }
    });

    if (invalidFiles.length > 0) {
      showError(`Unsupported file type(s): ${invalidFiles.join(', ')}. AVIF and video formats are not allowed.`);
    }

    if (validFiles.length === 0) return [];

    const newFiles: UploadedFile[] = validFiles.map(file => {
      const isImage = file.type.startsWith('image/');
      const previewUrl = isImage ? URL.createObjectURL(file) : '';
      
      const upload = async (supabaseClient: any, bucket: string) => {
        const toastId = showLoading(`Uploading ${file.name}...`);
        try {
          const optimizedFile = await optimizeImage(file);
          const sanitized = sanitizeFilename(optimizedFile.name);
          const filePath = `${session?.user.id}/${Date.now()}-${sanitized}`;
          const { error } = await supabaseClient.storage.from(bucket).upload(filePath, optimizedFile);
          if (error) throw error;
          const { data: { publicUrl } } = supabaseClient.storage.from(bucket).getPublicUrl(filePath);
          dismissToast(toastId);
          return { path: filePath, publicUrl };
        } catch (err: any) {
          dismissToast(toastId);
          showError(`Upload failed for ${file.name}: ${err.message}`);
          throw err;
        }
      };

      return { file, name: file.name, path: '', previewUrl, isImage, upload };
    });

    setUploadedFiles(prev => [...prev, ...newFiles]);
    return newFiles;

  }, [session]);

  const removeFile = (indexToRemove: number) => {
    setUploadedFiles(files => files.filter((file, index) => {
      if (index === indexToRemove) {
        if (file.isImage) URL.revokeObjectURL(file.previewUrl);
        return false;
      }
      return true;
    }));
  };

  return {
    uploadedFiles,
    setUploadedFiles,
    handleFileUpload,
    removeFile,
    isDragging,
    setIsDragging,
  };
};