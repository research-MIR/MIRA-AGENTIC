import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle, Eye, History } from "lucide-react";
import { BitStudioJob } from "@/types/vto";
import { SecureImageDisplay } from "./SecureImageDisplay";
import { useState } from "react";
import { DebugStepsModal } from "./DebugStepsModal";
import { FixHistoryModal } from "./FixHistoryModal";

interface VtoJobDetailModalProps {
  job: BitStudioJob | null;
  isOpen: boolean;
  onClose: () => void;
}

export const VtoJobDetailModal = ({ job, isOpen, onClose }: VtoJobDetailModalProps) => {
  const [isDebugModalOpen, setIsDebugModalOpen] = useState(false);
  const [isFixHistoryModalOpen, setIsFixHistoryModalOpen] = useState(false);

  if (!isOpen || !job) return null;

  const isFailed = job.status === 'failed' || job.status === 'permanently_failed';
  const hasDebugAssets = !!job.metadata?.debug_assets;
  const hasFixHistory = !!job.metadata?.fix_history && job.metadata.fix_history.length > 0;

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Job Details</DialogTitle>
            <DialogDescription>Job ID: {job.id}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-center">Source Person</h3>
              <div className="aspect-square bg-muted rounded-md">
                <SecureImageDisplay imageUrl={job.source_person_image_url || null} alt="Source Person" />
              </div>
            </div>
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-center">Final Result</h3>
              <div className="aspect-square bg-muted rounded-md">
                <SecureImageDisplay imageUrl={job.final_image_url || null} alt="Final Result" />
              </div>
            </div>
          </div>
          {isFailed && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Job Failed</AlertTitle>
              <AlertDescription>{job.error_message || "An unknown error occurred."}</AlertDescription>
            </Alert>
          )}
          <DialogFooter className="gap-2">
            {hasDebugAssets && <Button variant="secondary" onClick={() => setIsDebugModalOpen(true)}><Eye className="mr-2 h-4 w-4" />Show Debug</Button>}
            {hasFixHistory && <Button variant="secondary" onClick={() => setIsFixHistoryModalOpen(true)}><History className="mr-2 h-4 w-4" />Fix History</Button>}
            <Button onClick={onClose}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <DebugStepsModal isOpen={isDebugModalOpen} onClose={() => setIsDebugModalOpen(false)} assets={job.metadata?.debug_assets || null} />
      <FixHistoryModal isOpen={isFixHistoryModalOpen} onClose={() => setIsFixHistoryModalOpen(false)} job={job} />
    </>
  );
};