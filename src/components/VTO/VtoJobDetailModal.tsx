import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle, Eye, History, Layers, Info, CheckCircle, XCircle } from "lucide-react";
import { BitStudioJob } from "@/types/vto";
import { SecureImageDisplay } from "./SecureImageDisplay";
import { useState } from "react";
import { DebugStepsModal } from "./DebugStepsModal";
import { FixHistoryModal } from "./FixHistoryModal";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ImageCompareModal } from "@/components/ImageCompareModal";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";

interface VtoJobDetailModalProps {
  job: BitStudioJob | null;
  isOpen: boolean;
  onClose: () => void;
}

export const VtoJobDetailModal = ({ job, isOpen, onClose }: VtoJobDetailModalProps) => {
  const [isDebugModalOpen, setIsDebugModalOpen] = useState(false);
  const [isFixHistoryModalOpen, setIsFixHistoryModalOpen] = useState(false);
  const [isCompareModalOpen, setIsCompareModalOpen] = useState(false);

  if (!isOpen || !job) return null;

  const isFailed = job.status === 'failed' || job.status === 'permanently_failed';
  const hasDebugAssets = !!job.metadata?.debug_assets;
  const hasFixHistory = !!job.metadata?.fix_history && job.metadata.fix_history.length > 0;

  const isRefinementJob = !!job.metadata?.original_person_image_url_for_analysis;
  const isAutoCompleteJob = job.metadata?.pass_number === 2;
  
  const wasOutfitCheckSkipped = job.metadata?.outfit_analysis_skipped === true;
  const outfitCheckError = job.metadata?.outfit_analysis_error;
  const outfitAnalysis = job.metadata?.outfit_completeness_analysis;

  const getEngineName = (engine?: string) => {
    if (!engine) return 'Unknown';
    if (engine === 'google') return 'Google VTO';
    if (engine === 'bitstudio') return 'BitStudio VTO';
    if (engine === 'bitstudio_fallback') return 'BitStudio VTO (Fallback)';
    return engine.charAt(0).toUpperCase();
  };

  const beforeImageUrl = job.source_person_image_url;
  const afterImageUrl = job.final_image_url;

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className={cn("transition-all duration-300", (isRefinementJob || isAutoCompleteJob) ? "max-w-6xl" : "max-w-4xl")}>
          <DialogHeader>
            <DialogTitle>Job Details</DialogTitle>
            <DialogDescription>
              Job ID: {job.id}
              {job.metadata?.engine && <Badge variant="outline" className="ml-2">{getEngineName(job.metadata.engine)}</Badge>}
            </DialogDescription>
          </DialogHeader>
          <div className={cn("grid gap-4 py-4", isRefinementJob ? "grid-cols-1 md:grid-cols-3" : "grid-cols-1 md:grid-cols-2")}>
            {isRefinementJob ? (
              <>
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-center">Original Person</h3>
                  <div className="aspect-square bg-muted rounded-md">
                    <SecureImageDisplay imageUrl={job.metadata?.original_person_image_url_for_analysis || null} alt="Original Person" />
                  </div>
                </div>
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-center">Pass 1 Result (Source)</h3>
                  <div className="aspect-square bg-muted rounded-md">
                    <SecureImageDisplay imageUrl={job.source_person_image_url || null} alt="Pass 1 Result" />
                  </div>
                </div>
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-center">Final Refined Result</h3>
                  <div className="aspect-square bg-muted rounded-md">
                    <SecureImageDisplay imageUrl={job.final_image_url || null} alt="Final Result" />
                  </div>
                </div>
              </>
            ) : isAutoCompleteJob ? (
              <>
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-center">Before Auto-Complete</h3>
                  <div className="aspect-square bg-muted rounded-md">
                    <SecureImageDisplay imageUrl={job.source_person_image_url || null} alt="Before Auto-Complete" />
                  </div>
                </div>
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-center">After Auto-Complete</h3>
                  <div className="aspect-square bg-muted rounded-md">
                    <SecureImageDisplay imageUrl={job.final_image_url || null} alt="After Auto-Complete" />
                  </div>
                </div>
              </>
            ) : (
              <>
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
              </>
            )}
          </div>
          {outfitAnalysis && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  Outfit Completeness Analysis
                  {outfitAnalysis.is_outfit_complete ? (
                    <Badge variant="default" className="bg-green-600 hover:bg-green-700">
                      <CheckCircle className="h-4 w-4 mr-1" /> Complete
                    </Badge>
                  ) : (
                    <Badge variant="destructive">
                      <XCircle className="h-4 w-4 mr-1" /> Incomplete
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-2">
                <p className="italic text-muted-foreground">"{outfitAnalysis.reasoning}"</p>
                {!outfitAnalysis.is_outfit_complete && outfitAnalysis.missing_items.length > 0 && (
                  <div>
                    <strong className="font-medium">Missing Items:</strong>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {outfitAnalysis.missing_items.map(item => (
                        <Badge key={item} variant="secondary">{item.replace(/_/g, ' ')}</Badge>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
          {wasOutfitCheckSkipped && (
            <Alert variant="default">
              <Info className="h-4 w-4" />
              <AlertTitle>Process Note</AlertTitle>
              <AlertDescription>
                The automated "Outfit Completeness" check was skipped.
                {outfitCheckError && <p className="text-xs mt-1"><strong>Reason:</strong> {outfitCheckError}</p>}
              </AlertDescription>
            </Alert>
          )}
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
            {beforeImageUrl && afterImageUrl && (
              <Button variant="outline" onClick={() => setIsCompareModalOpen(true)}>
                <Layers className="mr-2 h-4 w-4" />
                Compare
              </Button>
            )}
            <Button onClick={onClose}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <DebugStepsModal isOpen={isDebugModalOpen} onClose={() => setIsDebugModalOpen(false)} assets={job.metadata?.debug_assets || null} />
      <FixHistoryModal isOpen={isFixHistoryModalOpen} onClose={() => setIsFixHistoryModalOpen(false)} job={job} />
      {beforeImageUrl && afterImageUrl && (
        <ImageCompareModal
          isOpen={isCompareModalOpen}
          onClose={() => setIsCompareModalOpen(false)}
          beforeUrl={beforeImageUrl}
          afterUrl={afterImageUrl}
        />
      )}
    </>
  );
};