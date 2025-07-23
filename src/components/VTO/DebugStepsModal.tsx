import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useSecureImage } from "@/hooks/useSecureImage";
import { Loader2, AlertTriangle, Image as ImageIcon } from "lucide-react";

interface DebugAssets {
  raw_mask_url?: string;
  expanded_mask_url?: string;
  final_compositing_mask_url?: string;
  feathered_mask_url?: string;
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
          <DialogTitle>Masking & Compositing Debug</DialogTitle>
          <DialogDescription>
            A visual breakdown of the entire masking pipeline, from initial generation to final blending.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 py-4">
          <ImageCard title="1. Raw Combined Mask" url={assets.raw_mask_url} />
          <ImageCard title="2. Expanded Mask" url={assets.expanded_mask_url} />
          <ImageCard title="3. Final Compositing Mask (Before Blur)" url={assets.final_compositing_mask_url} />
          <ImageCard title="4. Feathered Mask (After Blur)" url={assets.feathered_mask_url} />
        </div>
      </DialogContent>
    </Dialog>
  );
};