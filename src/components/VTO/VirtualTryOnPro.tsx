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
import { VTOProSetup } from "./VTOProSetup";
import { VTOProWorkbench } from "./VTOProWorkbench";
import { BitStudioJob } from "@/types/vto";
import { HelpCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Info } from "lucide-react";

const VirtualTryOnPro = ({
  selectedJob,
  resetForm,
  transferredImageUrl,
  onTransferConsumed
}: {
  selectedJob: BitStudioJob | undefined;
  resetForm: () => void;
  transferredImageUrl?: string | null;
  onTransferConsumed: () => void;
}) => {
  const { supabase, session } = useSession();
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  const [sourceImageFile, setSourceImageFile] = useState<File | null>(null);
  const [referenceImageFile, setReferenceImageFile] = useState<File | null>(null);
  const [prompt, setPrompt] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isDebugModalOpen, setIsDebugModalOpen] = useState(false);
  const [isAutoPromptEnabled, setIsAutoPromptEnabled] = useState(true);
  const [isGuideOpen, setIsGuideOpen] = useState(false);

  const [numAttempts, setNumAttempts] = useState(1);
  const [maskExpansion, setMaskExpansion] = useState(3);

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
    if (selectedJob) {
      setSourceImageFile(null);
      setReferenceImageFile(null);
      setPrompt(selectedJob.metadata?.prompt_used || "");
    }
  }, [selectedJob]);

  const handleGenerate = async () => {
    if (!sourceImageFile || !referenceImageFile) return showError("Please provide both a source and a reference image.");
    
    setIsLoading(true);
    const toastId = showLoading(t('sendingJob'));

    try {
      const payload: any = {
        user_id: session?.user.id,
        mode: 'inpaint',
        prompt: prompt,
        num_attempts: numAttempts,
        mask_expansion_percent: maskExpansion,
        is_garment_mode: true,
      };

      const [sourceBase64, referenceBase64] = await Promise.all([
        fileToBase64(sourceImageFile),
        fileToBase64(referenceImageFile)
      ]);

      payload.full_source_image_base64 = sourceBase64;
      payload.reference_image_base64 = referenceBase64;

      const { error } = await supabase.functions.invoke('MIRA-AGENT-proxy-bitstudio', { body: payload });

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

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve((reader.result as string).split(',')[1]);
      reader.onerror = (error) => reject(error);
    });
  };

  const isGenerateDisabled = isLoading || !!selectedJob || !sourceImageFile || !referenceImageFile;

  return (
    <>
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
          sourceImageUrl={sourceImageFile ? URL.createObjectURL(sourceImageFile) : null}
          onFileSelect={setSourceImageFile}
          onDebugOpen={() => setIsDebugModalOpen(true)}
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
                <DialogTitle>{t('vtoProGuideTitle')}</DialogTitle>
            </DialogHeader>
            <ScrollArea className="max-h-[70vh] pr-4">
                <div className="space-y-4 markdown-content">
                    <ReactMarkdown>{t('vtoProGuideContent')}</ReactMarkdown>
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