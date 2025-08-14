import React, { useState, useMemo, useRef, useEffect } from "react";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { useLanguage } from "@/context/LanguageContext";
import { Button } from "@/components/ui/button";
import { showError, showLoading, dismissToast, showSuccess } from "@/utils/toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Wand2, Loader2, Info, History, ArrowLeft, BarChart2, CheckCircle, XCircle, AlertTriangle, UserCheck2, BadgeAlert, FileText, RefreshCw, Download, HardDriveDownload } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

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
  gracefully_failed_count?: number;
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
      const jobsPromise = fetchAll(supabase.from('mira-agent-bitstudio-jobs').select('id, vto_pack_job_id, status, batch_pair_job_id, final_image_url, metadata').eq('user_id', session.user.id).not('vto_pack_job_id', 'is', null));
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
        summary.pending_jobs = jobsForThisPack.filter((j: any) => j.status === 'pending').length;
        
        summary.passed_perfect = 0;
        summary.passed_pose_change = 0;
        summary.passed_logo_issue = 0;
        summary.passed_detail_issue = 0;
        summary.failed_jobs = 0;
        summary.failure_summary = {};
        summary.shape_mismatches = 0;
        summary.avg_body_preservation_score = null;

        let gracefullyFailedCount = 0;
        jobsForThisPack.forEach((job: any) => {
            if ((job.status === 'complete' || job.status === 'done') && job.metadata?.qa_history && Array.isArray(job.metadata.qa_history) && job.metadata.qa_history.length > 0) {
                const lastDecision = job.metadata.qa_history[job.metadata.qa_history.length - 1];
                if (lastDecision?.action === 'retry') {
                    gracefullyFailedCount++;
                }
            }
        });
        summary.gracefully_failed_count = gracefullyFailedCount;
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
        } else {
            summary.failed_jobs++;
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
    return <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Error</AlertTitle><AlertDescription>{(error as Error).message}</AlertDescription></Alert>;
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
          const gracefullyFailedCount = pack.gracefully_failed_count || 0;

          return (
            <AccordionItem key={pack.pack_id} value={pack.pack_id} className="border rounded-md">
              <div className="flex items-center p-4">
                <AccordionTrigger className="flex-1 text-left p-0 hover:no-underline">
                  <div className="text-left">
                    <p className="font-semibold flex items-center gap-2">
                      {isRefinementPack && <Wand2 className="h-5 w-5 text-purple-500" />}
                      <span>{pack.metadata?.name || `Pack from ${new Date(pack.created_at).toLocaleString()}`}</span>
                      {gracefullyFailedCount > 0 && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <AlertTriangle className="h-5 w-5 text-yellow-600" />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>{t('gracefullyFailedTooltip', { count: gracefullyFailedCount })}</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
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

const VirtualTryOnPacks = () => {
  const { t } = useLanguage();
  const [mode, setMode] = useState<'view' | 'create'>('view');
  const [queue, setQueue] = useState<QueueItem[]>([]);

  const handleQueueReady = (newQueue: QueueItem[]) => {
    setQueue(newQueue);
    setMode('review');
  };

  if (mode === 'view') {
    return (
      <div className="p-4 md:p-8 h-screen overflow-y-auto">
        <header className="pb-4 mb-8 border-b">
          <h1 className="text-3xl font-bold">{t('virtualTryOnPacks')}</h1>
          <p className="text-muted-foreground">{t('vtoPacksDescription')}</p>
        </header>
        <RecentPacksView />
      </div>
    );
  }

  if (mode === 'create') {
    return <VtoInputProvider onQueueReady={handleQueueReady} onGoBack={() => setMode('view')} />;
  }

  if (mode === 'review') {
    return <VtoReviewQueue queue={queue} />;
  }

  return null;
};

export default VirtualTryOnPacks;