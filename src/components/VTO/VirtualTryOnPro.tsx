import React, { useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import { BatchInpaintPro } from "./BatchInpaintPro";
import { BitStudioJob } from "@/types/vto";
import { RecentJobsList } from "./RecentJobsList";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Info, Eye, CheckCircle, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useImagePreview } from "@/context/ImagePreviewContext";
import { SecureImageDisplay } from "./SecureImageDisplay";
import { DebugStepsModal } from "./DebugStepsModal";
import { Badge } from "@/components/ui/badge";

interface VirtualTryOnProProps {
    recentJobs: BitStudioJob[] | undefined;
    isLoadingRecentJobs: boolean;
    selectedJob: BitStudioJob | undefined;
    handleSelectJob: (job: BitStudioJob) => void;
    resetForm: () => void;
    transferredImageUrl: string | null;
    onTransferConsumed: () => void;
}

const VirtualTryOnPro = ({
  recentJobs, isLoadingRecentJobs, selectedJob, handleSelectJob
}: VirtualTryOnProProps) => {
  const { t } = useLanguage();
  const { showImage } = useImagePreview();
  const [isDebugModalOpen, setIsDebugModalOpen] = useState(false);

  const renderJobResult = (job: BitStudioJob) => {
    const isFailed = job.status === 'failed' || job.status === 'permanently_failed';
    const hasDebugAssets = !!job.metadata?.debug_assets || (job.metadata?.qa_history && job.metadata.qa_history.length > 0);

    if (isFailed) {
      return (
        <div className="space-y-4">
          <div className="relative group w-full h-full">
            <SecureImageDisplay imageUrl={job.metadata?.source_image_url || job.source_person_image_url || null} alt="Source of Failed Job" />
            {hasDebugAssets && (
              <Button 
                variant="secondary" 
                className="absolute bottom-2 right-2"
                onClick={(e) => { e.stopPropagation(); setIsDebugModalOpen(true); }}
              >
                <Eye className="mr-2 h-4 w-4" />
                Show Debug
              </Button>
            )}
          </div>
          <Alert variant="destructive">
            <AlertTitle>Job Failed</AlertTitle>
            <AlertDescription>{job.error_message || "An unknown error occurred."}</AlertDescription>
          </Alert>
        </div>
      );
    }

    if (job.status === 'complete' && job.final_image_url) {
      const verification = job.metadata?.verification_result;
      return (
        <div className="space-y-4">
          <div className="relative group w-full h-full">
            <SecureImageDisplay imageUrl={job.final_image_url} alt="Final Result" onClick={() => showImage({ images: [{ url: job.final_image_url! }], currentIndex: 0 })} />
            {hasDebugAssets && (
              <Button 
                variant="secondary" 
                className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsDebugModalOpen(true);
                }}
              >
                <Eye className="mr-2 h-4 w-4" />
                Show Debug
              </Button>
            )}
          </div>
          {verification && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  Verification Result
                  {verification.is_match ? (
                    <Badge variant="default" className="bg-green-600 hover:bg-green-700">
                      <CheckCircle className="h-4 w-4 mr-1" /> Match
                    </Badge>
                  ) : (
                    <Badge variant="destructive">
                      <XCircle className="h-4 w-4 mr-1" /> Mismatch
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {verification.error ? (
                  <p className="text-sm text-destructive">{verification.error}</p>
                ) : verification.is_match ? (
                  <p className="text-sm text-muted-foreground">The generated garment is a good match to the reference.</p>
                ) : (
                  <div className="text-sm space-y-2">
                    <p><strong className="font-medium">Reason:</strong> {verification.mismatch_reason || 'No reason provided.'}</p>
                    <p><strong className="font-medium">Suggestion:</strong> {verification.fix_suggestion || 'No suggestion provided.'}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      );
    }
    return (
      <div className="text-center text-muted-foreground">
        <Loader2 className="h-12 w-12 mx-auto animate-spin" />
        <p className="mt-4">{t('jobStatus', { status: job.status })}</p>
      </div>
    );
  };

  return (
    <>
      <Alert className="mb-6">
        <Info className="h-4 w-4" />
        <AlertTitle>{t('proMode')}</AlertTitle>
        <AlertDescription>
          {t('vtoProModeDescription')}
          <br />
          <strong className="mt-2 block">{t('vtoProModeDisclaimer')}</strong>
        </AlertDescription>
      </Alert>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1">
            <BatchInpaintPro />
        </div>
        <div className="lg:col-span-2 space-y-4">
            <Card className="h-full flex flex-col min-h-[500px]">
                <CardHeader><CardTitle>{t('result')}</CardTitle></CardHeader>
                <CardContent className="flex-1 flex items-center justify-center overflow-hidden p-2">
                    {selectedJob ? renderJobResult(selectedJob) : <div className="text-center text-muted-foreground"><p>{t('selectJobToView')}</p></div>}
                </CardContent>
            </Card>
            <RecentJobsList 
                jobs={recentJobs}
                isLoading={isLoadingRecentJobs}
                selectedJobId={selectedJob?.id || null}
                onSelectJob={handleSelectJob}
                mode="inpaint"
            />
        </div>
      </div>
      <DebugStepsModal 
        isOpen={isDebugModalOpen}
        onClose={() => setIsDebugModalOpen(false)}
        qaHistory={selectedJob?.metadata?.qa_history || []}
        finalAssets={selectedJob?.metadata?.debug_assets || null}
      />
    </>
  );
};

export default VirtualTryOnPro;