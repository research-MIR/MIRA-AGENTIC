import { useState, useEffect, useMemo, useRef } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ModelGenerator } from "@/components/GenerateModels/ModelGenerator";
import { useLanguage } from "@/context/LanguageContext";
import { Loader2, Wand2, Users } from "lucide-react";
import { RealtimeChannel } from "@supabase/supabase-js";
import { PackStatusIndicator } from "@/components/GenerateModels/PackStatusIndicator";
import { JobProgressBar } from "@/components/GenerateModels/JobProgressBar";
import { Button } from "@/components/ui/button";
import { UpscalePosesModal } from "@/components/GenerateModels/UpscalePosesModal";
import { RecentJobThumbnail } from "@/components/GenerateModels/RecentJobThumbnail";
import { ScrollArea } from "@/components/ui/scroll-area";
import { JobPoseDisplay } from "@/components/GenerateModels/JobPoseDisplay";
import { UpscaledPosesGallery } from "@/components/GenerateModels/UpscaledPosesGallery";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ResultsDisplay } from "@/components/GenerateModels/ResultsDisplay";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { showError, showSuccess } from "@/utils/toast";

interface Pose {
  final_url: string;
  is_upscaled?: boolean;
  status: string;
  pose_prompt: string;
}

interface Job {
  id: string;
  status: 'pending' | 'base_generation_complete' | 'awaiting_approval' | 'generating_poses' | 'polling_poses' | 'upscaling_poses' | 'complete' | 'failed';
  base_model_image_url?: string | null;
  final_posed_images?: Pose[];
  pose_prompts?: any[];
  base_generation_results?: any[];
  auto_approve: boolean;
}

const ModelPackDetail = () => {
  const { packId } = useParams();
  const { supabase, session } = useSession();
  const queryClient = useQueryClient();
  const { t } = useLanguage();
  const [isUpscaleModalOpen, setIsUpscaleModalOpen] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [selectedBaseModelId, setSelectedBaseModelId] = useState<string | null>(null);
  const [selectedGender, setSelectedGender] = useState<'male' | 'female' | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

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

  const { data: jobs, isLoading: isLoadingJobs, error: jobsError } = useQuery<Job[]>({
    queryKey: ['modelsForPack', packId],
    queryFn: async () => {
      if (!packId) return [];
      const { data, error } = await supabase
        .from('mira-agent-model-generation-jobs')
        .select('*')
        .eq('pack_id', packId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!packId,
  });

  const selectedJob = useMemo(() => jobs?.find(j => j.id === selectedJobId), [jobs, selectedJobId]);

  useEffect(() => {
    if (selectedJob?.status !== 'awaiting_approval') {
      setSelectedBaseModelId(null);
      setSelectedGender(null);
    }
  }, [selectedJob]);

  const handleApproveBaseModel = async () => {
    if (!selectedJobId || !selectedBaseModelId || !selectedGender) {
      showError("Please select a base model image AND a gender.");
      return;
    }
    const selectedImage = selectedJob?.base_generation_results?.find(img => img.id === selectedBaseModelId);
    if (!selectedImage) {
      showError("Selected image not found.");
      return;
    }

    const { error } = await supabase.from('mira-agent-model-generation-jobs').update({
      status: 'generating_poses',
      base_model_image_url: selectedImage.url,
      gender: selectedGender
    }).eq('id', selectedJobId);

    if (error) {
      showError(`Failed to approve model: ${error.message}`);
    } else {
      showSuccess("Model approved. Generating poses...");
      queryClient.invalidateQueries({ queryKey: ['modelsForPack', packId] });
    }
  };

  const packStatus = useMemo(() => {
    if (!jobs || jobs.length === 0) {
        return { status: 'idle' as const, completedPoses: 0, totalPoses: 0, upscaledPoses: 0 };
    }

    let completedPoses = 0;
    let totalPoses = 0;
    let upscaledPoses = 0;
    let hasFailed = false;
    let hasInProgress = false;
    let allJobsAreComplete = true;

    for (const job of jobs) {
        const jobTotalPoses = job.pose_prompts?.length || 0;
        totalPoses += jobTotalPoses;
        
        const jobCompletedPoses = job.final_posed_images?.filter((p: any) => p.status === 'complete').length || 0;
        completedPoses += jobCompletedPoses;

        const jobUpscaledPoses = job.final_posed_images?.filter((p: any) => p.is_upscaled).length || 0;
        upscaledPoses += jobUpscaledPoses;

        if (job.status === 'failed') {
            hasFailed = true;
        }
        if (job.status !== 'complete' && job.status !== 'failed') {
            hasInProgress = true;
        }
        if (job.status !== 'complete') {
            allJobsAreComplete = false;
        }
    }

    let aggregateStatus: 'idle' | 'in_progress' | 'failed' | 'complete' = 'idle';
    if (hasFailed) {
        aggregateStatus = 'failed';
    } else if (hasInProgress) {
        aggregateStatus = 'in_progress';
    } else if (allJobsAreComplete && jobs.length > 0) {
        aggregateStatus = 'complete';
    }

    return { status: aggregateStatus, completedPoses, totalPoses, upscaledPoses };
  }, [jobs]);

  const posesReadyForUpscaleCount = useMemo(() => {
    if (!jobs) return 0;
    return jobs.flatMap(job => job.final_posed_images || []).filter(pose => pose.status === 'complete' && !pose.is_upscaled).length;
  }, [jobs]);

  useEffect(() => {
    if (!packId || !session?.user?.id) return;
    const channel = supabase.channel(`model-pack-jobs-${packId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mira-agent-model-generation-jobs', filter: `pack_id=eq.${packId}` },
        (payload) => {
          console.log('Realtime update received for model pack jobs:', payload);
          queryClient.invalidateQueries({ queryKey: ['modelsForPack', packId] });
        }
      ).subscribe();
    channelRef.current = channel;
    return () => { if (channelRef.current) supabase.removeChannel(channelRef.current); };
  }, [packId, session?.user?.id, supabase, queryClient]);

  if (isLoadingPack) return <div className="p-8"><Skeleton className="h-12 w-1/3" /><Skeleton className="mt-4 h-64 w-full" /></div>;
  if (packError) return <div className="p-8"><Alert variant="destructive"><AlertTitle>Error</AlertTitle><AlertDescription>{packError.message}</AlertDescription></Alert></div>;
  if (!pack) return <div className="p-8"><Alert><AlertTitle>Not Found</AlertTitle><AlertDescription>This model pack could not be found.</AlertDescription></Alert></div>;

  return (
    <>
      <div className="p-4 md:p-8 h-screen flex flex-col">
        <header className="pb-4 mb-4 border-b shrink-0">
          <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                  <h1 className="text-3xl font-bold">{pack.name}</h1>
                  <PackStatusIndicator status={packStatus.status} totalPoses={packStatus.totalPoses} upscaledPoses={packStatus.upscaledPoses} />
              </div>
              <Button onClick={() => setIsUpscaleModalOpen(true)} disabled={posesReadyForUpscaleCount === 0}>
                <Wand2 className="mr-2 h-4 w-4" />
                Upscale & Prepare for VTO ({posesReadyForUpscaleCount})
              </Button>
          </div>
          <div className="mt-2">
              <JobProgressBar completedPoses={packStatus.completedPoses} totalPoses={packStatus.totalPoses} />
          </div>
          <p className="text-muted-foreground mt-1">{pack.description || "No description provided."}</p>
        </header>
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-8 overflow-hidden">
          <div className="lg:col-span-2 overflow-y-auto no-scrollbar pr-4">
            <Tabs defaultValue="jobs" className="w-full">
              <TabsList>
                <TabsTrigger value="jobs">{t('generationJobs')}</TabsTrigger>
                <TabsTrigger value="upscaled">{t('upscaledPoses')}</TabsTrigger>
              </TabsList>
              <TabsContent value="jobs" className="mt-4">
                <div className="space-y-4">
                  <Card>
                    <CardHeader><CardTitle>Generation Jobs</CardTitle></CardHeader>
                    <CardContent>
                      {isLoadingJobs ? <Skeleton className="h-24 w-full" /> : jobsError ? <Alert variant="destructive"><AlertTitle>Error</AlertTitle><AlertDescription>{jobsError.message}</AlertDescription></Alert> : (
                        <ScrollArea className="h-32">
                          <div className="flex gap-4 pb-2">
                            {jobs?.map(job => (
                              <RecentJobThumbnail key={job.id} job={job} onClick={() => setSelectedJobId(job.id)} isSelected={selectedJobId === job.id} />
                            ))}
                          </div>
                        </ScrollArea>
                      )}
                    </CardContent>
                  </Card>
                  {selectedJob && selectedJob.status === 'awaiting_approval' && (
                    <Card>
                      <CardHeader>
                        <CardTitle>{t('resultsTitle')}</CardTitle>
                        <CardDescription>{t('resultsDescriptionManual')}</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <ResultsDisplay
                          images={selectedJob.base_generation_results?.map(img => ({ id: img.id, url: img.url })) || []}
                          isLoading={false}
                          autoApprove={false}
                          selectedImageId={selectedBaseModelId}
                          onSelectImage={setSelectedBaseModelId}
                        />
                        <div>
                          <Label>Select Model Gender</Label>
                          <RadioGroup onValueChange={(value) => setSelectedGender(value as 'male' | 'female')} value={selectedGender || ""}>
                            <div className="flex items-center space-x-2">
                              <RadioGroupItem value="male" id="gender-male" />
                              <Label htmlFor="gender-male">Male</Label>
                            </div>
                            <div className="flex items-center space-x-2">
                              <RadioGroupItem value="female" id="gender-female" />
                              <Label htmlFor="gender-female">Female</Label>
                            </div>
                          </RadioGroup>
                        </div>
                        <Button 
                          className="w-full" 
                          onClick={handleApproveBaseModel}
                          disabled={!selectedBaseModelId || !selectedGender}
                        >
                          Approve & Generate Poses
                        </Button>
                      </CardContent>
                    </Card>
                  )}
                  <JobPoseDisplay job={selectedJob} />
                </div>
              </TabsContent>
              <TabsContent value="upscaled" className="mt-4">
                <UpscaledPosesGallery jobs={jobs || []} />
              </TabsContent>
            </Tabs>
          </div>
          <div className="lg:col-span-1 overflow-y-auto no-scrollbar">
            <ModelGenerator packId={packId!} />
          </div>
        </div>
      </div>
      <UpscalePosesModal isOpen={isUpscaleModalOpen} onClose={() => setIsUpscaleModalOpen(false)} jobs={jobs || []} packId={packId!} />
    </>
  );
};

export default ModelPackDetail;