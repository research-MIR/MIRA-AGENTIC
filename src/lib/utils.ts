import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const sanitizeFilename = (filename: string): string => {
  return filename
    .replace(/\s+/g, '_') // Replace spaces with underscores
    .replace(/[^a-zA-Z0-9_.-]/g, '_') // Replace all other invalid chars with underscores
    .replace(/_{2,}/g, '_') // Collapse multiple underscores
    .replace(/\.{2,}/g, '.'); // Collapse multiple dots
};

const formatBytes = (bytes: number, decimals = 2) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

export const downloadImage = async (url: string, filename: string) => {
  try {
    // Fetch the image data as a blob
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.statusText}`);
    }
    const blob = await response.blob();

    // Create a temporary URL for the blob
    const blobUrl = window.URL.createObjectURL(blob);

    // Create a link element and simulate a click to trigger download
    const link = document.createElement("a");
    link.href = blobUrl;
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    
    // Clean up by removing the link and revoking the blob URL
    document.body.removeChild(link);
    window.URL.revokeObjectURL(blobUrl);
  } catch (error) {
    console.error("Download failed, falling back to opening in new tab:", error);
    // As a fallback, open the original image URL in a new tab for the user to save manually.
    window.open(url, '_blank');
  }
};

export const optimizeImage = (file: File, quality = 0.92): Promise<File> => {
  return new Promise((resolve, reject) => {
    const originalSize = file.size;
    const MAX_DIMENSION = 1440;

    if (!file.type.startsWith('image/')) {
      console.log(`[ImageOptimizer] Skipped optimization for non-image file: ${file.type}. Passing through original file.`);
      resolve(file);
      return;
    }

    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        
        const longestSide = Math.max(img.width, img.height);
        const scale = longestSide > MAX_DIMENSION ? MAX_DIMENSION / longestSide : 1;
        
        const newWidth = img.width * scale;
        const newHeight = img.height * scale;

        canvas.width = newWidth;
        canvas.height = newHeight;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          return reject(new Error('Failed to get canvas context'));
        }
        ctx.drawImage(img, 0, 0, newWidth, newHeight);

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              return reject(new Error('Canvas toBlob failed'));
            }
            const originalName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
            const newFile = new File([blob], `${originalName}.png`, {
              type: 'image/png',
              lastModified: Date.now(),
            });
            
            console.log(`[ImageOptimizer] Optimized ${file.name} to PNG: ${formatBytes(originalSize)} -> ${formatBytes(newFile.size)}`);

            resolve(newFile);
          },
          'image/png',
          quality
        );
      };
      img.onerror = (error) => reject(error);
    };
    reader.onerror = (error) => reject(error);
  });
};