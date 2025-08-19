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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { PosePresetModal } from "./PosePresetModal";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

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

  const [activeTab, setActiveTab] = useState<'single' | 'multi'>('single');
  const [multiModelPrompt, setMultiModelPrompt] = useState("");
  const [modelDescription, setModelDescription] = useState("");
  const [setDescription, setSetDescription] = useState("white ecommerce background,with no shadows, no vignette");
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [autoApprove, setAutoApprove] = useState(true);
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
    setIsLoading(true);
    if (activeTab === 'single') {
      await handleSingleModelGenerate();
    } else {
      await handleMultiModelGenerate();
    }
    setIsLoading(false);
  };

  const handleSingleModelGenerate = async () => {
    if (!modelDescription.trim() || !selectedModelId || !session?.user) {
      showError("Please provide a model description and select a base model.");
      return;
    }
    
    const toastId = showLoading("Preparing assets...");
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

      dismissToast(toastId);
      showLoading("Starting generation pipeline...");

      const { data, error } = await supabase.functions.invoke('MIRA-AGENT-orchestrator-generate-poses', {
        body: {
          model_description: modelDescription,
          set_description: setDescription,
          selected_model_id: selectedModelId,
          user_id: session.user.id,
          auto_approve: autoApprove,
          pose_prompts: validPoses,
          pack_id: packId,
          aspect_ratio: aspectRatio,
          engine: engine,
        }
      });
      if (error) throw error;
      dismissToast(toastId);
      showSuccess("Generation pipeline started!");
      queryClient.invalidateQueries({ queryKey: ['modelsForPack', packId] });
    } catch (err: any) {
      dismissToast(toastId);
      showError(err.message);
    }
  };

  const handleMultiModelGenerate = async () => {
    if (!multiModelPrompt.trim() || !selectedModelId || !session?.user) {
      showError("Please provide a multi-model description and select a base model.");
      return;
    }
    
    const toastId = showLoading("Parsing multi-model prompt...");
    try {
      const { data: parseData, error: parseError } = await supabase.functions.invoke('MIRA-AGENT-tool-parse-multi-model-prompt', {
        body: { high_level_prompt: multiModelPrompt }
      });
      if (parseError) throw parseError;
      const modelDescriptions = parseData.model_descriptions;
      if (!modelDescriptions || modelDescriptions.length === 0) {
        throw new Error("The AI could not parse any models from your description.");
      }

      dismissToast(toastId);
      showSuccess(`Parsed ${modelDescriptions.length} models. Queuing generation jobs...`);

      const jobPromises = modelDescriptions.map(async (desc: string) => {
        try {
          const processedPoses = await Promise.all(poses.map(async (pose) => {
            if (pose.type === 'image' && pose.file) {
              const { data: { publicUrl } } = await supabase.storage.from('mira-agent-user-uploads').upload(`${session.user.id}/pose-references/${Date.now()}-${pose.file.name}`, pose.file);
              return { type: 'image', value: publicUrl };
            }
            return { type: pose.type, value: pose.value };
          }));
          const validPoses = processedPoses.filter(p => p.value.trim() !== '');

          const { error } = await supabase.functions.invoke('MIRA-AGENT-orchestrator-generate-poses', {
            body: {
              model_description: desc,
              set_description: setDescription,
              selected_model_id: selectedModelId,
              user_id: session.user.id,
              auto_approve: true, // Always true for multi-model
              pose_prompts: validPoses,
              pack_id: packId,
              aspect_ratio: aspectRatio,
              engine: engine,
            }
          });
          if (error) throw error;
        } catch (err) {
          console.error(`Failed to queue job for description "${desc}":`, err);
        }
      });

      await Promise.all(jobPromises);
      showSuccess("All generation jobs have been queued.");
      queryClient.invalidateQueries({ queryKey: ['modelsForPack', packId] });

    } catch (err: any) {
      dismissToast(toastId);
      showError(err.message);
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
          modelDescription={modelDescription}
          setModelDescription={setModelDescription}
          setDescription={setDescription}
          setSetDescription={setSetDescription}
          models={models as Model[]}
          selectedModelId={selectedModelId}
          setSelectedModelId={setSelectedModelId}
          autoApprove={autoApprove}
          setAutoApprove={setAutoApprove}
          isJobActive={isLoading}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          multiModelPrompt={multiModelPrompt}
          setMultiModelPrompt={setMultiModelPrompt}
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

        <Button size="lg" className="w-full" onClick={handleGenerate} disabled={isLoading || (activeTab === 'single' && !modelDescription.trim()) || (activeTab === 'multi' && !multiModelPrompt.trim())}>
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