import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";

interface RefinePackModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRefine: () => void;
  isLoading: boolean;
  packName: string;
}

export const RefinePackModal = ({ isOpen, onClose, onRefine, isLoading, packName }: RefinePackModalProps) => {
  const { t } = useLanguage();

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Refinement Pass for "{packName}"?</DialogTitle>
          <DialogDescription>
            This will create a new VTO pack containing refined versions of all successfully generated images from this pack. This action will reset any previous refinement pass for this pack. Continue?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button onClick={onRefine} disabled={isLoading}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Yes, Create Refinement Pass
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};