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
import { Plus, Sparkles, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { PoseInput } from "./PoseInput";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

interface Pose {
  type: 'text' | 'image';
  value: string;
  file?: File;
  previewUrl?: string;
}

interface FinalPoseResult {
  pose_prompt: string;
  final_url: string;
}

interface ModelGeneratorProps {
  packId: string;
  selectedJob: any; // The job selected from the left panel
}

export const ModelGenerator = ({ packId, selectedJob }: ModelGeneratorProps) => {
  const { t } = useLanguage();
  const { models, fetchModels } = useGeneratorStore();
  const { supabase, session } = useSession();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<'single' | 'multi'>('single');
  const [multiModelPrompt, setMultiModelPrompt] = useState("");
  const [modelDescription, setModelDescription] = useState("");
  const [setDescription, setSetDescription] = useState("");
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [autoApprove, setAutoApprove] = useState(true);
  const [poses, setPoses] = useState<Pose[]>([{ type: 'text', value: '', file: undefined, previewUrl: undefined }]);
  const [isLoading, setIsLoading] = useState(false);

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
              auto_approve: autoApprove,
              pose_prompts: validPoses,
              pack_id: packId,
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

  const handleSelectImage = async (imageId: string) => {
    if (!selectedJob) return;
    const toastId = showLoading("Confirming selection...");
    try {
        const selectedImageUrl = selectedJob?.base_generation_results.find((i: any) => i.id === imageId)?.url;
        if (!selectedImageUrl) throw new Error("Could not find selected image URL.");

        const { error } = await supabase.from('mira-agent-model-generation-jobs').update({
            status: 'generating_poses',
            base_model_image_url: selectedImageUrl
        }).eq('id', selectedJob.id);
        if (error) throw error;

        supabase.functions.invoke('MIRA-AGENT-poller-model-generation', { body: { job_id: selectedJob.id } }).catch(console.error);
        
        dismissToast(toastId);
        queryClient.invalidateQueries({ queryKey: ['modelsForPack', packId] });
    } catch (err: any) {
        dismissToast(toastId);
        showError(err.message);
    }
  };

  const addPose = () => setPoses([...poses, { type: 'text', value: '', file: undefined, previewUrl: undefined }]);
  const removePose = (index: number) => setPoses(poses.filter((_, i) => i !== index));

  const isJobActive = selectedJob && !['complete', 'failed'].includes(selectedJob.status);

  return (
    <div className="space-y-4">
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'single' | 'multi')}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="single">{t('singleModel')}</TabsTrigger>
          <TabsTrigger value="multi">{t('multiModel')}</TabsTrigger>
        </TabsList>
        <TabsContent value="single" className="pt-4">
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
            isJobActive={isJobActive}
          />
        </TabsContent>
        <TabsContent value="multi" className="pt-4">
          <Card>
            <CardHeader>
              <CardTitle>{t('multiModel')}</CardTitle>
              <CardDescription>{t('multiModelDescription')}</CardDescription>
            </CardHeader>
            <CardContent>
              <Textarea
                value={multiModelPrompt}
                onChange={(e) => setMultiModelPrompt(e.target.value)}
                placeholder={t('multiModelPlaceholder')}
                rows={5}
                disabled={isJobActive}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      
      <Card>
        <CardHeader><CardTitle>{t('step3')}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {poses.map((pose, index) => (
            <PoseInput
              key={index}
              pose={pose}
              index={index}
              onPoseChange={(idx, newPose) => setPoses(poses.map((p, i) => i === idx ? {...p, ...newPose} : p))}
              onRemovePose={removePose}
              isJobActive={isJobActive}
              isOnlyPose={poses.length <= 1}
            />
          ))}
          <Button variant="outline" className="w-full" onClick={addPose} disabled={isJobActive}>
            <Plus className="mr-2 h-4 w-4" />
            {t('addPose')}
          </Button>
        </CardContent>
      </Card>

      <Button size="lg" className="w-full" onClick={handleGenerate} disabled={isJobActive || (activeTab === 'single' && !modelDescription.trim()) || (activeTab === 'multi' && !multiModelPrompt.trim())}>
        {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
        {t('generateModelsButton')}
      </Button>

      {selectedJob && (
        <Accordion type="multiple" defaultValue={['item-1', 'item-2']} className="w-full space-y-4">
          <AccordionItem value="item-1" className="border rounded-md bg-card">
            <AccordionTrigger className="p-4 hover:no-underline">
              <h3 className="text-lg font-semibold">{t('resultsTitle')}</h3>
            </AccordionTrigger>
            <AccordionContent className="p-4 pt-0">
              <ResultsDisplay
                images={selectedJob.base_generation_results || []}
                isLoading={!selectedJob || selectedJob?.status === 'pending'}
                autoApprove={selectedJob.auto_approve}
                selectedImageId={selectedJob.base_model_image_url ? selectedJob.base_generation_results.find((i:any) => i.url === selectedJob.base_model_image_url)?.id : null}
                onSelectImage={handleSelectImage}
              />
            </AccordionContent>
          </AccordionItem>
          {selectedJob.status !== 'pending' && selectedJob.status !== 'base_generation_complete' && selectedJob.status !== 'awaiting_approval' && (
            <AccordionItem value="item-2" className="border rounded-md bg-card">
              <AccordionTrigger className="p-4 hover:no-underline">
                <h3 className="text-lg font-semibold">{t('finalPosesTitle')}</h3>
              </AccordionTrigger>
              <AccordionContent className="p-4 pt-0">
                {selectedJob.status === 'generating_poses' || (selectedJob.status === 'polling_poses' && !selectedJob.final_posed_images) ? (
                  <div className="flex items-center justify-center p-8"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /><p className="ml-4">{t('generatingPoses')}</p></div>
                ) : selectedJob.status === 'complete' && selectedJob.final_posed_images ? (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    {(selectedJob.final_posed_images as FinalPoseResult[])?.map((result, index) => (
                      <div key={index} className="space-y-2">
                        <img src={result.final_url} alt={result.pose_prompt} className="w-full aspect-square object-cover rounded-md" />
                        <p className="text-xs text-muted-foreground truncate">{result.pose_prompt}</p>
                      </div>
                    ))}
                  </div>
                ) : null}
              </AccordionContent>
            </AccordionItem>
          )}
        </Accordion>
      )}
    </div>
  );
};