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
import { Loader2, Download, CheckCircle, ImageIcon, Shirt, Users, List } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { useSession } from '@/components/Auth/SessionContextProvider';
import { showError, showSuccess } from '@/utils/toast';
import { cn } from '@/lib/utils';
import JSZip from 'jszip';
import { Progress } from '@/components/ui/progress';

type ExportScope = 'all_with_image' | 'passed_qa';
type ExportStructure = 'by_garment' | 'by_model' | 'flat';

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
  const [structure, setStructure] = useState<ExportStructure>('by_garment');
  const [isDownloading, setIsDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');

  const handleDownload = async () => {
    if (!pack || !session?.user) return;
    setIsDownloading(true);
    setProgress(0);
    setProgressMessage("Fetching job list...");
    console.log(`[DownloadPack] Starting download for pack: ${pack.pack_id}`);
    console.log(`[DownloadPack] Scope: ${scope}, Structure: ${structure}`);

    try {
      let jobsToDownload: any[] = [];

      if (scope === 'all_with_image') {
        const { data, error } = await supabase
          .from('mira-agent-bitstudio-jobs')
          .select('id, final_image_url, source_person_image_url, source_garment_image_url, metadata, batch_pair_job_id')
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
          .select('id, final_image_url, source_person_image_url, source_garment_image_url, metadata, batch_pair_job_id')
          .in('id', jobIds);
        if (error) throw error;
        jobsToDownload = data;
      }

      console.log(`[DownloadPack] Found ${jobsToDownload.length} total jobs to process.`);
      console.log(`[DownloadPack] First job data sample:`, jobsToDownload[0]);


      if (jobsToDownload.length === 0) {
        throw new Error("No images found for the selected criteria.");
      }

      const zip = new JSZip();
      const totalFiles = jobsToDownload.length;
      let processedCount = 0;

      for (const job of jobsToDownload) {
        processedCount++;
        setProgress((processedCount / totalFiles) * 100);
        const progressMsg = `Downloading ${processedCount}/${totalFiles}...`;
        setProgressMessage(progressMsg);
        
        if (!job.final_image_url) {
            console.warn(`[DownloadPack] Job ${job.id} has no final_image_url. Skipping.`);
            continue;
        }

        // --- HIERARCHICAL ID LOGIC ---
        let poseIdSource = 'unknown';
        let poseId = 'model_unknown';

        if (job.metadata?.original_vto_job_id) {
            poseId = job.metadata.original_vto_job_id.substring(0, 8);
            poseIdSource = 'metadata.original_vto_job_id (Refinement Pass)';
        } else if (job.metadata?.model_generation_job_id) {
            poseId = job.metadata.model_generation_job_id.substring(0, 8);
            poseIdSource = 'metadata.model_generation_job_id (First Pass)';
        } else if (job.source_person_image_url) {
            const urlParts = job.source_person_image_url.split('/');
            const filename = urlParts.pop()?.split('.')[0] || '';
            const timestampMatch = filename.match(/\d{13}/);
            if (timestampMatch) {
                poseId = timestampMatch[0].substring(7);
                poseIdSource = 'source_person_image_url (timestamp parsing)';
            } else {
                poseId = filename.substring(0, 8);
                poseIdSource = 'source_person_image_url (fallback parsing)';
            }
        }

        let garmentIdSource = 'unknown';
        let garmentId = 'garment_unknown';

        if (job.metadata?.garment_analysis?.hash) {
            garmentId = job.metadata.garment_analysis.hash.substring(0, 8);
            garmentIdSource = 'metadata.garment_analysis.hash';
        } else if (job.source_garment_image_url) {
            const urlParts = job.source_garment_image_url.split('/');
            const filename = urlParts.pop()?.split('.')[0] || '';
            const uuidMatch = filename.match(/[a-f0-9]{8}-[a-f0-9]{4}/i);
            if (uuidMatch) {
                garmentId = uuidMatch[0];
                garmentIdSource = 'source_garment_image_url (UUID parsing)';
            } else {
                const timestampMatch = filename.match(/\d{13}/);
                if (timestampMatch) {
                    garmentId = timestampMatch[0].substring(7);
                    garmentIdSource = 'source_garment_image_url (timestamp parsing)';
                } else {
                    garmentId = filename.substring(0, 20);
                    garmentIdSource = 'source_garment_image_url (fallback parsing)';
                }
            }
        }
        // --- END OF HIERARCHICAL LOGIC ---
        
        const filename = `Pose_${poseId}_Garment_${garmentId}.jpg`;
        let filePathInZip = '';

        switch (structure) {
          case 'by_garment':
            filePathInZip = `By_Garment/${sanitize(garmentId)}/${filename}`;
            break;
          case 'by_model':
            filePathInZip = `By_Model/${sanitize(poseId)}/${filename}`;
            break;
          case 'flat':
            filePathInZip = filename;
            break;
        }

        console.log(`[DownloadPack] Processing Job ${processedCount}/${totalFiles}:`, {
            jobId: job.id,
            poseId: poseId,
            poseIdSource: poseIdSource,
            garmentId: garmentId,
            garmentIdSource: garmentIdSource,
            finalFilename: filename,
            finalPathInZip: filePathInZip,
        });
        
        try {
          const response = await fetch(job.final_image_url);
          if (!response.ok) {
              console.warn(`[DownloadPack] Failed to fetch ${job.final_image_url}. Status: ${response.status}. Skipping.`);
              continue;
          }
          const blob = await response.blob();
          zip.file(filePathInZip, blob);
        } catch (e) {
          console.error(`[DownloadPack] Exception while fetching ${job.final_image_url}:`, e);
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

  const scopeOptions = [
    { value: 'all_with_image', title: t('downloadAllWithImage'), description: t('downloadAllWithImageDesc'), icon: <ImageIcon className="h-5 w-5" /> },
    { value: 'passed_qa', title: t('downloadPassedQa'), description: t('downloadPassedQaDesc'), icon: <CheckCircle className="h-5 w-5" /> },
  ];

  const structureOptions = [
    { value: 'by_garment', title: t('downloadByGarment'), description: t('downloadByGarmentDesc'), icon: <Shirt className="h-5 w-5" /> },
    { value: 'by_model', title: t('downloadByModel'), description: t('downloadByModelDesc'), icon: <Users className="h-5 w-5" /> },
    { value: 'flat', title: t('downloadFlat'), description: t('downloadFlatDesc'), icon: <List className="h-5 w-5" /> },
  ];

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('downloadOptions')}: {pack?.metadata?.name}</DialogTitle>
          <DialogDescription>
            Choose which images to include and how to organize them in the final ZIP file.
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h3 className="font-semibold mb-2">1. Select Images to Include</h3>
                <RadioGroup value={scope} onValueChange={(value: ExportScope) => setScope(value)}>
                  <div className="space-y-2">
                    {scopeOptions.map(opt => <ExportOption key={opt.value} {...opt} selected={scope} onSelect={setScope} />)}
                  </div>
                </RadioGroup>
              </div>
              <div>
                <h3 className="font-semibold mb-2">2. Choose Folder Structure</h3>
                <RadioGroup value={structure} onValueChange={(value: ExportStructure) => setStructure(value)}>
                  <div className="space-y-2">
                    {structureOptions.map(opt => <ExportOption key={opt.value} {...opt} selected={structure} onSelect={setStructure} />)}
                  </div>
                </RadioGroup>
              </div>
            </div>
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