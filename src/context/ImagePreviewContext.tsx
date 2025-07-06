import { createContext, useContext, useState, ReactNode } from 'react';

export interface PreviewImage {
  url: string;
  jobId?: string;
}

export interface PreviewData {
  images: PreviewImage[];
  currentIndex: number;
}

interface ImagePreviewContextType {
  showImage: (data: PreviewData) => void;
  hideImage: () => void;
  previewData: PreviewData | null;
}

const ImagePreviewContext = createContext<ImagePreviewContextType | undefined>(undefined);

export const useImagePreview = () => {
  const context = useContext(ImagePreviewContext);
  if (!context) {
    throw new Error('useImagePreview must be used within an ImagePreviewProvider');
  }
  return context;
};

interface ImagePreviewProviderProps {
  children: ReactNode;
}

export const ImagePreviewProvider = ({ children }: ImagePreviewProviderProps) => {
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);

  const showImage = (data: PreviewData) => setPreviewData(data);
  const hideImage = () => setPreviewData(null);

  const value = { showImage, hideImage, previewData };

  return (
    <ImagePreviewContext.Provider value={value}>
      {children}
    </ImagePreviewContext.Provider>
  );
};