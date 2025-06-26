import React, { useState, useMemo, useEffect, useCallback } from "react";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { showError, showLoading, dismissToast, showSuccess } from "@/utils/toast";
import { useQueryClient } from "@tanstack/react-query";
import { DebugStepsModal } from "./DebugStepsModal";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/context/LanguageContext";
import { optimizeImage, sanitizeFilename } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BatchInpaintPro } from "./BatchInpaintPro";
import { BitStudioJob } from "@/types/vto";
import { useVTOJobs } from "@/hooks/useVTOJobs";
import { RecentJobsList } from "./RecentJobsList";
import { VTOProSetup } from "./VTOProSetup";
import { VTOProWorkbench } from "./VTOProWorkbench";
import { useImageTransferStore } from "@/store/imageTransferStore";
import { HelpCircle, Info } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const VirtualTryOnPro = ({
  recentJobs, isLoadingRecentJobs, selectedJob, handleSelectJob, resetForm, transferredImageUrl, onTransferConsumed
}: {
  recentJobs: BitStudioJob[] | undefined;
  isLoadingRecentJobs: boolean;
  selectedJob: BitStudioJob | undefined;
  handleSelectJob: (job: BitStudioJob) => void;
  resetForm: () => void;
  transferredImageUrl?: string | null;
  onTransferConsumed: () => void;
}) => {
  const { supabase, session } = useSession();
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  const [sourceImageFile, setSourceImageFile] = useState<File | null>(null);
  const [referenceImageFile, setReferenceImageFile] = useState<File | null>(null);
  const [maskImage, setMaskImage] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [brushSize, setBrushSize] = useState(30);
  const [resetTrigger, setResetTrigger] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isDebugModalOpen, setIsDebugModalOpen] = useState(false);
  const [isAutoPromptEnabled, setIsAutoPromptEnabled] = useState(true);
  const [isGuideOpen, setIsGuideOpen] = useState(false);

  const [numAttempts, setNumAttempts] = useState(1);
  const [maskExpansion, setMaskExpansion] = useState(3);

  const sourceImageUrl = useMemo(() => sourceImageFile ? URL.createObjectURL(sourceImageFile) : null, [sourceImageFile]);

  useEffect(() => {
    if (transferredImageUrl) {
      const fetchImageAsFile = async (imageUrl: string) => {
        try {
          const response = await fetch(imageUrl);
          const blob = await response.blob();
          const filename = imageUrl.split('/').pop() || 'image.png';
          const file = new File([blob], filename, { type: blob.type });
          setSourceImageFile(file);
          onTransferConsumed();
        } catch (e) {
          console.error("Failed to fetch transferred image for VTO Pro:", e);
          showError("Could not load the transferred image.");
        }
      };
      fetchImageAsFile(transferredImageUrl);
    }
  }, [transferredImageUrl, onTransferConsumed]);

  useEffect(() => {
    return () => {
      if (sourceImageUrl) URL.revokeObjectURL(sourceImageUrl);
    };
  }, [sourceImageUrl]);

  useEffect(() => {
    if (selectedJob) {
      setSourceImageFile(null);
      setReferenceImageFile(null);
      setMaskImage(null);
      setPrompt(selectedJob.metadata?.prompt_used || "");
      setResetTrigger(c => c + 1);
    }
  }, [selectedJob]);

  const handleResetMask = () => {
    setResetTrigger(c => c + 1);
  };

  const uploadFile = async (file: File, type: 'person' | 'garment') => {
    if (!session?.user) throw new Error("User session not found.");
    const optimizedFile = await optimizeImage(file);
    const sanitizedName = sanitizeFilename(optimizedFile.name);
    const filePath = `${session.user.id}/vto-source/${type}-${Date.now()}-${sanitizedName}`;
    
    const { error } = await supabase.storage
      .from('mira-agent-user-uploads')
      .upload(filePath, optimizedFile);
    
    if (error) throw new Error(`Failed to upload ${type} image: ${error.message}`);
    
    const { data: { publicUrl } } = supabase.storage
      .from('mira-agent-user-uploads')
      .getPublicUrl(filePath);
      
    return publicUrl;
  };

  const handleGenerate = async () => {
    if (!sourceImageFile || !referenceImageFile) return showError("Please provide both a source and a reference image.");
    
    setIsLoading(true);
    const toastId = showLoading(t('sendingJob'));

    try {
      const [person_url, garment_url] = await Promise.all([
        uploadFile(sourceImageFile, 'person'),
        uploadFile(referenceImageFile, 'garment')
      ]);

      const pairs = [{ person_url, garment_url, appendix: prompt }];

      const { error } = await supabase.functions.invoke('MIRA-AGENT-proxy-batch-inpaint', {
        body: {
          pairs: pairs,
          user_id: session?.user?.id
        }
      });

      if (error) throw error;

      dismissToast(toastId);
      showSuccess("Inpainting job started! You can track its progress in the sidebar.");
      queryClient.invalidateQueries({ queryKey: ['activeJobs'] });
      queryClient.invalidateQueries({ queryKey: ['bitstudioJobs', session.user.id] });
      resetForm();

    } catch (err: any) {
      dismissToast(toastId);
      showError(`Processing failed: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const isGenerateDisabled = isLoading || !!selectedJob || !sourceImageFile || !referenceImageFile;

  return (
    <>
      <Tabs defaultValue="single" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="single">{t('singleInpaint')}</TabsTrigger>
          <TabsTrigger value="batch">{t('batchInpaint')}</TabsTrigger>
        </TabsList>
        <TabsContent value="single" className="pt-6">
          <Alert className="mb-6">
            <Info className="h-4 w-4" />
            <AlertTitle>{t('proMode')}</AlertTitle>
            <AlertDescription>
              {t('vtoProModeDescription')}
            </AlertDescription>
          </Alert>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <VTOProSetup
              selectedJob={selectedJob}
              resetForm={resetForm}
              sourceImageFile={sourceImageFile}
              referenceImageFile={referenceImageFile}
              onSourceFileSelect={setSourceImageFile}
              onReferenceFileSelect={setReferenceImageFile}
              prompt={prompt}
              setPrompt={setPrompt}
              isAutoPromptEnabled={isAutoPromptEnabled}
              setIsAutoPromptEnabled={setIsAutoPromptEnabled}
              numAttempts={numAttempts}
              setNumAttempts={setNumAttempts}
              maskExpansion={maskExpansion}
              setMaskExpansion={setMaskExpansion}
              isLoading={isLoading}
              onGenerate={handleGenerate}
              isGenerateDisabled={isGenerateDisabled}
              onGuideOpen={() => setIsGuideOpen(true)}
            />
            <VTOProWorkbench
              selectedJob={selectedJob}
              sourceImageUrl={sourceImageUrl}
              onFileSelect={setSourceImageFile}
              onMaskChange={setMaskImage}
              brushSize={brushSize}
              onBrushSizeChange={setBrushSize}
              resetTrigger={resetTrigger}
              onResetMask={handleResetMask}
              onDebugOpen={() => setIsDebugModalOpen(true)}
            />
          </div>
        </TabsContent>
        <TabsContent value="batch" className="pt-6">
          <Alert className="mb-6">
            <Info className="h-4 w-4" />
            <AlertTitle>{t('proMode')}</AlertTitle>
            <AlertDescription>
              {t('vtoProModeDescription')}
            </AlertDescription>
          </Alert>
          <BatchInpaintPro />
        </TabsContent>
      </Tabs>
      <div className="mt-4">
        <RecentJobsList 
            jobs={recentJobs}
            isLoading={isLoadingRecentJobs}
            selectedJobId={selectedJob?.id || null}
            onSelectJob={handleSelectJob}
            mode="inpaint"
        />
      </div>
      <DebugStepsModal 
        isOpen={isDebugModalOpen}
        onClose={() => setIsDebugModalOpen(false)}
        assets={selectedJob?.metadata?.debug_assets || null}
      />
      <Dialog open={isGuideOpen} onOpenChange={setIsGuideOpen}>
        <DialogContent className="max-w-2xl">
            <DialogHeader>
                <DialogTitle>{t('inpaintingGuideTitle')}</DialogTitle>
            </DialogHeader>
            <ScrollArea className="max-h-[70vh] pr-4">
                <div className="space-y-4 markdown-content">
                    <ReactMarkdown>{t('inpaintingGuideContent')}</ReactMarkdown>
                </div>
            </ScrollArea>
            <DialogFooter>
                <Button onClick={() => setIsGuideOpen(false)}>{t('done')}</Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default VirtualTryOnPro;