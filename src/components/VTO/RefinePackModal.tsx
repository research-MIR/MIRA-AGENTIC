import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";

export type RefineScope = 'successful_only' | 'all_completed';

interface RefinePackModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRefine: (scope: RefineScope) => void;
  isLoading: boolean;
  packName: string;
}

export const RefinePackModal = ({ isOpen, onClose, onRefine, isLoading, packName }: RefinePackModalProps) => {
  const { t } = useLanguage();
  const [scope, setScope] = useState<RefineScope>('successful_only');

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Refinement Pass for "{packName}"?</DialogTitle>
          <DialogDescription>
            This will create a new VTO pack containing refined versions of images from this pack. Choose which images to include. This action will reset any previous refinement pass for this pack.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-2">
          <RadioGroup value={scope} onValueChange={(value: RefineScope) => setScope(value)}>
            <div className="flex items-start space-x-3 p-4 border rounded-md has-[:checked]:border-primary">
              <RadioGroupItem value="successful_only" id="successful_only" />
              <Label htmlFor="successful_only" className="font-normal w-full cursor-pointer">
                <span className="font-semibold">{t('refineSuccessfulOnly')}</span>
                <span className="text-sm text-muted-foreground">
                  {t('refineSuccessfulOnlyDesc')}
                </span>
              </Label>
            </div>
            <div className="flex items-start space-x-3 p-4 border rounded-md has-[:checked]:border-primary">
              <RadioGroupItem value="all_completed" id="all_completed" />
              <Label htmlFor="all_completed" className="font-normal w-full cursor-pointer">
                <span className="font-semibold">{t('refineAllCompleted')}</span>
                <span className="text-sm text-muted-foreground">
                  {t('refineAllCompletedDesc')}
                </span>
              </Label>
            </div>
          </RadioGroup>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button onClick={() => onRefine(scope)} disabled={isLoading}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Yes, Create Refinement Pass
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};