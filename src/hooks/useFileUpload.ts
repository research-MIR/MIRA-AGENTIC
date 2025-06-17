import { useState, useCallback } from 'react';
import { useSession } from '@/components/Auth/SessionContextProvider';
import { showError, showSuccess, showLoading, dismissToast } from '@/utils/toast';
import { optimizeImage, sanitizeFilename } from '@/lib/utils';

export interface UploadedFile {
  name: string;
  path: string;
  previewUrl: string;
  isImage: boolean;
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

    const optimizationToastId = showLoading(`Optimizing ${validFiles.length} file(s)...`);
    
    try {
      const optimizationPromises = validFiles.map(file => 
        file.type.startsWith('image/') ? optimizeImage(file) : Promise.resolve(file)
      );
      const optimizedFiles = await Promise.all(optimizationPromises);
      dismissToast(optimizationToastId);

      const uploadToastId = showLoading(`Uploading ${optimizedFiles.length} file(s)...`);
      
      const uploadPromises = optimizedFiles.map(file => {
        const sanitized = sanitizeFilename(file.name);
        const filePath = `${session?.user.id}/${Date.now()}-${sanitized}`;
        return supabase.storage.from('mira-agent-user-uploads').upload(filePath, file).then(({ error }) => {
          if (error) throw error;
          const isImage = file.type.startsWith('image/');
          const previewUrl = isImage ? URL.createObjectURL(file) : '';
          return { name: file.name, path: filePath, previewUrl, isImage };
        });
      });

      const newFiles = await Promise.all(uploadPromises);
      setUploadedFiles(prev => [...prev, ...newFiles]);
      dismissToast(uploadToastId);
      showSuccess(`${newFiles.length} file(s) uploaded successfully!`);
      return newFiles;

    } catch (error: any) {
      dismissToast(optimizationToastId);
      showError("Upload failed: " + error.message);
      return [];
    }
  }, [session, supabase]);

  const removeFile = (path: string) => {
    setUploadedFiles(files => files.filter(f => {
      if (f.path === path) {
        if (f.isImage) URL.revokeObjectURL(f.previewUrl);
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