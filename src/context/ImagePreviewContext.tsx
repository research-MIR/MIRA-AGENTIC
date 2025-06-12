import { createContext, useContext, useState, ReactNode } from 'react';

export interface PreviewImage {
  url: string;
  jobId?: string;
}

interface PreviewData {
  images: PreviewImage[];
  currentIndex: number;
}

interface ImagePreviewContextType {
  showImage: (data: PreviewData) => void;
  hideImage: () => void;
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
  modal: (data: PreviewData | null, onClose: () => void) => ReactNode;
}

export const ImagePreviewProvider = ({ children, modal }: ImagePreviewProviderProps) => {
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);

  const showImage = (data: PreviewData) => setPreviewData(data);
  const hideImage = () => setPreviewData(null);

  const value = { showImage, hideImage };

  return (
    <ImagePreviewContext.Provider value={value}>
      {children}
      {modal(previewData, hideImage)}
    </ImagePreviewContext.Provider>
  );
};