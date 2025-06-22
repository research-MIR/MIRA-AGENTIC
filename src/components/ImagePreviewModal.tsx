import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Download, Wand2, Loader2, AlertTriangle, X, ChevronLeft, ChevronRight, PencilRuler, Shirt } from "lucide-react";
import { downloadImage } from "@/lib/utils";
import { useSession } from "./Auth/SessionContextProvider";
import { showError, showLoading, dismissToast, showSuccess } from "@/utils/toast";
import { useLanguage } from "@/context/LanguageContext";
import { useQueryClient } from "@tanstack/react-query";
import { type PreviewData } from "@/context/ImagePreviewContext";
import { useSecureImage } from "@/hooks/useSecureImage";
import { useNavigate } from "react-router-dom";
import { useImageTransferStore } from "@/store/imageTransferStore";

interface ImagePreviewModalProps {
  data: PreviewData | null;
  onClose: () => void;
}

const ImageWithLoader = ({ imageUrl }: { imageUrl: string }) => {
  const { displayUrl, isLoading, error } = useSecureImage(imageUrl);

  if (isLoading) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-muted rounded-md min-h-[50vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !displayUrl) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-destructive/10 rounded-md text-destructive text-sm p-4 min-h-[50vh]">
        <AlertTriangle className="h-5 w-5 mr-2" />
        Error loading image.
      </div>
    );
  }

  return (
    <img
      src={displayUrl}
      alt="Preview"
      className="max-h-[90vh] max-w-[90vw] object-contain rounded-md"
    />
  );
};

export const ImagePreviewModal = ({ data, onClose }: ImagePreviewModalProps) => {
  const { supabase, session } = useSession();
  const { t } = useLanguage();
  const [isUpscaling, setIsUpscaling] = useState(false);
  const queryClient = useQueryClient();
  const [currentIndex, setCurrentIndex] = useState(0);
  const navigate = useNavigate();
  const { setImageUrlToTransfer } = useImageTransferStore();

  useEffect(() => {
    if (data) {
      setCurrentIndex(data.currentIndex);
    }
  }, [data]);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleNext = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!data || data.images.length === 0) return;
    setCurrentIndex((prev) => (prev + 1) % data.images.length);
  }, [data]);

  const handlePrev = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!data || data.images.length === 0) return;
    setCurrentIndex((prev) => (prev - 1 + data.images.length) % data.images.length);
  }, [data]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
      if (data && data.images.length > 1) {
        if (e.key === 'ArrowRight') handleNext();
        if (e.key === 'ArrowLeft') handlePrev();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleClose, handleNext, handlePrev, data]);

  if (!data || !data.images || data.images.length === 0) {
    return null;
  }

  const currentImage = data.images[currentIndex];

  if (!currentImage) {
    return null;
  }

  const handleSendTo = (path: string, vtoTarget?: 'base' | 'pro-source') => {
    if (!currentImage) return;
    setImageUrlToTransfer(currentImage.url, vtoTarget);
    navigate(path);
    onClose();
  };

  const handleDownload = () => {
    if (!currentImage) return;
    const filename = currentImage.url.split('/').pop() || 'download.png';
    downloadImage(currentImage.url, filename);
  };

  const handleUpscale = async (factor: number, workflowType?: 'conservative_skin') => {
    if (!currentImage) return showError("No image selected.");
    if (!session?.user) return showError("You must be logged in to upscale images.");
    
    setIsUpscaling(true);
    let toastId = showLoading("Analyzing image to create prompt...");
    
    try {
      const imageResponse = await fetch(currentImage.url);
      if (!imageResponse.ok) throw new Error("Failed to fetch image for analysis.");
      const imageBlob = await imageResponse.blob();
      const reader = new FileReader();
      reader.readAsDataURL(imageBlob);
      const base64String = await new Promise<string>((resolve, reject) => {
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
      });
      const base64Data = base64String.split(',')[1];

      const { data: promptData, error: promptError } = await supabase.functions.invoke('MIRA-AGENT-tool-auto-describe-image', {
        body: { base64_image_data: base64Data, mime_type: imageBlob.type }
      });
      if (promptError) throw promptError;
      const autoPrompt = promptData.auto_prompt;
      if (!autoPrompt) throw new Error("Auto-prompting failed to return a prompt.");

      dismissToast(toastId);
      toastId = showLoading(`Submitting x${factor} upscale job...`);

      const { error: queueError } = await supabase.functions.invoke('MIRA-AGENT-proxy-comfyui', {
        body: {
          prompt_text: autoPrompt,
          image_url: currentImage.url,
          invoker_user_id: session.user.id,
          upscale_factor: factor,
          original_prompt_for_gallery: `Upscaled from job ${currentImage.jobId || 'gallery'}`,
          workflow_type: workflowType
        }
      });

      if (queueError) throw queueError;

      dismissToast(toastId);
      showSuccess("Upscale job started! You can find the result in the gallery in a couple of minutes.", { duration: 10000 });
      queryClient.invalidateQueries({ queryKey: ['activeComfyJobs'] });
      onClose();

    } catch (err: any) {
      dismissToast(toastId);
      showError(`Failed to upscale: ${err.message}`);
    } finally {
      setIsUpscaling(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 animate-in fade-in-0" onClick={handleClose}>
      <div className="relative" onClick={(e) => e.stopPropagation()}>
        <ImageWithLoader imageUrl={currentImage.url} />
      </div>

      <div className="absolute top-4 right-4 flex gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" size="icon" disabled={!currentImage}>
              {isUpscaling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
              <span className="sr-only">Image Actions</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={handleDownload} disabled={!currentImage}>
              <Download className="mr-2 h-4 w-4" />
              {t('download')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => handleSendTo('/editor')}>
              <PencilRuler className="mr-2 h-4 w-4" />
              <span>{t('sendToEditor')}</span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => handleSendTo('/virtual-try-on', 'base')}>
              <Shirt className="mr-2 h-4 w-4" />
              <span>{t('sendToVTO')}</span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => handleSendTo('/virtual-try-on', 'pro-source')}>
              <Wand2 className="mr-2 h-4 w-4" />
              <span>{t('sendToVTOPro')}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => handleUpscale(1.5)} disabled={isUpscaling || !currentImage}>
              {t('upscaleAndDownload')} x1.5
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => handleUpscale(1.5, 'conservative_skin')} disabled={isUpscaling || !currentImage}>
              {t('upscaleAndDownloadSkin')} x1.5
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => handleUpscale(2)} disabled={isUpscaling || !currentImage}>
              {t('upscaleAndDownload')} x2
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => handleUpscale(2, 'conservative_skin')} disabled={isUpscaling || !currentImage}>
              {t('upscaleAndDownloadSkin')} x2
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => handleUpscale(3)} disabled={isUpscaling || !currentImage}>
              {t('upscaleAndDownload')} x3
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => handleUpscale(3, 'conservative_skin')} disabled={isUpscaling || !currentImage}>
              {t('upscaleAndDownloadSkin')} x3
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="secondary" size="icon" onClick={handleClose}><X className="h-4 w-4" /></Button>
      </div>

      {data.images.length > 1 && (
        <>
          <Button variant="secondary" size="icon" className="absolute left-4 top-1/2 -translate-y-1/2" onClick={handlePrev}><ChevronLeft className="h-6 w-6" /></Button>
          <Button variant="secondary" size="icon" className="absolute right-4 top-1/2 -translate-y-1/2" onClick={handleNext}><ChevronRight className="h-6 w-6" /></Button>
        </>
      )}
    </div>
  );
};