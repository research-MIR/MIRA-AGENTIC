import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Loader2, List, Shirt, Users, PersonStanding, Database, Download } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { useSession } from '@/components/Auth/SessionContextProvider';
import { showError, showSuccess } from '@/utils/toast';
import { cn } from '@/lib/utils';
import JSZip from 'jszip';
import { Progress } from '@/components/ui/progress';

type ExportStructure = 'flat' | 'by_garment' | 'by_model' | 'by_pose' | 'data_export';

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

const ExportOption = ({ value, title, description, structure, icon, selected, onSelect }: any) => (
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
      <pre className="text-xs bg-muted p-2 rounded-md mt-2 whitespace-pre-wrap">{structure}</pre>
    </div>
  </div>
);

export const DownloadPackModal = ({ isOpen, onClose, pack }: DownloadPackModalProps) => {
  const { t } = useLanguage();
  const { supabase, session } = useSession();
  const [structure, setStructure] = useState<ExportStructure>('by_garment');
  const [isDownloading, setIsDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');

  const handleDownload = async () => {
    if (!pack || !session?.user) return;
    setIsDownloading(true);
    setProgress(0);
    setProgressMessage("Fetching job list...");

    try {
      // Step 1: Fetch all job details for the pack
      const { data: jobs, error: jobsError } = await supabase
        .from('mira-agent-bitstudio-jobs')
        .select('id, status, final_image_url, source_person_image_url, source_garment_image_url, metadata')
        .eq('vto_pack_job_id', pack.pack_id)
        .eq('user_id', session.user.id)
        .in('status', ['complete', 'done']);
      
      if (jobsError) throw jobsError;
      if (!jobs || jobs.length === 0) throw new Error("No completed jobs found to export.");

      const zip = new JSZip();
      const totalFiles = jobs.length;
      let processedCount = 0;

      // Step 2: Download and add files to zip one by one
      for (const job of jobs) {
        processedCount++;
        setProgress((processedCount / totalFiles) * 100);
        setProgressMessage(`Downloading ${processedCount}/${totalFiles}...`);

        if (!job.final_image_url) continue;

        const modelId = job.metadata?.model_generation_job_id || 'unknown_model';
        const garmentUrl = job.source_garment_image_url || 'unknown_garment';
        const garmentId = garmentUrl.split('/').pop()?.split('.')[0] || 'unknown_garment';
        const posePrompt = job.metadata?.prompt_used || 'unknown_pose';
        const poseId = sanitize(posePrompt);
        const filename = `${sanitize(modelId)}_${sanitize(garmentId)}_${poseId}.jpg`;
        let folderPath = '';

        switch (structure) {
            case 'by_garment': folderPath = `By_Garment/${sanitize(garmentId)}/`; break;
            case 'by_model': folderPath = `By_Model/${sanitize(modelId)}/`; break;
            case 'by_pose': folderPath = `By_Pose/${poseId}/`; break;
            case 'data_export': folderPath = 'images/'; break;
            case 'flat': default: folderPath = ''; break;
        }

        try {
          const response = await fetch(job.final_image_url);
          if (!response.ok) continue;
          const blob = await response.blob();
          zip.file(`${folderPath}${filename}`, blob);
        } catch (e) {
          console.error(`Failed to fetch ${job.final_image_url}`, e);
        }
      }

      // Step 3: Generate and trigger download
      setProgressMessage("Zipping files...");
      const content = await zip.generateAsync({ type: "blob" });
      
      const link = document.createElement('a');
      link.href = URL.createObjectURL(content);
      link.download = `${pack.metadata?.name || pack.pack_id}.zip`;
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
    { value: 'by_garment', title: 'By Garment (for Product Analysis)', description: 'Creates a folder for each garment, containing all model images wearing it.', structure: `[Garment_ID]/\n  - [Model_ID]_[Pose].jpg\n  - ...`, icon: <Shirt className="h-5 w-5" /> },
    { value: 'by_model', title: 'By Model (for Lookbooks)', description: 'Creates a folder for each model, containing all images of them wearing different garments.', structure: `[Model_ID]/\n  - [Garment_ID]_[Pose].jpg\n  - ...`, icon: <Users className="h-5 w-5" /> },
    { value: 'by_pose', title: 'By Pose (for Technical Analysis)', description: 'Creates a folder for each pose, containing all models and garments in that pose.', structure: `[Pose_ID]/\n  - [Model_ID]_[Garment_ID].jpg\n  - ...`, icon: <PersonStanding className="h-5 w-5" /> },
    { value: 'flat', title: 'Simple List (Quick Review)', description: 'All images in a single folder, named with their IDs.', structure: `[Model]_[Garment]_[Pose].jpg\n...`, icon: <List className="h-5 w-5" /> },
    { value: 'data_export', title: 'Data Export (for Analysts)', description: 'Exports all images plus a CSV file with detailed metadata for each job.', structure: `images/\nreport.csv`, icon: <Database className="h-5 w-5" /> },
  ];

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Advanced Export: {pack?.metadata?.name}</DialogTitle>
          <DialogDescription>
            Choose how to organize the generated images to facilitate analysis and review.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          {isDownloading ? (
            <div className="flex flex-col items-center justify-center h-64">
              <Loader2 className="h-12 w-12 animate-spin text-primary" />
              <p className="mt-4 text-muted-foreground">{progressMessage}</p>
              <Progress value={progress} className="w-full mt-2" />
            </div>
          ) : (
            <RadioGroup value={structure} onValueChange={(value: ExportStructure) => setStructure(value)}>
              <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-2">
                {options.map(opt => <ExportOption key={opt.value} {...opt} selected={structure} onSelect={setStructure} />)}
              </div>
            </RadioGroup>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={isDownloading}>Cancel</Button>
          <Button onClick={handleDownload} disabled={isDownloading}>
            {isDownloading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            Start Download
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};