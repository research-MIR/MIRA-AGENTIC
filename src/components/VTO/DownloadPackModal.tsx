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
import { Loader2, Download, CheckCircle, ImageIcon } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { useSession } from '@/components/Auth/SessionContextProvider';
import { showError, showSuccess } from '@/utils/toast';
import { cn } from '@/lib/utils';
import JSZip from 'jszip';
import { Progress } from '@/components/ui/progress';

type ExportScope = 'all_with_image' | 'passed_qa';

interface PackSummary {
  pack_id: string;
  metadata: { name?: string };
}

interface DownloadPackModalProps {
  isOpen: boolean;
  onClose: () => void;
  pack: PackSummary | null;
}

const sanitize = (str: string) => str.replace(/[^a-z0-9_.-]/gi, '_').substring(0, 50);

const ExportOption = ({ value, title, description, icon, selected, onSelect }: any) => (
  <div
    className={cn(
      "flex items-start space-x-3 p-4 border rounded-md cursor-pointer transition-colors",
      selected === value && "border-primary bg-primary/5"
    )}
    onClick={() => onSelect(value)}
  >
    <RadioGroupItem value={value} id={value} className="mt-1" />
    <div className="flex-1">
      <Label htmlFor={value} className="font-semibold flex items-center gap-2 cursor-pointer">
        {icon}
        {title}
      </Label>
      <p className="text-sm text-muted-foreground mt-1">{description}</p>
    </div>
  </div>
);

export const DownloadPackModal = ({ isOpen, onClose, pack }: DownloadPackModalProps) => {
  const { t } = useLanguage();
  const { supabase, session } = useSession();
  const [scope, setScope] = useState<ExportScope>('all_with_image');
  const [isDownloading, setIsDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');

  const handleDownload = async () => {
    if (!pack || !session?.user) return;
    setIsDownloading(true);
    setProgress(0);
    setProgressMessage("Fetching job list...");

    try {
      let jobsToDownload: any[] = [];

      if (scope === 'all_with_image') {
        const { data, error } = await supabase
          .from('mira-agent-bitstudio-jobs')
          .select('id, final_image_url, source_person_image_url, source_garment_image_url, metadata')
          .eq('vto_pack_job_id', pack.pack_id)
          .eq('user_id', session.user.id)
          .not('final_image_url', 'is', null);
        if (error) throw error;
        jobsToDownload = data;
      } else { // passed_qa
        const { data: reports, error: reportsError } = await supabase
          .from('mira-agent-vto-qa-reports')
          .select('source_vto_job_id')
          .eq('vto_pack_job_id', pack.pack_id)
          .eq('user_id', session.user.id)
          .eq('comparative_report->>overall_pass', 'true');
        if (reportsError) throw reportsError;
        if (!reports || reports.length === 0) {
          throw new Error("No QA-passed jobs found to export.");
        }
        const jobIds = reports.map(r => r.source_vto_job_id);
        const { data, error } = await supabase
          .from('mira-agent-bitstudio-jobs')
          .select('id, final_image_url, source_person_image_url, source_garment_image_url, metadata')
          .in('id', jobIds);
        if (error) throw error;
        jobsToDownload = data;
      }

      if (jobsToDownload.length === 0) {
        throw new Error("No images found for the selected criteria.");
      }

      const zip = new JSZip();
      const totalFiles = jobsToDownload.length;
      let processedCount = 0;

      for (const job of jobsToDownload) {
        processedCount++;
        setProgress((processedCount / totalFiles) * 100);
        setProgressMessage(`Downloading ${processedCount}/${totalFiles}...`);

        if (!job.final_image_url) continue;

        const poseId = job.metadata?.model_generation_job_id?.substring(0, 8) || 'model_unknown';
        const garmentHash = job.metadata?.garment_analysis?.hash?.substring(0, 8);
        let garmentId;
        if (garmentHash) {
            garmentId = garmentHash;
        } else {
            const garmentUrlParts = (job.source_garment_image_url || '').split('/');
            garmentId = garmentUrlParts.pop()?.split('.')[0].substring(0, 8) || 'garment_unknown';
        }
        const filename = `Pose_${poseId}_Garment_${garmentId}.jpg`;
        
        try {
          const response = await fetch(job.final_image_url);
          if (!response.ok) continue;
          const blob = await response.blob();
          zip.file(filename, blob);
        } catch (e) {
          console.error(`Failed to fetch ${job.final_image_url}`, e);
        }
      }

      setProgressMessage("Zipping files...");
      const content = await zip.generateAsync({ type: "blob" });
      
      const link = document.createElement('a');
      link.href = URL.createObjectURL(content);
      link.download = `${sanitize(pack.metadata?.name || pack.pack_id)}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);

      showSuccess("Download started!");
      onClose();

    } catch (err: any) {
      showError(`Download failed: ${err.message}`);
    } finally {
      setIsDownloading(false);
    }
  };

  const options = [
    { value: 'all_with_image', title: t('downloadAllWithImage'), description: t('downloadAllWithImageDesc'), icon: <ImageIcon className="h-5 w-5" /> },
    { value: 'passed_qa', title: t('downloadPassedQa'), description: t('downloadPassedQaDesc'), icon: <CheckCircle className="h-5 w-5" /> },
  ];

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('downloadOptions')}: {pack?.metadata?.name}</DialogTitle>
          <DialogDescription>
            Choose which set of images you would like to include in your ZIP export.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          {isDownloading ? (
            <div className="flex flex-col items-center justify-center h-48">
              <Loader2 className="h-12 w-12 animate-spin text-primary" />
              <p className="mt-4 text-muted-foreground">{progressMessage}</p>
              <Progress value={progress} className="w-full mt-2" />
            </div>
          ) : (
            <RadioGroup value={scope} onValueChange={(value: ExportScope) => setScope(value)}>
              <div className="space-y-2">
                {options.map(opt => <ExportOption key={opt.value} {...opt} selected={scope} onSelect={setScope} />)}
              </div>
            </RadioGroup>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={isDownloading}>Cancel</Button>
          <Button onClick={handleDownload} disabled={isDownloading}>
            {isDownloading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            {t('startDownload')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};