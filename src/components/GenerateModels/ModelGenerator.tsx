import { useState, useEffect } from "react";
import { useLanguage } from "@/context/LanguageContext";
import { SettingsPanel } from "@/components/GenerateModels/SettingsPanel";
import { useGeneratorStore } from "@/store/generatorStore";
import { showError, showLoading, dismissToast, showSuccess } from "@/utils/toast";
import { Model } from "@/hooks/useChatManager";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Sparkles, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { PoseInput } from "./PoseInput";
import { PosePresetModal } from "./PosePresetModal";

interface Pose {
  type: 'text' | 'image';
  value: string;
  file?: File;
  previewUrl?: string;
}

interface ModelGeneratorProps {
  packId: string;
}

export const ModelGenerator = ({ packId }: ModelGeneratorProps) => {
  const { t } = useLanguage();
  const { models, fetchModels } = useGeneratorStore();
  const { supabase, session } = useSession();
  const queryClient = useQueryClient();

  const [upperBodyModels, setUpperBodyModels] = useState("");
  const [lowerBodyModels, setLowerBodyModels] = useState("");
  const [fullBodyModels, setFullBodyModels] = useState("");
  
  const [setDescription, setSetDescription] = useState("white ecommerce background,with no shadows, no vignette");
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [poses, setPoses] = useState<Pose[]>([{ type: 'text', value: '', file: undefined, previewUrl: undefined }]);
  const [isLoading, setIsLoading] = useState(false);
  const [isPoseModalOpen, setIsPoseModalOpen] = useState(false);
  const [aspectRatio, setAspectRatio] = useState("1024x1024");
  const [engine, setEngine] = useState<'comfyui' | 'fal_kontext'>('comfyui');

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  useEffect(() => {
    if (models.length > 0 && !selectedModelId) {
      const defaultModel = models.find(m => m.is_default) || models[0];
      if (defaultModel) setSelectedModelId(defaultModel.model_id_string);
    }
  }, [models, selectedModelId]);

  const handleGenerate = async () => {
    if (!session?.user || !selectedModelId) {
      showError("Please select a base model.");
      return;
    }
    if (!upperBodyModels.trim() && !lowerBodyModels.trim() && !fullBodyModels.trim()) {
      showError("Please describe at least one model in one of the categories.");
      return;
    }

    setIsLoading(true);
    const toastId = showLoading("Preparing assets and queuing jobs...");
    
    try {
      const processedPoses = await Promise.all(poses.map(async (pose) => {
        if (pose.type === 'image' && pose.file) {
          const { data: { publicUrl } } = await supabase.storage.from('mira-agent-user-uploads').upload(`${session.user.id}/pose-references/${Date.now()}-${pose.file.name}`, pose.file);
          return { type: 'image', value: publicUrl };
        }
        return { type: pose.type, value: pose.value };
      }));

      const validPoses = processedPoses.filter(p => p.value.trim() !== '');
      if (validPoses.length === 0) throw new Error("Please define at least one valid pose.");

      const { data, error } = await supabase.functions.invoke('MIRA-AGENT-orchestrator-generate-poses', {
        body: {
          upper_body_models: upperBodyModels,
          lower_body_models: lowerBodyModels,
          full_body_models: fullBodyModels,
          set_description: setDescription,
          selected_model_id: selectedModelId,
          user_id: session.user.id,
          auto_approve: true, // Always true for this workflow
          pose_prompts: validPoses,
          pack_id: packId,
          aspect_ratio: aspectRatio,
          engine: engine,
        }
      });
      if (error) throw error;
      
      dismissToast(toastId);
      showSuccess(`${data.jobIds.length} model generation jobs have been queued!`);
      queryClient.invalidateQueries({ queryKey: ['modelsForPack', packId] });
      
      // Reset form
      setUpperBodyModels("");
      setLowerBodyModels("");
      setFullBodyModels("");

    } catch (err: any) {
      dismissToast(toastId);
      showError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const addPose = () => setPoses([...poses, { type: 'text', value: '', file: undefined, previewUrl: undefined }]);
  const removePose = (index: number) => setPoses(poses.filter((_, i) => i !== index));

  const handleApplyPoses = (newPoses: Pose[]) => {
    setPoses(newPoses.map(p => ({ ...p, file: undefined, previewUrl: undefined })));
    setIsPoseModalOpen(false);
  };

  return (
    <>
      <div className="space-y-4">
        <SettingsPanel
          upperBodyModels={upperBodyModels}
          setUpperBodyModels={setUpperBodyModels}
          lowerBodyModels={lowerBodyModels}
          setLowerBodyModels={setLowerBodyModels}
          fullBodyModels={fullBodyModels}
          setFullBodyModels={setFullBodyModels}
          setDescription={setDescription}
          setSetDescription={setSetDescription}
          models={models as Model[]}
          selectedModelId={selectedModelId}
          setSelectedModelId={setSelectedModelId}
          isJobActive={isLoading}
          aspectRatio={aspectRatio}
          setAspectRatio={setAspectRatio}
          engine={engine}
          setEngine={setEngine}
        />
        
        <Card>
          <CardHeader>
            <div className="flex justify-between items-center">
              <CardTitle>{t('step3')}</CardTitle>
              <Button variant="outline" size="sm" onClick={() => setIsPoseModalOpen(true)}>{t('usePosePresets')}</Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {poses.map((pose, index) => (
              <PoseInput
                key={index}
                pose={pose}
                index={index}
                onPoseChange={(idx, newPose) => setPoses(poses.map((p, i) => i === idx ? {...p, ...newPose} : p))}
                onRemovePose={removePose}
                isJobActive={isLoading}
                isOnlyPose={poses.length <= 1}
              />
            ))}
            <Button variant="outline" className="w-full" onClick={addPose} disabled={isLoading}>
              <Plus className="mr-2 h-4 w-4" />
              {t('addPose')}
            </Button>
          </CardContent>
        </Card>

        <Button size="lg" className="w-full" onClick={handleGenerate} disabled={isLoading || (!upperBodyModels.trim() && !lowerBodyModels.trim() && !fullBodyModels.trim())}>
          {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
          {t('generateModelsButton')}
        </Button>
      </div>
      <PosePresetModal 
        isOpen={isPoseModalOpen}
        onClose={() => setIsPoseModalOpen(false)}
        onApplyPoses={handleApplyPoses}
      />
    </>
  );
};