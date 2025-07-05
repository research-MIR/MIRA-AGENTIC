import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { useLanguage } from "@/context/LanguageContext";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SingleTryOn } from "@/components/VTO/SingleTryOn";
import { BatchTryOn } from "@/components/VTO/BatchTryOn";
import VirtualTryOnPro from "@/components/VTO/VirtualTryOnPro";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import ReactMarkdown from "react-markdown";
import { useImageTransferStore } from "@/store/imageTransferStore";
import { BitStudioJob } from "@/types/vto";
import { useVTOJobs } from "@/hooks/useVTOJobs";
import { RecentJobsList } from "@/components/VTO/RecentJobsList";
import { Star, HelpCircle } from "lucide-react";

const VirtualTryOn = () => {
  const { isProMode, toggleProMode } = useSession();
  const { t } = useLanguage();
  
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [isHelpModalOpen, setIsHelpModalOpen] = useState(false);
  
  const { consumeImageUrl, imageUrlToTransfer, vtoTarget } = useImageTransferStore();
  const { jobs, isLoading: isLoadingRecentJobs } = useVTOJobs();

  useEffect(() => {
    if (imageUrlToTransfer && vtoTarget) {
      if (vtoTarget === 'pro-source' && !isProMode) {
        toggleProMode();
      }
      if (vtoTarget === 'base' && isProMode) {
        toggleProMode();
      }
    }
  }, [imageUrlToTransfer, vtoTarget, isProMode, toggleProMode]);

  const selectedJob = useMemo(() => jobs?.find(job => job.id === selectedJobId), [jobs, selectedJobId]);

  const resetForm = useCallback(() => {
    setSelectedJobId(null);
    consumeImageUrl();
  }, [consumeImageUrl]);

  useEffect(() => {
    resetForm();
  }, [isProMode, resetForm]);

  const handleSelectJob = (job: BitStudioJob) => {
    setSelectedJobId(job.id);
  };

  return (
    <>
      <div className="p-4 md:p-8 h-screen flex flex-col">
        <header className="pb-4 mb-4 border-b shrink-0 flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold">{t('virtualTryOn')}</h1>
            <p className="text-muted-foreground">{t('vtoDescription')}</p>
          </div>
          <div className="flex items-center space-x-2">
            <Button variant="ghost" size="icon" onClick={() => setIsHelpModalOpen(true)}>
              <HelpCircle className="h-6 w-6" />
            </Button>
            <Label htmlFor="pro-mode-switch" className="flex items-center gap-2">
              <Star className="text-yellow-500" />
              {t('proMode')}
            </Label>
            <Switch id="pro-mode-switch" checked={isProMode} onCheckedChange={toggleProMode} />
          </div>
        </header>
        
        <div className="flex-1 overflow-y-auto">
          {isProMode ? (
            <VirtualTryOnPro 
              recentJobs={jobs}
              isLoadingRecentJobs={isLoadingRecentJobs}
              selectedJob={selectedJob}
              handleSelectJob={handleSelectJob}
              resetForm={resetForm}
              transferredImageUrl={vtoTarget === 'pro-source' ? imageUrlToTransfer : null}
              onTransferConsumed={consumeImageUrl}
            />
          ) : (
            <div className="h-full">
              <Tabs defaultValue="single" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="single">{t('singleTryOn')}</TabsTrigger>
                  <TabsTrigger value="batch">{t('batchProcess')}</TabsTrigger>
                </TabsList>
                <TabsContent value="single" className="pt-6">
                  <p className="text-sm text-muted-foreground mb-6">{t('singleVtoDescription')}</p>
                  <SingleTryOn 
                    selectedJob={selectedJob} 
                    resetForm={resetForm} 
                    transferredImageUrl={vtoTarget === 'base' ? imageUrlToTransfer : null}
                    onTransferConsumed={consumeImageUrl}
                  />
                </TabsContent>
                <TabsContent value="batch" className="pt-6">
                  <p className="text-sm text-muted-foreground mb-6">{t('batchVtoDescription')}</p>
                  <BatchTryOn />
                </TabsContent>
              </Tabs>
              <div className="mt-8">
                <RecentJobsList 
                    jobs={jobs}
                    isLoading={isLoadingRecentJobs}
                    selectedJobId={selectedJobId}
                    onSelectJob={handleSelectJob}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      <Dialog open={isHelpModalOpen} onOpenChange={setIsHelpModalOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('vtoHelpTitle')}</DialogTitle>
            <DialogDescription>{t('vtoHelpIntro')}</DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[70vh] pr-4">
            <div className="space-y-4 markdown-content">
              <h3>{t('vtoHelpSingleTitle')}</h3>
              <p>{t('vtoHelpSingleDesc')}</p>
              
              <h3>{t('vtoHelpBatchTitle')}</h3>
              <p>{t('vtoHelpBatchDesc')}</p>
              <ul>
                <li><ReactMarkdown>{t('vtoHelpBatchOneGarment')}</ReactMarkdown></li>
                <li><ReactMarkdown>{t('vtoHelpBatchRandom')}</ReactMarkdown></li>
                <li><ReactMarkdown>{t('vtoHelpBatchPrecise')}</ReactMarkdown></li>
              </ul>

              <h3>{t('vtoHelpProTitle')}</h3>
              <p>{t('vtoHelpProDesc')}</p>
              <ul>
                <li><ReactMarkdown>{t('vtoHelpProMasking')}</ReactMarkdown></li>
                <li><ReactMarkdown>{t('vtoHelpProReference')}</ReactMarkdown></li>
                <li><ReactMarkdown>{t('vtoHelpProSettings')}</ReactMarkdown></li>
              </ul>
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button onClick={() => setIsHelpModalOpen(false)}>{t('done')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default VirtualTryOn;