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

export type AnalysisScope = 'successful_only' | 'all_with_image';

interface AnalyzePackModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAnalyze: (scope: AnalysisScope) => void;
  isLoading: boolean;
  packName: string;
}

export const AnalyzePackModal = ({ isOpen, onClose, onAnalyze, isLoading, packName }: AnalyzePackModalProps) => {
  const { t } = useLanguage();
  const [scope, setScope] = useState<AnalysisScope>('successful_only');

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('analyzePackScope')}: {packName}</DialogTitle>
          <DialogDescription>
            {t('analyzePackScopeDescription')}
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-2">
          <RadioGroup value={scope} onValueChange={(value: AnalysisScope) => setScope(value)}>
            <div className="flex items-start space-x-3 p-4 border rounded-md has-[:checked]:border-primary">
              <RadioGroupItem value="successful_only" id="successful_only" />
              <Label htmlFor="successful_only" className="font-normal w-full cursor-pointer">
                <span className="font-semibold block">{t('analyzeSuccessfulOnly')}</span>
                <span className="text-sm text-muted-foreground">
                  {t('analyzeSuccessfulOnlyDesc')}
                </span>
              </Label>
            </div>
            <div className="flex items-start space-x-3 p-4 border rounded-md has-[:checked]:border-primary">
              <RadioGroupItem value="all_with_image" id="all_with_image" />
              <Label htmlFor="all_with_image" className="font-normal w-full cursor-pointer">
                <span className="font-semibold">{t('analyzeAllWithImage')}</span>
                <span className="text-sm text-muted-foreground">
                  {t('analyzeAllWithImageDesc')}
                </span>
              </Label>
            </div>
          </RadioGroup>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={isLoading}>
            {t('cancel')}
          </Button>
          <Button onClick={() => onAnalyze(scope)} disabled={isLoading}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('analyzePack')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};