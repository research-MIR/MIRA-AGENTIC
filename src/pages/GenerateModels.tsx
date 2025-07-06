import { useState, useEffect } from "react";
import { useLanguage } from "@/context/LanguageContext";
import { SettingsPanel } from "@/components/GenerateModels/SettingsPanel";
import { ResultsDisplay } from "@/components/GenerateModels/ResultsDisplay";
import { useGeneratorStore } from "@/store/generatorStore";
import { showError, showLoading, dismissToast, showSuccess } from "@/utils/toast";
import { Model } from "@/hooks/useChatManager";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, Sparkles, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

interface Pose {
  type: 'text';
  value: string;
}

interface FinalPoseResult {
  pose_prompt: string;
  generated_url: string;
}

const GenerateModels = () => {
  const { t } = useLanguage();
  const { models, fetchModels } = useGeneratorStore();
  const { supabase, session } = useSession();

  const [modelDescription, setModelDescription] = useState("");
  const [setDescription, setSetDescription] = useState("");
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [autoApprove, setAutoApprove] = useState(true);
  
  const [isLoading, setIsLoading] = useState(false);
  const [generatedImages, setGeneratedImages] = useState<{id: string, url: string}[]>([]);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [poses, setPoses] = useState<Pose[]>([{ type: 'text', value: '' }]);
  const [poseGenerationJobId, setPoseGenerationJobId] = useState<string | null>(null);

  const { data: poseJobResult, isLoading: isLoadingPoses } = useQuery({
    queryKey: ['poseGenerationJob', poseGenerationJobId],
    queryFn: async () => {
      if (!poseGenerationJobId) return null;
      const { data, error } = await supabase
        .from('mira-agent-model-generation-jobs')
        .select('status, final_posed_images')
        .eq('id', poseGenerationJobId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!poseGenerationJobId,
    refetchInterval: (data) => (data?.status === 'complete' || data?.status === 'failed' ? false : 5000),
  });

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  useEffect(() => {
    if (models.length > 0 && !selectedModelId) {
      const defaultModel = models.find(m => m.is_default) || models[0];
      if (defaultModel) {
        setSelectedModelId(defaultModel.model_id_string);
      }
    }
  }, [models, selectedModelId]);

  const handleGenerateBase = async () => {
    if (!modelDescription.trim() || !selectedModelId || !session?.user) {
      showError("Please provide a model description and select a base model.");
      return;
    }

    setIsLoading(true);
    setGeneratedImages([]);
    setSelectedImageId(null);
    const toastId = showLoading(t('generating'));

    try {
      const { data, error } = await supabase.functions.invoke('MIRA-AGENT-orchestrator-generate-model', {
        body: {
          model_description: modelDescription,
          set_description: setDescription,
          selected_model_id: selectedModelId,
          user_id: session.user.id,
          auto_approve: autoApprove
        }
      });

      if (error) throw error;
      
      dismissToast(toastId);

      setGeneratedImages(data.images);
      if (autoApprove && data.images.length > 0) {
        setSelectedImageId(data.images[0].id);
      }

    } catch (err: any) {
      dismissToast(toastId);
      showError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectImage = (id: string) => {
    setSelectedImageId(id);
  };

  const handlePoseChange = (index: number, value: string) => {
    const newPoses = [...poses];
    newPoses[index].value = value;
    setPoses(newPoses);
  };

  const addPose = () => {
    setPoses([...poses, { type: 'text', value: '' }]);
  };

  const removePose = (index: number) => {
    setPoses(poses.filter((_, i) => i !== index));
  };

  const handleGeneratePoses = async () => {
    if (!selectedImageId) {
      showError("Please select a base model image first.");
      return;
    }
    const validPoses = poses.filter(p => p.value.trim() !== '');
    if (validPoses.length === 0) {
      showError("Please define at least one pose.");
      return;
    }

    setIsLoading(true);
    const toastId = showLoading("Starting pose generation...");

    try {
      const selectedImageUrl = generatedImages.find(img => img.id === selectedImageId)?.url;
      if (!selectedImageUrl) throw new Error("Selected image URL not found.");

      const { data, error } = await supabase.functions.invoke('MIRA-AGENT-orchestrator-generate-poses', {
        body: {
          base_model_image_url: selectedImageUrl,
          pose_prompts: validPoses,
          user_id: session?.user.id
        }
      });

      if (error) throw error;
      dismissToast(toastId);
      showSuccess("Pose generation job started!");
      setPoseGenerationJobId(data.jobId);
    } catch (err: any) {
      dismissToast(toastId);
      showError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="p-4 md:p-8 h-screen overflow-y-auto">
      <header className="pb-4 mb-8 border-b">
        <h1 className="text-3xl font-bold">{t('generateModelsTitle')}</h1>
        <p className="text-muted-foreground">{t('generateModelsDescription')}</p>
      </header>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1 space-y-4">
          <SettingsPanel
            modelDescription={modelDescription}
            setModelDescription={setModelDescription}
            setDescription={setDescription}
            setSetDescription={setSetDescription}
            models={models as Model[]}
            selectedModelId={selectedModelId}
            setSelectedModelId={setSelectedModelId}
            autoApprove={autoApprove}
            setAutoApprove={setAutoApprove}
            onGenerate={handleGenerateBase}
            isLoading={isLoading}
          />
          {selectedImageId && (
            <Card>
              <CardHeader>
                <CardTitle>{t('step3')}</CardTitle>
                <CardDescription>{t('poseDescription')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {poses.map((pose, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      value={pose.value}
                      onChange={(e) => handlePoseChange(index, e.target.value)}
                      placeholder={t('posePlaceholder')}
                      disabled={isLoadingPoses}
                    />
                    <Button variant="ghost" size="icon" onClick={() => removePose(index)} disabled={poses.length <= 1 || isLoadingPoses}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button variant="outline" className="w-full" onClick={addPose} disabled={isLoadingPoses}>
                  <Plus className="mr-2 h-4 w-4" />
                  {t('addPose')}
                </Button>
                <Button size="lg" className="w-full" onClick={handleGeneratePoses} disabled={isLoadingPoses}>
                  {isLoadingPoses ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                  {t('generateButton')} Poses
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
        <div className="lg:col-span-2 space-y-4">
          <ResultsDisplay
            images={generatedImages}
            isLoading={isLoading}
            autoApprove={autoApprove}
            selectedImageId={selectedImageId}
            onSelectImage={handleSelectImage}
          />
          {poseJobResult && (
            <Card>
              <CardHeader>
                <CardTitle>{t('finalPosesTitle')}</CardTitle>
              </CardHeader>
              <CardContent>
                {poseJobResult.status !== 'complete' ? (
                  <div className="flex items-center justify-center p-8">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    <p className="ml-4">{t('generatingPoses')}</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    {(poseJobResult.final_posed_images as FinalPoseResult[])?.map((result, index) => (
                      <div key={index} className="space-y-2">
                        <img src={result.generated_url} alt={result.pose_prompt} className="w-full aspect-square object-cover rounded-md" />
                        <p className="text-xs text-muted-foreground truncate">{result.pose_prompt}</p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
};

export default GenerateModels;