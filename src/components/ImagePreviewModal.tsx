import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Download, Wand2, Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import { downloadImage } from "@/lib/utils";
import { useSession } from "./Auth/SessionContextProvider";
import { showError, showLoading, dismissToast, showSuccess } from "@/utils/toast";
import { useLanguage } from "@/context/LanguageContext";
import { translations } from "@/lib/i18n";
import { useQueryClient } from "@tanstack/react-query";
import { type PreviewData, type PreviewImage } from "@/context/ImagePreviewContext";
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious, type CarouselApi } from "@/components/ui/carousel";

interface ImagePreviewModalProps {
  data: PreviewData | null;
  onClose: () => void;
}

export const ImagePreviewModal = ({ data, onClose }: ImagePreviewModalProps) => {
  const { supabase, session } = useSession();
  const { language } = useLanguage();
  const t = translations[language];
  const [isUpscaling, setIsUpscaling] = useState(false);
  const queryClient = useQueryClient();
  const [api, setApi] = useState<CarouselApi>();
  const [currentImage, setCurrentImage] = useState<PreviewImage | null>(null);

  useEffect(() => {
    if (!api || !data) return;

    const handleSelect = () => {
      const selectedIndex = api.selectedScrollSnap();
      setCurrentImage(data.images[selectedIndex]);
    };

    api.on("select", handleSelect);
    handleSelect(); // Set initial image

    return () => {
      api.off("select", handleSelect);
    };
  }, [api, data]);

  if (!data) return null;

  const handleDownload = () => {
    if (!currentImage) return;
    const filename = currentImage.url.split('/').pop() || 'download.png';
    downloadImage(currentImage.url, filename);
  };

  const handleUpscale = async (factor: number) => {
    if (!currentImage) return showError("No image selected.");
    if (!session?.user) return showError("You must be logged in to upscale images.");
    
    setIsUpscaling(true);
    const toastId = showLoading(`Uploading image for x${factor} upscale...`);
    
    try {
      const { data: uploadResult, error: uploadError } = await supabase.functions.invoke('MIRA-AGENT-proxy-comfyui-upload', {
        body: { image_url: currentImage.url }
      });
      if (uploadError) throw new Error(`Image upload failed: ${uploadError.message}`);
      const uploadedFilename = uploadResult.name;
      if (!uploadedFilename) throw new Error("ComfyUI did not return a filename for the uploaded image.");

      dismissToast(toastId);
      showSuccess("Image uploaded. Queueing upscale job...");

      const { error: queueError } = await supabase.functions.invoke('MIRA-AGENT-proxy-comfyui', {
        body: {
          prompt_text: "masterpiece, best quality, high resolution, photorealistic, sharp focus",
          image_filename: uploadedFilename,
          invoker_user_id: session.user.id,
          upscale_factor: factor,
          original_prompt_for_gallery: `Upscaled from job ${currentImage.jobId}`
        }
      });

      if (queueError) throw queueError;

      showSuccess("Upscale job queued! It will appear in your gallery shortly.");
      queryClient.invalidateQueries({ queryKey: ['activeComfyJobs'] });
      onClose();

    } catch (err: any) {
      showError(`Upscale failed: ${err.message}`);
      dismissToast(toastId);
    } finally {
      setIsUpscaling(false);
    }
  };

  return (
    <Dialog open={!!data} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-4xl w-full p-2">
        <DialogTitle className="sr-only">Image Preview</DialogTitle>
        <DialogDescription className="sr-only">A larger view of the selected image. You can download or upscale it from the button in the top right corner.</DialogDescription>
        <div className="relative">
          <Carousel setApi={setApi} opts={{ startIndex: data.currentIndex, loop: true }}>
            <CarouselContent>
              {data.images.map((image, index) => (
                <CarouselItem key={index}>
                  <img src={image.url} alt={`Preview ${index + 1}`} className="max-h-[90vh] w-full object-contain rounded-md" />
                </CarouselItem>
              ))}
            </CarouselContent>
            {data.images.length > 1 && (
              <>
                <CarouselPrevious className="absolute left-2 top-1/2 -translate-y-1/2" />
                <CarouselNext className="absolute right-2 top-1/2 -translate-y-1/2" />
              </>
            )}
          </Carousel>
          <div className="absolute top-4 right-4">
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
                  {t.download}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => handleUpscale(1.5)} disabled={isUpscaling || !currentImage}>
                  {t.upscaleAndDownload} x1.5
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => handleUpscale(2)} disabled={isUpscaling || !currentImage}>
                  {t.upscaleAndDownload} x2
                </DropdownMenuItem>
                 <DropdownMenuItem onSelect={() => handleUpscale(3)} disabled={isUpscaling || !currentImage}>
                  {t.upscaleAndDownload} x3
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};