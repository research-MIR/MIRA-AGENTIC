import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useSecureImage } from "@/hooks/useSecureImage";
import { Loader2, AlertTriangle, ChevronLeft, ChevronRight } from "lucide-react";
import { useState, useMemo, useEffect } from "react";
import { Button } from "../ui/button";

interface DebugAssets {
  raw_mask_url?: string;
  expanded_mask_url?: string;
}

interface Attempt {
  report: any;
  debug_assets: DebugAssets;
  timestamp: string;
}

interface DebugStepsModalProps {
  isOpen: boolean;
  onClose: () => void;
  qaHistory: Attempt[];
  finalAssets: DebugAssets | null;
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

export const DebugStepsModal = ({ isOpen, onClose, qaHistory, finalAssets }: DebugStepsModalProps) => {
  const allAttempts = useMemo(() => {
    const historyAttempts = qaHistory || [];
    const finalAttempt = finalAssets ? [{ report: { is_match: true }, debug_assets: finalAssets, timestamp: new Date().toISOString() }] : [];
    return [...historyAttempts, ...finalAttempt];
  }, [qaHistory, finalAssets]);

  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (isOpen) {
      setCurrentIndex(allAttempts.length - 1);
    }
  }, [isOpen, allAttempts.length]);

  if (!isOpen || allAttempts.length === 0) return null;

  const currentAttempt = allAttempts[currentIndex];
  const isFinalAttempt = currentIndex === allAttempts.length - 1;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Debug Job Attempts</DialogTitle>
          <DialogDescription>
            Review each attempt made by the AI to fix this job.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 py-4">
          <div className="md:col-span-2 grid grid-cols-2 gap-4">
            <ImageCard title="Raw Mask" url={currentAttempt.debug_assets?.raw_mask_url} />
            <ImageCard title="Expanded Mask (Used)" url={currentAttempt.debug_assets?.expanded_mask_url} />
          </div>
          <div className="md:col-span-1 bg-muted/50 p-4 rounded-lg">
            <h3 className="font-semibold mb-2">Attempt #{currentIndex + 1} {isFinalAttempt && "(Final)"}</h3>
            {currentAttempt.report.is_match ? (
              <p className="text-sm text-green-600">This attempt was successful.</p>
            ) : (
              <div className="text-sm space-y-2">
                <p><strong className="font-medium">Reason:</strong> {currentAttempt.report.mismatch_reason || 'N/A'}</p>
                <p><strong className="font-medium">Suggestion:</strong> {currentAttempt.report.fix_suggestion || 'N/A'}</p>
              </div>
            )}
          </div>
        </div>
        <DialogFooter className="flex justify-between w-full">
          <p className="text-sm text-muted-foreground">Viewing attempt {currentIndex + 1} of {allAttempts.length}</p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setCurrentIndex(i => i - 1)} disabled={currentIndex === 0}>
              <ChevronLeft className="h-4 w-4 mr-2" /> Previous
            </Button>
            <Button variant="outline" onClick={() => setCurrentIndex(i => i + 1)} disabled={currentIndex === allAttempts.length - 1}>
              Next <ChevronRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};