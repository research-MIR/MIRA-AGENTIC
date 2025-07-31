import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { useSession } from '@/components/Auth/SessionContextProvider';
import { showError, showLoading, dismissToast, showSuccess } from '@/utils/toast';
import JSZip from 'jszip';

type DownloadScope = 'all_completed' | 'passed_only';

interface PackSummary {
  pack_id: string;
  metadata: { name?: string };
}

interface DownloadPackModalProps {
  isOpen: boolean;
  onClose: () => void;
  pack: PackSummary | null;
}

export const DownloadPackModal = ({ isOpen, onClose, pack }: DownloadPackModalProps) => {
  const { t } = useLanguage();
  const { supabase, session } = useSession();
  const [scope, setScope] = useState<DownloadScope>('passed_only');
  const [isDownloading, setIsDownloading] = useState(false);

  const handleDownload = async () => {
    if (!pack || !session?.user) return;
    setIsDownloading(true);
    const toastId = showLoading("Fetching image URLs...");

    try {
      const { data, error } = await supabase.functions.invoke('MIRA-AGENT-tool-get-pack-image-urls', {
        body: { pack_id: pack.pack_id, scope, user_id: session.user.id }
      });
      if (error) throw error;
      const urls = data.urls;
      if (urls.length === 0) {
        dismissToast(toastId);
        showSuccess("No images found for the selected scope.");
        return;
      }

      dismissToast(toastId);
      showLoading(`Downloading and zipping ${urls.length} images...`);

      const zip = new JSZip();
      const imagePromises = urls.map(async (url: string) => {
        try {
          const response = await fetch(url);
          if (!response.ok) return null;
          const blob = await response.blob();
          const filename = url.split('/').pop() || 'image.png';
          zip.file(filename, blob);
        } catch (e) {
          console.error(`Failed to fetch ${url}`, e);
        }
      });
      await Promise.all(imagePromises);

      const content = await zip.generateAsync({ type: "blob" });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(content);
      link.download = `${pack.metadata?.name || pack.pack_id}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);

      dismissToast(toastId);
      showSuccess("Download started!");
      onClose();
    } catch (err: any) {
      dismissToast(toastId);
      showError(`Download failed: ${err.message}`);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('downloadPack')}: {pack?.metadata?.name}</DialogTitle>
          <DialogDescription>{t('downloadOptions')}</DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-2">
          <RadioGroup value={scope} onValueChange={(value: DownloadScope) => setScope(value)}>
            <div className="flex items-start space-x-3 p-4 border rounded-md has-[:checked]:border-primary">
              <RadioGroupItem value="passed_only" id="passed_only" />
              <Label htmlFor="passed_only" className="font-normal w-full cursor-pointer">
                <span className="font-semibold block">{t('downloadPassedQa')}</span>
                <span className="text-sm text-muted-foreground">{t('downloadPassedQaDesc')}</span>
              </Label>
            </div>
            <div className="flex items-start space-x-3 p-4 border rounded-md has-[:checked]:border-primary">
              <RadioGroupItem value="all_completed" id="all_completed" />
              <Label htmlFor="all_completed" className="font-normal w-full cursor-pointer">
                <span className="font-semibold block">{t('downloadSuccessfulOnly')}</span>
                <span className="text-sm text-muted-foreground">{t('downloadSuccessfulOnlyDesc')}</span>
              </Label>
            </div>
          </RadioGroup>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={isDownloading}>{t('cancel')}</Button>
          <Button onClick={handleDownload} disabled={isDownloading}>
            {isDownloading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('startDownload')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};