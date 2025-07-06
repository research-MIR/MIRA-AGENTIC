import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ModelGenerator } from "@/components/GenerateModels/ModelGenerator";
import { RecentJobThumbnail } from "@/components/GenerateModels/RecentJobThumbnail";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { ResultsDisplay } from "@/components/GenerateModels/ResultsDisplay";
import { showError, showLoading, dismissToast, showSuccess } from "@/utils/toast";
import { useLanguage } from "@/context/LanguageContext";
import { Loader2 } from "lucide-react";

interface FinalPoseResult {
  pose_prompt: string;
  final_url: string;
}

const ModelPackDetail = () => {
  const { packId } = useParams();
  const { supabase } = useSession();
  const queryClient = useQueryClient();
  const { t } = useLanguage();
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  const { data: pack, isLoading: isLoadingPack, error: packError } = useQuery({
    queryKey: ['modelPack', packId],
    queryFn: async () => {
      if (!packId) return null;
      const { data, error } = await supabase.from('mira-agent-model-packs').select('*').eq('id', packId).single();
      if (error) throw error;
      return data;
    },
    enabled: !!packId,
  });

  const { data: jobs, isLoading: isLoadingJobs, error: jobsError } = useQuery({
    queryKey: ['modelsForPack', packId],
    queryFn: async () => {
      if (!packId) return [];
      const { data, error } = await supabase.rpc('get_models_for_pack', { p_pack_id: packId });
      if (error) throw error;
      return data;
    },
    enabled: !!packId,
    refetchInterval: 5000, // Poll for updates every 5 seconds
  });

  const selectedJob = jobs?.find(job => job.id === selectedJobId);

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

  if (isLoadingPack) {
    return <div className="p-8"><Skeleton className="h-12 w-1/3" /><Skeleton className="mt-4 h-64 w-full" /></div>;
  }

  if (packError) {
    return <div className="p-8"><Alert variant="destructive"><AlertTitle>Error</AlertTitle><AlertDescription>{packError.message}</AlertDescription></Alert></div>;
  }

  if (!pack) {
    return <div className="p-8"><Alert><AlertTitle>Not Found</AlertTitle><AlertDescription>This model pack could not be found.</AlertDescription></Alert></div>;
  }

  return (
    <div className="p-4 md:p-8 h-screen flex flex-col">
      <header className="pb-4 mb-4 border-b shrink-0">
        <h1 className="text-3xl font-bold">{pack.name}</h1>
        <p className="text-muted-foreground">{pack.description || "No description provided."}</p>
      </header>
      <div className="flex-1 flex flex-col gap-4 overflow-hidden">
        <Card>
          <CardHeader><CardTitle>Pack Jobs</CardTitle></CardHeader>
          <CardContent>
            {isLoadingJobs ? <Skeleton className="h-28 w-full" /> : jobsError ? (
              <Alert variant="destructive"><AlertTitle>Error</AlertTitle><AlertDescription>{jobsError.message}</AlertDescription></Alert>
            ) : jobs && jobs.length > 0 ? (
              <ScrollArea className="h-32">
                <div className="flex gap-4 pb-4">
                  {jobs.map(job => (
                    <RecentJobThumbnail
                      key={job.id}
                      job={job}
                      onClick={() => setSelectedJobId(job.id)}
                      isSelected={selectedJobId === job.id}
                    />
                  ))}
                </div>
              </ScrollArea>
            ) : (
              <p className="text-muted-foreground text-sm">No models have been generated for this pack yet.</p>
            )}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 flex-1 overflow-hidden">
          <div className="lg:col-span-2 overflow-y-auto no-scrollbar pr-4">
            {selectedJob ? (
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
            ) : (
              <Card className="h-full flex items-center justify-center">
                <p className="text-muted-foreground">Select a job from the bar above to see its results.</p>
              </Card>
            )}
          </div>
          <div className="lg:col-span-1 overflow-y-auto no-scrollbar">
            <ModelGenerator packId={packId!} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default ModelPackDetail;