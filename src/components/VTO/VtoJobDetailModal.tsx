import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle, Eye, History, Layers, Info, CheckCircle, XCircle, Cpu, Route, ShieldCheck } from "lucide-react";
import { BitStudioJob } from "@/types/vto";
import { SecureImageDisplay } from "./SecureImageDisplay";
import { useState } from "react";
import { DebugStepsModal } from "./DebugStepsModal";
import { FixHistoryModal } from "./FixHistoryModal";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ImageCompareModal } from "@/components/ImageCompareModal";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "@/components/ui/carousel";

interface VtoJobDetailModalProps {
  job: BitStudioJob | null;
  isOpen: boolean;
  onClose: () => void;
}

const getEngineName = (engine?: string) => {
    if (!engine) return 'Unknown';
    if (engine === 'google') return 'Google VTO';
    if (engine === 'bitstudio') return 'BitStudio VTO';
    if (engine === 'bitstudio_fallback') return 'BitStudio VTO (Fallback)';
    return engine.charAt(0).toUpperCase() + engine.slice(1);
};

const QaResultDisplay = ({ verification }: { verification: any }) => {
    if (!verification) {
        return <Badge variant="secondary">Not Performed</Badge>;
    }
    if (verification.error) {
        return <Badge variant="destructive">Error</Badge>;
    }
    if (verification.is_match) {
        return <Badge className="bg-green-600 hover:bg-green-700"><CheckCircle className="h-4 w-4 mr-1" /> Passed</Badge>;
    }
    return <Badge variant="destructive"><XCircle className="h-4 w-4 mr-1" /> Failed</Badge>;
};

const PathSummary = ({ job }: { job: BitStudioJob }) => {
    const steps = [];
    const engine = job.metadata?.engine || 'unknown';
    steps.push(getEngineName(engine));

    if (engine === 'google') {
        const googleStep = job.metadata?.google_vto_step;
        if (googleStep) {
            steps.push(googleStep.replace(/_/g, ' '));
        }
    }

    if (job.metadata?.fix_history && job.metadata.fix_history.length > 0) {
        steps.push(`Fixer Pipeline (${job.metadata.fix_history.length} attempts)`);
    }

    if (job.metadata?.delegated_reframe_job_id) {
        steps.push('Reframe');
    }

    return (
        <div className="flex flex-wrap items-center gap-2">
            {steps.map((step, index) => (
                <Badge key={index} variant="outline" className="capitalize">{step}</Badge>
            ))}
        </div>
    );
};

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
  const verification = job.metadata?.verification_result;

  const beforeImageUrl = job.source_person_image_url;
  const afterImageUrl = job.final_image_url;

  const lastQaReport = job.metadata?.qa_history?.[job.metadata.qa_history.length - 1];
  const variations = job.metadata?.generated_variations;

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className={cn("transition-all duration-300", (isRefinementJob || isAutoCompleteJob) ? "max-w-6xl" : "max-w-4xl")}>
          <DialogHeader>
            <DialogTitle>Job Details</DialogTitle>
            <DialogDescription>
              Job ID: {job.id}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 py-4">
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
          
          <Card>
            <CardHeader>
                <CardTitle className="text-base">Process Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-muted-foreground"><Cpu className="h-4 w-4" /><span>Engine</span></div>
                    <Badge variant="secondary">{getEngineName(job.metadata?.engine)}</Badge>
                </div>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-muted-foreground"><ShieldCheck className="h-4 w-4" /><span>Final Quality Check</span></div>
                    <QaResultDisplay verification={verification} />
                </div>
                <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2 text-muted-foreground"><Route className="h-4 w-4 mt-1" /><span>Processing Path</span></div>
                    <div className="max-w-xs text-right"><PathSummary job={job} /></div>
                </div>
                {verification && !verification.is_match && (
                    <div className="pt-2 border-t">
                        <p><strong>Reason:</strong> {verification.mismatch_reason || 'N/A'}</p>
                        <p><strong>Suggestion:</strong> {verification.fix_suggestion || 'N/A'}</p>
                    </div>
                )}
            </CardContent>
          </Card>

          {variations && variations.length > 1 && lastQaReport && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">AI Quality Check Candidates</CardTitle>
                <CardDescription>
                  The AI generated {variations.length} options and selected the best one based on its analysis.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-xs italic text-muted-foreground mb-2">
                  <strong>AI Reasoning:</strong> {lastQaReport.reasoning}
                </p>
                <Carousel>
                  <CarouselContent className="-ml-2">
                    {variations.map((image: any, index: number) => {
                      const isSelected = index === lastQaReport.best_image_index;
                      return (
                        <CarouselItem key={index} className="pl-2 basis-1/3 md:basis-1/4 lg:basis-1/5">
                          <div className={cn("p-1", isSelected && "border-2 border-green-500 rounded-md")}>
                            <div className="relative aspect-square">
                              <img 
                                src={`data:image/jpeg;base64,${image.base64Image}`} 
                                alt={`Candidate ${index + 1}`}
                                className="w-full h-full object-cover rounded-md"
                              />
                              {isSelected && (
                                <div className="absolute top-1 right-1 bg-green-500 text-white rounded-full p-1">
                                  <CheckCircle className="h-4 w-4" />
                                </div>
                              )}
                            </div>
                          </div>
                        </CarouselItem>
                      );
                    })}
                  </CarouselContent>
                  <CarouselPrevious className="absolute -left-4 top-1/2 -translate-y-1/2" />
                  <CarouselNext className="absolute -right-4 top-1/2 -translate-y-1/2" />
                </Carousel>
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