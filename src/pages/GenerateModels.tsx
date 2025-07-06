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
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { RecentJobThumbnail } from "@/components/GenerateModels/RecentJobThumbnail";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";

interface Pose {
  type: 'text';
  value: string;
}

interface FinalPoseResult {
  pose_prompt: string;
  final_url: string;
}

const GenerateModels = () => {
  const { t } = useLanguage();
  const { models, fetchModels } = useGeneratorStore();
  const { supabase, session } = useSession();
  const queryClient = useQueryClient();

  const [modelDescription, setModelDescription] = useState("");
  const [setDescription, setSetDescription] = useState("");
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [autoApprove, setAutoApprove] = useState(true);
  const [poses, setPoses] = useState<Pose[]>([{ type: 'text', value: '' }]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  const { data: activeJob, isLoading: isLoadingJob } = useQuery({
    queryKey: ['modelGenerationJob', selectedJobId],
    queryFn: async () => {
      if (!selectedJobId) return null;
      const { data, error } = await supabase
        .from('mira-agent-model-generation-jobs')
        .select('*')
        .eq('id', selectedJobId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!selectedJobId,
    refetchInterval: (data: any) => (data?.status === 'complete' || data?.status === 'failed' ? false : 5000),
  });

  const { data: recentJobs, isLoading: isLoadingRecent } = useQuery({
    queryKey: ['modelGenerationJobs', session?.user?.id],
    queryFn: async () => {
      if (!session?.user) return [];
      const { data, error } = await supabase
        .from('mira-agent-model-generation-jobs')
        .select('id, status, base_model_image_url, model_description, set_description, context, auto_approve, pose_prompts')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      return data;
    },
    enabled: !!session?.user,
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

  const handleSelectJob = (job: any) => {
    setSelectedJobId(job.id);
    setModelDescription(job.model_description || "");
    setSetDescription(job.set_description || "");
    setSelectedModelId(job.context?.selectedModelId || null);
    setAutoApprove(job.auto_approve ?? true);
    setPoses(job.pose_prompts || [{ type: 'text', value: '' }]);
  };

  const handleGenerate = async () => {
    if (!modelDescription.trim() || !selectedModelId || !session?.user) {
      showError("Please provide a model description and select a base model.");
      return;
    }
    const validPoses = poses.filter(p => p.value.trim() !== '');
    if (validPoses.length === 0) {
      showError("Please define at least one pose.");
      return;
    }

    const toastId = showLoading("Starting generation pipeline...");
    try {
      const { data, error } = await supabase.functions.invoke('MIRA-AGENT-orchestrator-generate-poses', {
        body: {
          model_description: modelDescription,
          set_description: setDescription,
          selected_model_id: selectedModelId,
          user_id: session.user.id,
          auto_approve: autoApprove,
          pose_prompts: validPoses,
        }
      });
      if (error) throw error;
      dismissToast(toastId);
      showSuccess("Generation pipeline started!");
      setSelectedJobId(data.jobId);
      queryClient.invalidateQueries({ queryKey: ['modelGenerationJobs', session.user.id] });
    } catch (err: any) {
      dismissToast(toastId);
      showError(err.message);
    }
  };

  const handleSelectImage = async (imageId: string) => {
    if (!selectedJobId) return;
    const toastId = showLoading("Confirming selection...");
    try {
        const selectedImageUrl = activeJob?.base_generation_results.find((img: any) => img.id === imageId)?.url;
        if (!selectedImageUrl) throw new Error("Could not find selected image URL.");

        const { error } = await supabase.from('mira-agent-model-generation-jobs').update({
            status: 'generating_poses',
            base_model_image_url: selectedImageUrl
        }).eq('id', selectedJobId);
        if (error) throw error;

        supabase.functions.invoke('MIRA-AGENT-poller-model-generation', { body: { job_id: selectedJobId } }).catch(console.error);
        
        dismissToast(toastId);
        queryClient.invalidateQueries({ queryKey: ['modelGenerationJob', selectedJobId] });
    } catch (err: any) {
        dismissToast(toastId);
        showError(err.message);
    }
  };

  const handlePoseChange = (index: number, value: string) => {
    const newPoses = [...poses];
    newPoses[index].value = value;
    setPoses(newPoses);
  };

  const addPose = () => setPoses([...poses, { type: 'text', value: '' }]);
  const removePose = (index: number) => setPoses(poses.filter((_, i) => i !== index));

  const isJobActive = activeJob && !['complete', 'failed'].includes(activeJob.status);

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
            onGenerate={handleGenerate}
            isLoading={isJobActive}
          />
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
                    disabled={isJobActive}
                  />
                  <Button variant="ghost" size="icon" onClick={() => removePose(index)} disabled={poses.length <= 1 || isJobActive}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button variant="outline" className="w-full" onClick={addPose} disabled={isJobActive}>
                <Plus className="mr-2 h-4 w-4" />
                {t('addPose')}
              </Button>
            </CardContent>
          </Card>
        </div>
        <div className="lg:col-span-2 space-y-4">
          {activeJob && (
            <Accordion type="multiple" defaultValue={['item-1', 'item-2']} className="w-full space-y-4">
              <AccordionItem value="item-1" className="border rounded-md bg-card">
                <AccordionTrigger className="p-4 hover:no-underline">
                  <div className="flex-1 text-left">
                    <h3 className="text-lg font-semibold">{t('resultsTitle')}</h3>
                    <p className="text-sm text-muted-foreground">
                      {activeJob.auto_approve ? t('resultsDescriptionAuto') : t('resultsDescriptionManual')}
                    </p>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="p-4 pt-0">
                  <ResultsDisplay
                    images={activeJob.base_generation_results || []}
                    isLoading={isLoadingJob && (!activeJob || activeJob?.status === 'pending')}
                    autoApprove={activeJob.auto_approve}
                    selectedImageId={activeJob.base_model_image_url ? activeJob.base_generation_results.find((i:any) => i.url === activeJob.base_model_image_url)?.id : null}
                    onSelectImage={handleSelectImage}
                  />
                </AccordionContent>
              </AccordionItem>

              {activeJob.status !== 'pending' && activeJob.status !== 'base_generation_complete' && activeJob.status !== 'awaiting_approval' && (
                <AccordionItem value="item-2" className="border rounded-md bg-card">
                  <AccordionTrigger className="p-4 hover:no-underline">
                    <h3 className="text-lg font-semibold">{t('finalPosesTitle')}</h3>
                  </AccordionTrigger>
                  <AccordionContent className="p-4 pt-0">
                    {activeJob.status === 'generating_poses' || (activeJob.status === 'polling_poses' && !activeJob.final_posed_images) ? (
                      <div className="flex items-center justify-center p-8">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                        <p className="ml-4">{t('generatingPoses')}</p>
                      </div>
                    ) : activeJob.status === 'complete' && activeJob.final_posed_images ? (
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                        {(activeJob.final_posed_images as FinalPoseResult[])?.map((result, index) => (
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
           <Card>
            <CardHeader><CardTitle>Recent Jobs</CardTitle></CardHeader>
            <CardContent>
              {isLoadingRecent ? <Skeleton className="h-24 w-full" /> : recentJobs && recentJobs.length > 0 ? (
                <ScrollArea className="h-32">
                  <div className="flex gap-4 pb-2">
                    {recentJobs.map(job => (
                      <RecentJobThumbnail
                        key={job.id}
                        job={job}
                        onClick={() => handleSelectJob(job)}
                        isSelected={selectedJobId === job.id}
                      />
                    ))}
                  </div>
                </ScrollArea>
              ) : (
                <p className="text-sm text-muted-foreground">No recent jobs found.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default GenerateModels;