import React, { useState, useMemo, useRef, useEffect } from "react";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { useLanguage } from "@/context/LanguageContext";
import { Button } from "@/components/ui/button";
import { VtoModeSelector } from "@/components/VTO/VtoModeSelector";
import { VtoInputProvider, QueueItem } from "@/components/VTO/VtoInputProvider";
import { VtoReviewQueue } from "@/components/VTO/VtoReviewQueue";
import { showError, showLoading, dismissToast, showSuccess } from "@/utils/toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Wand2, Loader2, Info, History, ArrowLeft, BarChart2, CheckCircle, XCircle, AlertTriangle, UserCheck2, BadgeAlert, FileText, RefreshCw, Download, HardDriveDownload } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { optimizeImage, sanitizeFilename } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Link } from "react-router-dom";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { RealtimeChannel } from "@supabase/supabase-js";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { VtoPackDetailView } from '@/components/VTO/VtoPackDetailView';
import { AnalyzePackModal, AnalysisScope } from '@/components/VTO/AnalyzePackModal';
import { DownloadPackModal } from "@/components/VTO/DownloadPackModal";
import { RefinePackModal, RefineScope } from "@/components/VTO/RefinePackModal";

interface QaReport {
  id: string;
  vto_pack_job_id: string;
  created_at: string;
  comparative_report: {
    overall_pass: boolean;
    pass_with_notes: boolean;
    pass_notes_category: 'logo_fidelity' | 'detail_accuracy' | 'minor_artifact' | null;
    failure_category: string | null;
    pose_and_body_analysis?: {
        pose_changed: boolean;
        scores: {
            body_type_preservation?: number;
        }
    },
    garment_comparison?: {
        generated_garment_type?: string;
    },
    garment_analysis?: {
        garment_type?: string;
    }
  } | null;
}

interface PackSummary {
  pack_id: string;
  created_at: string;
  metadata: {
    name?: string;
    refinement_of_pack_id?: string;
    total_pairs: number;
    engine?: 'google' | 'bitstudio';
  };
  total_jobs: number;
  completed_jobs: number;
  pending_jobs: number;
  passed_perfect: number;
  passed_pose_change: number;
  passed_logo_issue: number;
  passed_detail_issue: number;
  failed_jobs: number;
  failure_summary: Record<string, number>;
  shape_mismatches: number;
  avg_body_preservation_score: number | null;
  has_refinement_pass: boolean;
}

const RecentPacksView = () => {
  const { t } = useLanguage();
  const { supabase, session } = useSession();
  const queryClient = useQueryClient();
  const [openPackId, setOpenPackId] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState<string | null>(null);
  const [packToAnalyze, setPackToAnalyze] = useState<PackSummary | null>(null);
  const [packToDownload, setPackToDownload] = useState<PackSummary | null>(null);
  const [isStartingRefinement, setIsStartingRefinement] = useState<string | null>(null);
  const [packToRefine, setPackToRefine] = useState<PackSummary | null>(null);
  const [isRetrying, setIsRetrying] = useState<string | null>(null);
  const [isRequeuing, setIsRequeuing] = useState<string | null>(null);
  const [isRetryingIncomplete, setIsRetryingIncomplete] = useState<string | null>(null);

  const { data: queryData, isLoading, error } = useQuery<any>({
    queryKey: ['vtoPackSummaries', session?.user?.id],
    queryFn: async () => {
      if (!session?.user) return { packs: [], jobs: [], batchPairJobs: [], reports: [] };
      
      const fetchAll = async (queryBuilder: any) => {
        let allData: any[] = [];
        let page = 0;
        const pageSize = 1000; // Supabase default limit
        while (true) {
          const { data, error } = await queryBuilder.range(page * pageSize, (page + 1) * pageSize - 1);
          if (error) throw error;
          if (data) {
            allData = allData.concat(data);
          }
          if (!data || data.length < pageSize) {
            break;
          }
          page++;
        }
        return allData;
      };

      const packsPromise = supabase.from('mira-agent-vto-packs-jobs').select('id, created_at, metadata').eq('user_id', session.user.id);
      const jobsPromise = fetchAll(supabase.from('mira-agent-bitstudio-jobs').select('id, vto_pack_job_id, status, batch_pair_job_id, final_image_url').eq('user_id', session.user.id).not('vto_pack_job_id', 'is', null));
      const batchPairJobsPromise = fetchAll(supabase.from('mira-agent-batch-inpaint-pair-jobs').select('id, metadata, status').eq('user_id', session.user.id).not('metadata->>vto_pack_job_id', 'is', null));
      const reportsPromise = supabase.rpc('get_vto_qa_reports_for_user', { p_user_id: session.user.id });

      const [{ data: packs, error: packsError }, bitstudioJobs, batchPairJobs, { data: reports, error: reportsError }] = await Promise.all([packsPromise, jobsPromise, batchPairJobsPromise, reportsPromise]);

      if (packsError) throw packsError;
      if (reportsError) throw reportsError;

      return { packs, jobs: bitstudioJobs, batchPairJobs, reports };
    },
    enabled: !!session?.user,
  });

  useEffect(() => {
    if (!session?.user?.id) return;
    const channel: RealtimeChannel = supabase
      .channel(`vto-qa-reports-tracker-${session.user.id}`)
      .on<QaReport>(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'mira-agent-vto-qa-reports', filter: `user_id=eq.${session.user.id}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ['vtoPackSummaries', session.user.id] });
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'mira-agent-vto-packs-jobs', filter: `user_id=eq.${session.user.id}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ['vtoPackSummaries', session.user.id] });
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'mira-agent-bitstudio-jobs', filter: `user_id=eq.${session.user.id}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ['vtoPackSummaries', session.user.id] });
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'mira-agent-batch-inpaint-pair-jobs', filter: `user_id=eq.${session.user.id}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ['vtoPackSummaries', session.user.id] });
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [session?.user?.id, supabase, queryClient]);

  const packSummaries = useMemo((): PackSummary[] => {
    if (!queryData?.packs) return [];
    const { packs, jobs: bitstudioJobs = [], batchPairJobs = [], reports = [] } = queryData;
    const packsMap = new Map<string, PackSummary>();

    for (const pack of packs) {
        packsMap.set(pack.id, {
            pack_id: pack.id,
            created_at: pack.created_at,
            metadata: pack.metadata || {},
            total_jobs: 0,
            completed_jobs: 0,
            pending_jobs: 0,
            passed_perfect: 0, passed_pose_change: 0, passed_logo_issue: 0, passed_detail_issue: 0,
            failed_jobs: 0, failure_summary: {}, shape_mismatches: 0, avg_body_preservation_score: null, has_refinement_pass: false,
        });
    }

    const allJobsForPack = new Map<string, any[]>();

    bitstudioJobs.forEach((job: any) => {
        if (job.vto_pack_job_id) {
            if (!allJobsForPack.has(job.vto_pack_job_id)) allJobsForPack.set(job.vto_pack_job_id, []);
            allJobsForPack.get(job.vto_pack_job_id)!.push(job);
        }
    });

    const processedPairJobIds = new Set(bitstudioJobs.map((j: any) => j.batch_pair_job_id).filter(Boolean));
    batchPairJobs.forEach((job: any) => {
        const packId = job.metadata?.vto_pack_job_id;
        if (packId && !processedPairJobIds.has(job.id)) {
            if (!allJobsForPack.has(packId)) allJobsForPack.set(packId, []);
            allJobsForPack.get(packId)!.push(job);
        }
    });

    for (const pack of packs) {
        const summary = packsMap.get(pack.id)!;
        const jobsForThisPack = allJobsForPack.get(pack.id) || [];
        
        summary.total_jobs = jobsForThisPack.length;
        summary.completed_jobs = jobsForThisPack.filter((j: any) => (j.status === 'complete' || j.status === 'done') && j.final_image_url).length;
        summary.failed_jobs = jobsForThisPack.filter((j: any) => ['failed', 'permanently_failed'].includes(j.status)).length;
        summary.pending_jobs = jobsForThisPack.filter((j: any) => j.status === 'pending').length;
    }

    for (const report of reports) {
      if (!packsMap.has(report.vto_pack_job_id)) continue;
      const summary = packsMap.get(report.vto_pack_job_id)!;
      const reportData = report.comparative_report;
      if (reportData) {
        if (reportData.overall_pass) {
          if (reportData.pass_with_notes) {
              if (reportData.pass_notes_category === 'logo_fidelity') summary.passed_logo_issue++;
              else if (reportData.pass_notes_category === 'detail_accuracy') summary.passed_detail_issue++;
          } else if (reportData.pose_and_body_analysis?.pose_changed) {
              summary.passed_pose_change++;
          } else {
              summary.passed_perfect++;
          }
        }
        const reason = reportData.failure_category || "Unknown";
        summary.failure_summary[reason] = (summary.failure_summary[reason] || 0) + 1;
        if (reportData.garment_analysis?.garment_type && reportData.garment_comparison?.generated_garment_type && reportData.garment_analysis.garment_type !== reportData.garment_comparison.generated_garment_type) {
            summary.shape_mismatches++;
        }
        const bodyScore = reportData.pose_and_body_analysis?.scores?.body_type_preservation;
        if (typeof bodyScore === 'number') {
            const currentTotal = (summary.avg_body_preservation_score || 0) * (summary.total_jobs - 1);
            summary.avg_body_preservation_score = (currentTotal + bodyScore) / summary.total_jobs;
        }
      }
    }

    const allPacks = Array.from(packsMap.values());
    allPacks.forEach(pack => {
        pack.has_refinement_pass = allPacks.some(p => p.metadata?.refinement_of_pack_id === pack.pack_id);
    });

    return allPacks.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [queryData]);

  const handleAnalyze = async (scope: AnalysisScope) => {
    if (!packToAnalyze || !session?.user) return;
    setIsAnalyzing(packToAnalyze.pack_id);
    const toastId = showLoading("Starting analysis...");
    try {
      const { data, error } = await supabase.functions.invoke('MIRA-AGENT-orchestrator-vto-reporter', {
        body: { pack_id: packToAnalyze.pack_id, user_id: session.user.id, analysis_scope: scope }
      });
      if (error) throw error;
      dismissToast(toastId);
      showSuccess(data.message);
      queryClient.invalidateQueries({ queryKey: ['vtoPackSummaries', session.user.id] });
      setPackToAnalyze(null);
    } catch (err: any) {
      dismissToast(toastId);
      showError(`Analysis failed: ${err.message}`);
    } finally {
      setIsAnalyzing(null);
    }
  };

  const handleStartRefinement = async (scope: RefineScope) => {
    if (!packToRefine || !session?.user) return;
    setIsStartingRefinement(packToRefine.pack_id);
    const toastId = showLoading("Preparing refinement pass...");

    try {
        const { data, error } = await supabase.functions.invoke('MIRA-AGENT-orchestrator-vto-refinement-pass', {
            body: { 
                pack_id: packToRefine.pack_id, 
                user_id: session.user.id,
                scope: scope
            }
        });
        if (error) throw error;
        
        dismissToast(toastId);
        showSuccess(data.message);
        queryClient.invalidateQueries({ queryKey: ['vtoPackSummaries', session.user.id] });
        setPackToRefine(null);
    } catch (err: any) {
        dismissToast(toastId);
        showError(`Failed to start refinement: ${err.message}`);
    } finally {
        setIsStartingRefinement(null);
    }
  };

  const handleRetryIncomplete = async (pack: PackSummary) => {
    if (!session?.user) return;
    setIsRetryingIncomplete(pack.pack_id);
    const incompleteCount = pack.total_jobs - pack.completed_jobs;
    const toastId = showLoading(`Re-queueing ${incompleteCount} incomplete jobs...`);
    try {
        const { data, error } = await supabase.rpc('MIRA-AGENT-retry-all-incomplete-in-pack', {
            p_pack_id: pack.pack_id
        });
        if (error) throw error;
        dismissToast(toastId);
        showSuccess(`${data} jobs have been re-queued for processing.`);
        queryClient.invalidateQueries({ queryKey: ['vtoPackSummaries', session.user.id] });
    } catch (err: any) {
        dismissToast(toastId);
        showError(`Failed to re-queue jobs: ${err.message}`);
    } finally {
        setIsRetryingIncomplete(null);
    }
  };

  if (isLoading) {
    return <div className="space-y-4"><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /></div>;
  }

  if (error) {
    return <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Error</AlertTitle><AlertDescription>{error.message}</AlertDescription></Alert>;
  }

  if (packSummaries.length === 0) {
    return (
      <div className="text-center py-16">
        <h2 className="mt-4 text-xl font-semibold">{t('noReportsGenerated')}</h2>
        <p className="mt-2 text-muted-foreground">{t('noReportsGeneratedDescription')}</p>
      </div>
    );
  }

  return (
    <>
      <Accordion type="single" collapsible className="w-full space-y-4" onValueChange={setOpenPackId}>
        {packSummaries.map(pack => {
          const totalReports = pack.passed_perfect + pack.passed_pose_change + pack.passed_logo_issue + pack.passed_detail_issue + pack.failed_jobs;
          const isReportReady = totalReports > 0;
          const isRefinementPack = !!pack.metadata?.refinement_of_pack_id;
          const incompleteCount = pack.total_jobs - pack.completed_jobs;

          return (
            <AccordionItem key={pack.pack_id} value={pack.pack_id} className="border rounded-md">
              <div className="flex items-center p-4">
                <AccordionTrigger className="flex-1 text-left p-0 hover:no-underline">
                  <div className="text-left">
                    <p className="font-semibold flex items-center gap-2">
                      {isRefinementPack && <Wand2 className="h-5 w-5 text-purple-500" />}
                      <span>{pack.metadata?.name || `Pack from ${new Date(pack.created_at).toLocaleString()}`}</span>
                    </p>
                    <div className="flex items-center gap-2 mt-2">
                      <Progress value={(pack.completed_jobs / (pack.metadata?.total_pairs || pack.total_jobs || 1)) * 100} className="h-2 w-32" />
                      <p className="text-sm text-muted-foreground">
                        {pack.completed_jobs} / {pack.metadata?.total_pairs || pack.total_jobs} completed
                      </p>
                    </div>
                  </div>
                </AccordionTrigger>
                <div className="flex items-center gap-2 pl-4">
                  {incompleteCount > 0 && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="outline" size="sm" disabled={isRetryingIncomplete === pack.pack_id}>
                          {isRetryingIncomplete === pack.pack_id ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                          {t('restartIncomplete')} ({incompleteCount})
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>{t('restartIncompleteConfirmationTitle')}</AlertDialogTitle>
                          <AlertDialogDescription>
                            {t('restartIncompleteConfirmationDescription', { count: incompleteCount })}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                          <AlertDialogAction onClick={() => handleRetryIncomplete(pack)}>
                            {t('restartIncompleteAction')}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                  <Button variant="outline" size="sm" onClick={() => setPackToDownload(pack)}>
                    <HardDriveDownload className="h-4 w-4 mr-2" />
                    {t('downloadPack')}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setPackToAnalyze(pack)} disabled={isAnalyzing === pack.pack_id}>
                    {isAnalyzing === pack.pack_id ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <BarChart2 className="h-4 w-4 mr-2" />}
                    {t('analyzePack')}
                  </Button>
                  {!isRefinementPack && (
                    <Button variant="secondary" size="sm" onClick={() => setPackToRefine(pack)} disabled={isStartingRefinement === pack.pack_id || pack.completed_jobs === 0}>
                      {isStartingRefinement === pack.pack_id ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Wand2 className="h-4 w-4 mr-2" />}
                      {t('refinePack')}
                    </Button>
                  )}
                  <Link to={`/vto-reports/${pack.pack_id}`} onClick={(e) => !isReportReady && e.preventDefault()}>
                    <Button disabled={!isReportReady}>{t('viewReport')}</Button>
                  </Link>
                </div>
              </div>
              <AccordionContent className="p-4 pt-0">
                <VtoPackDetailView 
                  packId={pack.pack_id} 
                  packName={pack.metadata?.name || `Pack from ${new Date(pack.created_at).toLocaleString()}`}
                  isOpen={openPackId === pack.pack_id} 
                />
              </AccordionContent>
            </AccordionItem>
          )
        })}
      </Accordion>
      <AnalyzePackModal isOpen={!!packToAnalyze} onClose={() => setPackToAnalyze(null)} onAnalyze={handleAnalyze} isLoading={!!isAnalyzing} packName={packToAnalyze?.metadata?.name || ''} />
      <DownloadPackModal isOpen={!!packToDownload} onClose={() => setPackToDownload(null)} pack={packToDownload} />
      <RefinePackModal isOpen={!!packToRefine} onClose={() => setPackToRefine(null)} onRefine={handleStartRefinement} isLoading={!!isStartingRefinement} packName={packToRefine?.metadata?.name || ''} />
    </>
  );
};

type WizardStep = 'select-mode' | 'provide-inputs' | 'review-queue';
type VtoMode = 'one-to-many' | 'precise-pairs' | 'random-pairs';
type CroppingMode = 'frame' | 'expand';

interface GarmentPack {
  id: string;
  name: string;
}

const VirtualTryOnPacks = () => {
  const { supabase, session } = useSession();
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<WizardStep>('select-mode');
  const [mode, setMode] = useState<VtoMode | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<string>("1:1");
  const [skipReframe, setSkipReframe] = useState(false);
  const [croppingMode, setCroppingMode] = useState<CroppingMode>('frame');
  const [autoComplete, setAutoComplete] = useState(true);
  const [autoCompletePackId, setAutoCompletePackId] = useState<string | null>(null);

  const { data: garmentPacks, isLoading: isLoadingGarmentPacks } = useQuery<GarmentPack[]>({
    queryKey: ['garmentPacks', session?.user?.id],
    queryFn: async () => {
      if (!session?.user) return [];
      const { data, error } = await supabase.from('mira-agent-garment-packs').select('id, name').eq('user_id', session.user.id);
      if (error) throw error;
      return data;
    },
    enabled: !!session?.user,
  });

  const handleSelectMode = (selectedMode: VtoMode) => {
    setMode(selectedMode);
    setStep('provide-inputs');
  };

  const handleQueueReady = (newQueue: QueueItem[]) => {
    setQueue(newQueue);
    setStep('review-queue');
  };

  const handleGoBack = () => {
    if (step === 'provide-inputs') {
      setStep('select-mode');
    } else if (step === 'review-queue') {
      setStep('provide-inputs');
    }
  };

  const handleGenerate = async () => {
    if (queue.length === 0) return;
    if (autoComplete && !autoCompletePackId) {
      showError("Please select a Garment Pack for the auto-complete feature.");
      return;
    }
    setIsLoading(true);
    const toastId = showLoading(`Uploading assets and queuing ${queue.length} jobs...`);

    try {
      const uploadFile = async (file: File, type: 'person' | 'garment') => {
        if (!session?.user) throw new Error("User session not found.");
        const optimizedFile = await optimizeImage(file);
        const filePath = `${session.user.id}/vto-source/${type}-${Date.now()}-${sanitizeFilename(file.name)}`;
        
        const { error } = await supabase.storage
          .from('mira-agent-user-uploads')
          .upload(filePath, optimizedFile, {
            contentType: 'image/png',
            upsert: true,
          });
        
        if (error) {
          console.error("Supabase upload error details:", error);
          throw new Error(`Storage upload failed: ${error.message}`);
        }
        
        const { data: { publicUrl } } = supabase.storage
          .from('mira-agent-user-uploads')
          .getPublicUrl(filePath);
          
        return publicUrl;
      };

      const pairsForBackend = await Promise.all(queue.map(async (item) => {
        const person_url = item.person.url;
        
        const garment_url = item.garment.file 
            ? await uploadFile(item.garment.file, 'garment') 
            : item.garment.url;
        
        return {
          person_url,
          garment_url,
          appendix: item.appendix,
          metadata: {
            model_generation_job_id: item.person.model_job_id,
            garment_analysis: item.garment.analysis,
          }
        };
      }));

      const { error } = await supabase.functions.invoke('MIRA-AGENT-orchestrator-vto-packs', {
        body: {
          pairs: pairsForBackend,
          user_id: session?.user?.id,
          engine: 'google',
          aspect_ratio: aspectRatio,
          skip_reframe: skipReframe,
          cropping_mode: croppingMode,
          auto_complete_outfit: autoComplete,
          auto_complete_pack_id: autoComplete ? autoCompletePackId : null,
        }
      });

      if (error) throw error;

      dismissToast(toastId);
      showSuccess(`${queue.length} jobs have been queued for processing.`);
      queryClient.invalidateQueries({ queryKey: ['recentVtoPacks'] });
      setStep('select-mode');
      setQueue([]);
      setMode(null);
    } catch (err: any) {
      dismissToast(toastId);
      showError(`Failed to queue batch job: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const renderCreateStep = () => {
    switch (step) {
      case 'select-mode':
        return (
          <div className="flex flex-col items-center justify-center h-full">
            <Alert className="max-w-2xl mb-8">
              <Info className="h-4 w-4" />
              <AlertTitle>{t('vtoPacksIntroTitle')}</AlertTitle>
              <AlertDescription>{t('vtoPacksIntroDescription')}</AlertDescription>
            </Alert>
            <VtoModeSelector onSelectMode={handleSelectMode} />
          </div>
        );
      case 'provide-inputs':
        return <VtoInputProvider 
                  mode={mode!} 
                  onQueueReady={handleQueueReady} 
                  onGoBack={handleGoBack}
                />;
      case 'review-queue':
        return (
          <div className="max-w-2xl mx-auto space-y-6">
            <VtoReviewQueue queue={queue} />
            <Card>
              <CardHeader><CardTitle>Advanced Settings</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label htmlFor="auto-complete-switch" className="flex items-center gap-2">
                    {t('autoCompleteOutfit')}
                  </Label>
                  <Switch id="auto-complete-switch" checked={autoComplete} onCheckedChange={setAutoComplete} />
                </div>
                <p className="text-xs text-muted-foreground">{t('autoCompleteOutfitDesc')}</p>
                
                {autoComplete && (
                  <div className="space-y-2 pl-2 border-l-2 border-primary/50">
                    <Label htmlFor="pack-select">{t('selectGarmentPack')}</Label>
                    <Select value={autoCompletePackId || ""} onValueChange={setAutoCompletePackId}>
                      <SelectTrigger id="pack-select">
                        <SelectValue placeholder={t('selectGarmentPackPlaceholder')} />
                      </SelectTrigger>
                      <SelectContent>
                        {isLoadingGarmentPacks ? (
                          <SelectItem value="loading" disabled>Loading...</SelectItem>
                        ) : (
                          garmentPacks?.map(pack => (
                            <SelectItem key={pack.id} value={pack.id}>{pack.name}</SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">{t('selectGarmentPackDesc')}</p>
                  </div>
                )}

                <div className="space-y-2">
                  <Label>{t('croppingMode')}</Label>
                  <RadioGroup value={croppingMode} onValueChange={(v) => setCroppingMode(v as CroppingMode)} className="mt-2 space-y-2">
                    <div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="frame" id="crop-frame" />
                        <Label htmlFor="crop-frame">{t('croppingModeFrame')}</Label>
                      </div>
                      <p className="text-xs text-muted-foreground ml-6">{t('croppingModeFrameDesc')}</p>
                    </div>
                    <div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="expand" id="crop-expand" />
                        <Label htmlFor="crop-expand">{t('croppingModeExpand')}</Label>
                      </div>
                      <p className="text-xs text-muted-foreground ml-6">{t('croppingModeExpandDesc')}</p>
                    </div>
                  </RadioGroup>
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="skip-reframe-switch" className="flex items-center gap-2">
                    {t('skipReframe')}
                  </Label>
                  <Switch id="skip-reframe-switch" checked={skipReframe} onCheckedChange={setSkipReframe} />
                </div>
                <p className="text-xs text-muted-foreground">{t('skipReframeDescription')}</p>
                <div className="space-y-2">
                  <Label htmlFor="aspect-ratio-final" className={cn(skipReframe && "text-muted-foreground")}>{t('aspectRatio')}</Label>
                  <Select value={aspectRatio} onValueChange={setAspectRatio} disabled={skipReframe}>
                    <SelectTrigger id="aspect-ratio-final">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {aspectRatioOptions.map(ratio => (
                        <SelectItem key={ratio} value={ratio}>{ratio}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {skipReframe ? t('aspectRatioDisabled') : t('aspectRatioDescription')}
                  </p>
                </div>
              </CardContent>
            </Card>
            <Alert>
              <Info className="h-4 w-4" />
              <AlertTitle>Ready to Generate</AlertTitle>
              <AlertDescription>
                You are about to generate {queue.length} images using the <strong>Google VTO</strong> engine.
              </AlertDescription>
            </Alert>
            <div className="flex justify-between items-center">
              <Button variant="outline" onClick={handleGoBack}>{t('goBack')}</Button>
              <Button size="lg" onClick={handleGenerate} disabled={isLoading}>
                {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
                {t('generateNImages', { count: queue.length })}
              </Button>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  const getStepTitle = () => {
    switch (step) {
      case 'select-mode': return t('step1Title');
      case 'provide-inputs': return t('step2Title');
      case 'review-queue': return t('step3Title');
      default: return '';
    }
  };

  return (
    <div className="p-4 md:p-8 h-screen flex flex-col">
      <header className="pb-4 mb-4 border-b shrink-0">
        <div className="flex justify-between items-center">
            <div>
                <h1 className="text-3xl font-bold">{t('virtualTryOnPacks')}</h1>
                <p className="text-muted-foreground">{getStepTitle()}</p>
            </div>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto">
        <Tabs defaultValue="create" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="create">{t('createBatch')}</TabsTrigger>
            <TabsTrigger value="recent">{t('recentJobs')}</TabsTrigger>
          </TabsList>
          <TabsContent value="create" className="pt-6">
            {renderCreateStep()}
          </TabsContent>
          <TabsContent value="recent" className="pt-6">
            <RecentPacksView />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default VirtualTryOnPacks;