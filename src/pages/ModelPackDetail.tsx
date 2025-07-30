import { useState, useEffect, useMemo, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ModelGenerator } from "@/components/GenerateModels/ModelGenerator";
import { useLanguage } from "@/context/LanguageContext";
import { Loader2, Wand2, Users, ArrowLeft, Trash2, AlertTriangle } from "lucide-react";
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
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { PackDashboard } from "@/components/GenerateModels/PackDashboard";

interface PoseAnalysis {
  shoot_focus: 'upper_body' | 'lower_body' | 'full_body';
  garment: {
    description: string;
    coverage: 'upper_body' | 'lower_body' | 'full_body';
    is_identical_to_base_garment: boolean;
  };
}

interface Pose {
  final_url: string;
  is_upscaled?: boolean;
  status: string;
  pose_prompt: string;
  jobId: string;
  analysis?: PoseAnalysis;
}

interface Job {
  id: string;
  status: 'pending' | 'base_generation_complete' | 'awaiting_approval' | 'generating_poses' | 'polling_poses' | 'upscaling_poses' | 'complete' | 'failed';
  base_model_image_url?: string | null;
  final_posed_images?: Pose[];
  pose_prompts?: any[];
  base_generation_results?: any[];
  auto_approve: boolean;
  model_description?: string;
  gender?: 'male' | 'female' | null;
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
  const [jobToRemove, setJobToRemove] = useState<string | null>(null);
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

  const handleRemoveModelFromPack = async () => {
    if (!jobToRemove) return;
    const { error } = await supabase
      .from('mira-agent-model-generation-jobs')
      .update({ pack_id: null })
      .eq('id', jobToRemove);
    
    if (error) {
      showError(`Failed to remove model: ${error.message}`);
    } else {
      showSuccess("Model removed from pack.");
      queryClient.invalidateQueries({ queryKey: ['modelsForPack', packId] });
    }
    setJobToRemove(null);
  };

  const packStatus = useMemo(() => {
    if (!jobs || jobs.length === 0) {
        return { 
            status: 'idle' as const, 
            completedPoses: 0, 
            totalPoses: 0, 
            upscaledPoses: 0,
            isReadyForUpscale: false,
            hasFailedJobs: false,
            hasInProgressJobs: false,
            processingBaseModels: 0,
            processingPoses: 0,
            processingUpscales: 0,
            failedJobsCount: 0,
        };
    }

    let completedPoses = 0;
    let totalPoses = 0;
    let upscaledPoses = 0;
    let hasFailedJobs = false;
    let hasInProgressJobs = false;
    let processingBaseModels = 0;
    let processingPoses = 0;
    let processingUpscales = 0;
    let failedJobsCount = 0;

    for (const job of jobs) {
        const jobTotalPoses = job.pose_prompts?.length || 0;
        totalPoses += jobTotalPoses;
        
        const jobCompletedPoses = job.final_posed_images?.filter((p: any) => p.status === 'complete' || p.status === 'failed').length || 0;
        completedPoses += jobCompletedPoses;

        const jobUpscaledPoses = job.final_posed_images?.filter((p: any) => p.is_upscaled).length || 0;
        upscaledPoses += jobUpscaledPoses;

        if (job.status === 'failed') {
            hasFailedJobs = true;
            failedJobsCount++;
        }
        if (job.status !== 'complete' && job.status !== 'failed') {
            hasInProgressJobs = true;
        }

        if (['pending', 'base_generation_complete', 'awaiting_approval'].includes(job.status)) {
            processingBaseModels++;
        }
        if (['generating_poses', 'polling_poses'].includes(job.status)) {
            processingPoses++;
        }
        if (job.status === 'upscaling_poses') {
            processingUpscales++;
        }
    }

    let aggregateStatus: 'idle' | 'in_progress' | 'failed' | 'complete' = 'idle';
    if (hasFailedJobs) {
        aggregateStatus = 'failed';
    } else if (hasInProgressJobs) {
        aggregateStatus = 'in_progress';
    } else if (jobs.every(j => j.status === 'complete' || j.status === 'failed') && jobs.length > 0) {
        aggregateStatus = 'complete';
    }

    const isReadyForUpscale = !hasInProgressJobs && totalPoses > 0;

    return { 
        status: aggregateStatus, 
        completedPoses, 
        totalPoses, 
        upscaledPoses,
        isReadyForUpscale,
        hasFailedJobs,
        hasInProgressJobs,
        processingBaseModels,
        processingPoses,
        processingUpscales,
        failedJobsCount,
    };
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

  const renderUpscaleButton = () => {
    const { status, completedPoses, totalPoses, isReadyForUpscale } = packStatus;

    if (totalPoses === 0) {
        return (
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <div className="inline-block">
                            <Button disabled>
                                <Wand2 className="mr-2 h-4 w-4" />
                                Upscale & Prepare for VTO
                            </Button>
                        </div>
                    </TooltipTrigger>
                    <TooltipContent>
                        <p>Generate at least one model with poses to enable upscaling.</p>
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>
        );
    }

    if (status === 'in_progress') {
        return (
            <Button variant="secondary" onClick={() => setIsUpscaleModalOpen(true)}>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Generating Poses ({completedPoses}/{totalPoses})...
            </Button>
        );
    }

    if (!isReadyForUpscale && status !== 'in_progress') { // Failed jobs exist
        return (
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button variant="outline" onClick={() => setIsUpscaleModalOpen(true)}>
                            <AlertTriangle className="mr-2 h-4 w-4 text-destructive" />
                            Upscale Incomplete Set ({posesReadyForUpscaleCount})
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                        <p>Some poses failed to generate. You can upscale the ones that succeeded.</p>
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>
        );
    }

    // Ready for upscale
    return (
        <Button onClick={() => setIsUpscaleModalOpen(true)} disabled={posesReadyForUpscaleCount === 0}>
            <Wand2 className="mr-2 h-4 w-4" />
            Upscale & Prepare for VTO ({posesReadyForUpscaleCount})
        </Button>
    );
  };

  if (isLoadingPack) return <div className="p-8"><Skeleton className="h-12 w-1/3" /><Skeleton className="mt-4 h-64 w-full" /></div>;
  if (packError) return <div className="p-8"><Alert variant="destructive"><AlertTitle>Error</AlertTitle><AlertDescription>{packError.message}</AlertDescription></Alert></div>;
  if (!pack) return <div className="p-8"><Alert><AlertTitle>Not Found</AlertTitle><AlertDescription>This model pack could not be found.</AlertDescription></Alert></div>;

  return (
    <>
      <div className="p-4 md:p-8 h-screen flex flex-col">
        <header className="pb-4 mb-4 border-b shrink-0">
          <Link to="/model-packs" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-2">
            <ArrowLeft className="h-4 w-4" />
            Back to All Packs
          </Link>
          <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                  <h1 className="text-3xl font-bold">{pack.name}</h1>
                  <PackStatusIndicator status={packStatus.status} totalPoses={packStatus.totalPoses} upscaledPoses={packStatus.upscaledPoses} />
              </div>
              {renderUpscaleButton()}
          </div>
          <div className="mt-2">
              <JobProgressBar completedPoses={packStatus.completedPoses} totalPoses={packStatus.totalPoses} />
          </div>
          <p className="text-muted-foreground mt-1">{pack.description || "No description provided."}</p>
        </header>
        <div className="mb-4">
          <PackDashboard stats={{
            totalJobs: jobs?.length || 0,
            processingBaseModels: packStatus.processingBaseModels,
            processingPoses: packStatus.processingPoses,
            processingUpscales: packStatus.processingUpscales,
            failedJobsCount: packStatus.failedJobsCount,
            totalPoses: packStatus.totalPoses,
            upscaledPoses: packStatus.upscaledPoses,
          }} />
        </div>
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
                              <div key={job.id} className="relative group">
                                <RecentJobThumbnail job={job} onClick={() => setSelectedJobId(job.id)} isSelected={selectedJobId === job.id} />
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button variant="destructive" size="icon" className="absolute top-0 right-0 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity">
                                      <Trash2 className="h-3 w-3" />
                                    </Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader><AlertDialogTitle>Remove Model from Pack?</AlertDialogTitle><AlertDialogDescription>This will only remove the model from this pack. The original generation job will not be deleted.</AlertDialogDescription></AlertDialogHeader>
                                    <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => handleRemoveModelFromPack()}>Remove</AlertDialogAction></AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              </div>
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
      <UpscalePosesModal 
        isOpen={isUpscaleModalOpen} 
        onClose={() => setIsUpscaleModalOpen(false)} 
        jobs={jobs || []} 
        packId={packId!}
        totalPoses={packStatus.totalPoses}
        completedPoses={packStatus.completedPoses}
        isReadyForUpscale={packStatus.isReadyForUpscale}
      />
      <AlertDialog open={!!jobToRemove} onOpenChange={(open) => !open && setJobToRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Remove Model from Pack?</AlertDialogTitle><AlertDialogDescription>This will only remove the model from this pack. The original generation job will not be deleted.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={handleRemoveModelFromPack}>Remove</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default ModelPackDetail;