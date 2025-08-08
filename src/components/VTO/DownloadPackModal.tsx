import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Loader2, List, Shirt, Users, PersonStanding, Database, Download } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { useSession } from '@/components/Auth/SessionContextProvider';
import { showError, showLoading, dismissToast, showSuccess } from '@/utils/toast';
import { cn } from '@/lib/utils';

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
  const [isStarting, setIsStarting] = useState(false);

  const handleStartExport = async () => {
    if (!pack || !session?.user) return;
    setIsStarting(true);
    const toastId = showLoading("Initiating export job...");

    try {
      const { error } = await supabase.functions.invoke('MIRA-AGENT-orchestrator-pack-export', {
        body: {
          pack_id: pack.pack_id,
          user_id: session.user.id,
          export_structure: structure,
        }
      });

      if (error) throw error;

      dismissToast(toastId);
      showSuccess("Export started! You will be notified when your download is ready.");
      onClose();
    } catch (err: any) {
      dismissToast(toastId);
      showError(`Failed to start export: ${err.message}`);
    } finally {
      setIsStarting(false);
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
          <RadioGroup value={structure} onValueChange={(value: ExportStructure) => setStructure(value)}>
            <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-2">
              {options.map(opt => <ExportOption key={opt.value} {...opt} selected={structure} onSelect={setStructure} />)}
            </div>
          </RadioGroup>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={isStarting}>Cancel</Button>
          <Button onClick={handleStartExport} disabled={isStarting}>
            {isStarting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            Start Export
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};