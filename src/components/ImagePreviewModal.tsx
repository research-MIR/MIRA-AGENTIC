import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Download, Wand2, Loader2 } from "lucide-react";
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
    let toastId = showLoading("Analyzing image to create prompt...");
    
    try {
      // Step 1: Fetch the image blob and convert to base64 for auto-prompting
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

      // Step 2: Get the auto-generated prompt
      const { data: promptData, error: promptError } = await supabase.functions.invoke('MIRA-AGENT-tool-auto-describe-image', {
        body: { base64_image_data: base64Data, mime_type: imageBlob.type }
      });
      if (promptError) throw promptError;
      const autoPrompt = promptData.auto_prompt;
      if (!autoPrompt) throw new Error("Auto-prompting failed to return a prompt.");

      dismissToast(toastId);
      toastId = showLoading(`Submitting x${factor} upscale job...`);

      // Step 3: Queue the job in ComfyUI using the existing proxy
      const { error: queueError } = await supabase.functions.invoke('MIRA-AGENT-proxy-comfyui', {
        body: {
          prompt_text: autoPrompt,
          image_url: currentImage.url, // Pass the original URL to the proxy
          invoker_user_id: session.user.id,
          upscale_factor: factor,
          original_prompt_for_gallery: `Upscaled from job ${currentImage.jobId || 'gallery'}`
        }
      });

      if (queueError) throw queueError;

      dismissToast(toastId);
      showSuccess("Upscale job started! You'll be notified when it's ready.");
      queryClient.invalidateQueries({ queryKey: ['activeComfyJobs'] });
      onClose();

    } catch (err: any) {
      dismissToast(toastId);
      showError(`Upscale failed: ${err.message}`);
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