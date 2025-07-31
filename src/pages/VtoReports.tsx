import { useMemo, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Progress } from "@/components/ui/progress";
import { BarChart2, CheckCircle, XCircle, Loader2, AlertTriangle, UserCheck2, BadgeAlert, FileText, RefreshCw, Wand2, Download, HardDriveDownload, Shirt, ArrowLeft } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { RealtimeChannel } from "@supabase/supabase-js";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { showError, showLoading, dismissToast, showSuccess } from "@/utils/toast";
import { VtoPackDetailView } from '@/components/VTO/VtoPackDetailView';
import { AnalyzePackModal, AnalysisScope } from '@/components/VTO/AnalyzePackModal';
import { DownloadPackModal } from "@/components/VTO/DownloadPackModal";

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

const VtoReports = () => {
  const { t } = useLanguage();
  const { supabase, session } = useSession();
  const queryClient = useQueryClient();
  const [openPackId, setOpenPackId] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState<string | null>(null);
  const [packToAnalyze, setPackToAnalyze] = useState<PackSummary | null>(null);
  const [packToDownload, setPackToDownload] = useState<PackSummary | null>(null);
  const [isStartingRefinement, setIsStartingRefinement] = useState<string | null>(null);

  const { data: queryData, isLoading, error } = useQuery<any>({ // Using any for now to accommodate packs table
    queryKey: ['vtoQaReportsAndPacks', session?.user?.id],
    queryFn: async () => {
      if (!session?.user) return [];
      const { data: reports, error: reportsError } = await supabase.rpc('get_vto_qa_reports_for_user', { p_user_id: session.user.id });
      if (reportsError) throw reportsError;

      const { data: packs, error: packsError } = await supabase.from('mira-agent-vto-packs-jobs').select('id, created_at, metadata').eq('user_id', session.user.id);
      if (packsError) throw packsError;

      const { data: jobs, error: jobsError } = await supabase
        .from('mira-agent-bitstudio-jobs')
        .select('id, vto_pack_job_id, status, batch_pair_job_id')
        .eq('user_id', session.user.id)
        .not('vto_pack_job_id', 'is', null);
      if (jobsError) throw jobsError;

      const { data: batchPairJobs, error: batchPairError } = await supabase
        .from('mira-agent-batch-inpaint-pair-jobs')
        .select('id, metadata, status')
        .eq('user_id', session.user.id)
        .not('metadata->>vto_pack_job_id', 'is', null);
      if (batchPairError) throw batchPairError;

      return { reports, packs, jobs, batchPairJobs };
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
          queryClient.invalidateQueries({ queryKey: ['vtoQaReportsAndPacks', session.user.id] });
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'mira-agent-vto-packs-jobs', filter: `user_id=eq.${session.user.id}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ['vtoQaReportsAndPacks', session.user.id] });
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'mira-agent-bitstudio-jobs', filter: `user_id=eq.${session.user.id}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ['vtoQaReportsAndPacks', session.user.id] });
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'mira-agent-batch-inpaint-pair-jobs', filter: `user_id=eq.${session.user.id}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ['vtoQaReportsAndPacks', session.user.id] });
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
        summary.completed_jobs = jobsForThisPack.filter((j: any) => ['complete', 'done', 'failed', 'permanently_failed'].includes(j.status)).length;
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
          const reason = reportData.failure_category || "Unknown";
          summary.failure_summary[reason] = (summary.failure_summary[reason] || 0) + 1;
        }
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
      queryClient.invalidateQueries({ queryKey: ['vtoQaReportsAndPacks', session.user.id] });
      setPackToAnalyze(null);
    } catch (err: any) {
      dismissToast(toastId);
      showError(`Analysis failed: ${err.message}`);
    } finally {
      setIsAnalyzing(null);
    }
  };

  const handleStartRefinement = async (packId: string) => {
    if (!session?.user) return;
    setIsStartingRefinement(packId);
    const toastId = showLoading("Creating refinement pass...");
    try {
        const { data, error } = await supabase.functions.invoke('MIRA-AGENT-orchestrator-vto-refinement-pass', {
            body: { pack_id: packId, user_id: session.user.id }
        });
        if (error) throw error;
        dismissToast(toastId);
        showSuccess(data.message);
        queryClient.invalidateQueries({ queryKey: ['vtoQaReportsAndPacks', session.user.id] });
    } catch (err: any) {
        dismissToast(toastId);
        showError(`Failed to start refinement: ${err.message}`);
    } finally {
        setIsStartingRefinement(null);
    }
  };

  if (isLoading) {
    return <div className="p-8 space-y-4"><Skeleton className="h-32 w-full" /><Skeleton className="h-32 w-full" /></div>;
  }

  if (error) {
    return <div className="p-8"><Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Error</AlertTitle><AlertDescription>{error.message}</AlertDescription></Alert></div>;
  }

  if (!queryData?.packs || queryData.packs.length === 0) {
    return <p className="text-center text-muted-foreground py-8">No recent batch jobs found.</p>;
  }

  return (
    <>
      <div className="p-4 md:p-8 h-screen overflow-y-auto">
        <header className="pb-4 mb-8 border-b">
          <h1 className="text-3xl font-bold">{t('vtoAnalysisReports')}</h1>
          <p className="text-muted-foreground">{t('vtoAnalysisReportsDescription')}</p>
        </header>
        <div className="space-y-4">
          {packSummaries.map(report => {
            const totalReports = report.passed_perfect + report.passed_pose_change + report.passed_logo_issue + report.passed_detail_issue + report.failed_jobs;
            const isReportReady = totalReports > 0;
            const isRefinementPack = !!report.metadata?.refinement_of_pack_id;

            return (
              <Card key={report.pack_id}>
                <CardHeader>
                  <CardTitle className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      {isRefinementPack && <Wand2 className="h-5 w-5 text-purple-500" />}
                      <span>{report.metadata?.name || `Pack from ${new Date(report.created_at).toLocaleString()}`}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" onClick={() => setPackToDownload(report)}>
                        <HardDriveDownload className="h-4 w-4 mr-2" />
                        {t('downloadPack')}
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setPackToAnalyze(report)} disabled={isAnalyzing === report.pack_id}>
                        {isAnalyzing === report.pack_id ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <BarChart2 className="h-4 w-4 mr-2" />}
                        {t('analyzePack')}
                      </Button>
                      {report.failed_jobs > 0 && !report.has_refinement_pass && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="secondary" size="sm" disabled={isStartingRefinement === report.pack_id}>
                              {isStartingRefinement === report.pack_id ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Wand2 className="h-4 w-4 mr-2" />}
                              {t('refineFailedJobs')} ({report.failed_jobs})
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>{t('refineFailedJobsTitle')}</AlertDialogTitle>
                              <AlertDialogDescription>{t('refineFailedJobsDescription', { count: report.failed_jobs })}</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleStartRefinement(report.pack_id)}>{t('refineFailedJobsAction')}</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                      <Link to={`/vto-reports/${report.pack_id}`} onClick={(e) => !isReportReady && e.preventDefault()}>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className={!isReportReady ? 'cursor-not-allowed' : ''}>
                                <Button disabled={!isReportReady}>{t('viewReport')}</Button>
                              </div>
                            </TooltipTrigger>
                            {!isReportReady && <TooltipContent><p>No analysis has been run for this pack yet.</p></TooltipContent>}
                          </Tooltip>
                        </TooltipProvider>
                      </Link>
                    </div>
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <h3 className="font-semibold text-sm">{t('overallPassRate')}</h3>
                    <div className="flex items-center gap-4 flex-wrap">
                      <div className="flex items-center gap-2 text-green-600"><CheckCircle className="h-5 w-5" /><span className="text-2xl font-bold">{report.passed_perfect}</span><span>Passed</span></div>
                      <div className="flex items-center gap-2 text-yellow-600"><UserCheck2 className="h-5 w-5" /><span className="text-2xl font-bold">{report.passed_pose_change}</span><span>Passed (Pose Change)</span></div>
                      <div className="flex items-center gap-2 text-orange-500"><BadgeAlert className="h-5 w-5" /><span className="text-2xl font-bold">{report.passed_logo_issue}</span><span>Passed (Logo Issue)</span></div>
                      <div className="flex items-center gap-2 text-orange-500"><FileText className="h-5 w-5" /><span className="text-2xl font-bold">{report.passed_detail_issue}</span><span>Passed (Detail Issue)</span></div>
                      <div className="flex items-center gap-2 text-destructive"><XCircle className="h-5 w-5" /><span className="text-2xl font-bold">{report.failed_jobs}</span><span>Failed</span></div>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <h3 className="font-semibold text-sm">Integrity Scores</h3>
                    <div className="flex items-center gap-4 flex-wrap">
                      <div className="flex items-center gap-2">
                        <Shirt className="h-5 w-5" />
                        <span className="text-2xl font-bold">{report.shape_mismatches}</span>
                        <span>Shape Mismatches</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <UserCheck2 className="h-5 w-5" />
                        <span className="text-2xl font-bold">{report.avg_body_preservation_score?.toFixed(1) || 'N/A'}</span>
                        <span>Avg. Body Preservation</span>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <h3 className="font-semibold text-sm">{t('failureReasons')}</h3>
                    {Object.keys(report.failure_summary).length > 0 ? (
                      <div className="text-xs text-muted-foreground space-y-1">
                        {Object.entries(report.failure_summary).map(([reason, count]) => (
                          <div key={reason} className="flex justify-between">
                            <span className="capitalize">{reason.replace(/_/g, ' ')}</span>
                            <span>{count}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="h-full bg-muted rounded-md flex items-center justify-center text-muted-foreground">
                        <p>No failures recorded.</p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}
          {packSummaries.length === 0 && (
            <div className="text-center py-16">
              <h2 className="mt-4 text-xl font-semibold">{t('noReportsGenerated')}</h2>
              <p className="mt-2 text-muted-foreground">{t('noReportsGeneratedDescription')}</p>
            </div>
          )}
        </div>
      </div>
      <AnalyzePackModal isOpen={!!packToAnalyze} onClose={() => setPackToAnalyze(null)} onAnalyze={handleAnalyze} isLoading={!!isAnalyzing} packName={packToAnalyze?.metadata?.name || ''} />
      <DownloadPackModal isOpen={!!packToDownload} onClose={() => setPackToDownload(null)} pack={packToDownload} />
    </>
  );
};

export default VtoReports;