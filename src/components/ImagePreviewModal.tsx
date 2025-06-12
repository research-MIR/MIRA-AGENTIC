import { useState } from "react";
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

interface PreviewData {
  url: string;
  jobId?: string;
}

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

  if (!data) return null;

  const handleDownload = () => {
    const filename = data.url.split('/').pop() || 'download.png';
    downloadImage(data.url, filename);
  };

  const handleUpscale = async (factor: number) => {
    if (!session?.user) return showError("You must be logged in to upscale images.");
    
    setIsUpscaling(true);
    const toastId = showLoading(`Uploading image for x${factor} upscale...`);
    
    try {
      const { data: uploadResult, error: uploadError } = await supabase.functions.invoke('MIRA-AGENT-proxy-comfyui-upload', {
        body: { image_url: data.url }
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
          original_prompt_for_gallery: `Upscaled from job ${data.jobId}`
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
    <Dialog open={!!data.url} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-4xl p-2">
        <DialogTitle className="sr-only">Image Preview</DialogTitle>
        <DialogDescription className="sr-only">A larger view of the selected image. You can download or upscale it from the button in the top right corner.</DialogDescription>
        <div className="relative">
          <img key={data.url} src={data.url} alt="Preview" className="max-h-[90vh] w-full object-contain rounded-md" />
          <div className="absolute top-4 right-4">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="icon">
                  {isUpscaling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                  <span className="sr-only">Image Actions</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={handleDownload}>
                  <Download className="mr-2 h-4 w-4" />
                  {t.download}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => handleUpscale(1.5)} disabled={isUpscaling}>
                  {t.upscaleAndDownload} x1.5
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => handleUpscale(2)} disabled={isUpscaling}>
                  {t.upscaleAndDownload} x2
                </DropdownMenuItem>
                 <DropdownMenuItem onSelect={() => handleUpscale(3)} disabled={isUpscaling}>
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