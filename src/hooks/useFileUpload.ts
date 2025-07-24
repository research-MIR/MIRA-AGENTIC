import { useState, useCallback } from 'react';
import { useSession } from '@/components/Auth/SessionContextProvider';
import { showError, showSuccess, showLoading, dismissToast } from '@/utils/toast';
import { optimizeImage, sanitizeFilename } from '@/lib/utils';
import * as pdfjsLib from 'pdfjs-dist';

// Set up the PDF.js worker. This is necessary for the library to work correctly.
pdfjsLib.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

export interface UploadedFile {
  file: File;
  name: string;
  path: string;
  previewUrl: string;
  isImage: boolean;
  upload: (supabase: any, bucket: string) => Promise<{ path: string, publicUrl: string }>;
}

const convertPdfToImages = async (file: File): Promise<File[]> => {
  const toastId = showLoading(`Processing PDF: ${file.name}...`);
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
    const imageFiles: File[] = [];

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 1.5 }); // Use a higher scale for better quality
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const context = canvas.getContext('2d');
      if (!context) continue;

      await page.render({ canvasContext: context, viewport: viewport }).promise;
      
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, 'image/webp', 0.9); // High quality WebP
      });

      if (blob) {
        const originalName = file.name.replace(/\.pdf$/i, '');
        const newFile = new File([blob], `${sanitizeFilename(originalName)}_page_${i}.webp`, { type: 'image/webp' });
        imageFiles.push(newFile);
      }
    }
    dismissToast(toastId);
    showSuccess(`Converted ${file.name} into ${imageFiles.length} image(s).`);
    return imageFiles;
  } catch (error) {
    console.error("Failed to process PDF:", error);
    dismissToast(toastId);
    showError(`Could not process PDF "${file.name}". It may be corrupted or protected.`);
    return [];
  }
};

export const useFileUpload = () => {
  const { supabase, session } = useSession();
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  const handleFileUpload = useCallback(async (files: FileList | null, isBatch = false): Promise<UploadedFile[]> => {
    if (!files || files.length === 0) return [];
    
    const imageFiles: File[] = [];
    const pdfFiles: File[] = [];
    const invalidFiles: string[] = [];

    Array.from(files).forEach(file => {
      if (file.type.startsWith('image/')) {
        if (file.type === 'image/avif') {
          invalidFiles.push(file.name);
        } else {
          imageFiles.push(file);
        }
      } else if (file.type === 'application/pdf') {
        pdfFiles.push(file);
      } else {
        invalidFiles.push(file.name);
      }
    });

    if (invalidFiles.length > 0) {
      showError(`Unsupported file type(s): ${invalidFiles.join(', ')}. AVIF and video formats are not allowed.`);
    }

    const pdfConversionPromises = pdfFiles.map(convertPdfToImages);
    const convertedImageArrays = await Promise.all(pdfConversionPromises);
    const allNewImages = [...imageFiles, ...convertedImageArrays.flat()];

    if (allNewImages.length === 0) return [];

    const newFiles: UploadedFile[] = allNewImages.map(file => {
      const isImage = true; // All files are now images
      const previewUrl = URL.createObjectURL(file);
      
      const upload = async (supabaseClient: any, bucket: string) => {
        const toastId = showLoading(`Uploading ${file.name}...`);
        try {
          const optimizedFile = await optimizeImage(file);
          const filePath = `${session?.user.id}/${Date.now()}.png`;
          const { error } = await supabaseClient.storage.from(bucket).upload(filePath, optimizedFile, {
            contentType: 'image/png',
            upsert: true,
          });
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

    if (isBatch) {
      return newFiles;
    } else {
      setUploadedFiles(prev => [...prev, ...newFiles]);
      return newFiles;
    }

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