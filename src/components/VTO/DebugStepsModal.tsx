import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useSecureImage } from "@/hooks/useSecureImage";
import { Loader2, AlertTriangle } from "lucide-react";

interface DebugAssets {
  inpainted_crop_url: string;
  final_composited_url: string;
  // The following are optional as older jobs might not have them
  cropped_source_url?: string;
  dilated_mask_url?: string;
}

interface DebugStepsModalProps {
  isOpen: boolean;
  onClose: () => void;
  assets: DebugAssets | null;
}

const ImageCard = ({ title, url }: { title: string, url?: string }) => {
  const { displayUrl, isLoading, error } = useSecureImage(url);
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-center">{title}</h3>
      <div className="aspect-square bg-muted rounded-md flex items-center justify-center overflow-hidden">
        {!url ? <p className="text-xs text-muted-foreground">Not available</p> :
         isLoading ? <Loader2 className="h-8 w-8 animate-spin" /> :
         error ? <AlertTriangle className="h-8 w-8 text-destructive" /> :
         displayUrl ? <img src={displayUrl} alt={title} className="max-w-full max-h-full object-contain" /> : null
        }
      </div>
    </div>
  );
};

export const DebugStepsModal = ({ isOpen, onClose, assets }: DebugStepsModalProps) => {
  if (!isOpen || !assets) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Inpainting Process Steps</DialogTitle>
          <DialogDescription>
            A breakdown of the intermediate images generated during the inpainting process.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 py-4">
          <ImageCard title="1. Cropped Source" url={assets.cropped_source_url} />
          <ImageCard title="2. Dilated Mask" url={assets.dilated_mask_url} />
          <ImageCard title="3. Inpainted Crop" url={assets.inpainted_crop_url} />
          <ImageCard title="4. Final Composite" url={assets.final_composited_url} />
        </div>
      </DialogContent>
    </Dialog>
  );
};