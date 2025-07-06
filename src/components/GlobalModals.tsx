import { useImagePreview } from "@/context/ImagePreviewContext";
import { ImagePreviewModal } from "./ImagePreviewModal";

export const GlobalModals = () => {
  const { previewData, hideImage } = useImagePreview();
  return <ImagePreviewModal data={previewData} onClose={hideImage} />;
};