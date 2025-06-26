import React from "react";
import { useLanguage } from "@/context/LanguageContext";
import { BatchInpaintPro } from "./BatchInpaintPro";
import { BitStudioJob } from "@/types/vto";
import { RecentJobsList } from "./RecentJobsList";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Info } from "lucide-react";

interface VirtualTryOnProProps {
    recentJobs: BitStudioJob[] | undefined;
    isLoadingRecentJobs: boolean;
    selectedJob: BitStudioJob | undefined;
    handleSelectJob: (job: BitStudioJob) => void;
}

const VirtualTryOnPro = ({
  recentJobs, isLoadingRecentJobs, selectedJob, handleSelectJob
}: VirtualTryOnProProps) => {
  const { t } = useLanguage();

  return (
    <>
      <Alert className="mb-6">
        <Info className="h-4 w-4" />
        <AlertTitle>{t('proMode')}</AlertTitle>
        <AlertDescription>
          {t('vtoProModeDescription')}
        </AlertDescription>
      </Alert>
      <BatchInpaintPro />
      <div className="mt-4">
        <RecentJobsList 
            jobs={recentJobs}
            isLoading={isLoadingRecentJobs}
            selectedJobId={selectedJob?.id || null}
            onSelectJob={handleSelectJob}
            mode="inpaint"
        />
      </div>
    </>
  );
};

export default VirtualTryOnPro;