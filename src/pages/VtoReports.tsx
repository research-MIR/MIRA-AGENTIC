import { useMemo, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Progress } from "@/components/ui/progress";
import { BarChart2, CheckCircle, XCircle, Loader2, AlertTriangle, UserCheck2, BadgeAlert, FileText, RefreshCw, Wand2, Download, HardDriveDownload, Shirt, ArrowLeft, Trash2 } from "lucide-react";
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
import { RefinePackModal, RefineScope } from "./RefinePackModal";

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
  const [packToRefine, setPackToRefine] = useState<PackSummary | null>(null);
  const [isRetrying, setIsRetrying] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);

  const { data: queryData, isLoading, error } = useQuery<any>({
    queryKey: ['vtoQaReportsAndPacks', session?.user?.id],
    queryFn: async () => {
      if (!session?.user) return [];
      const { data: reports, error: reportsError } = await supabase.rpc('get_vto_qa_reports_for_user', { p_user_id: session.user.id });
      if (reportsError) throw reportsError;

      const { data: packs, error: packsError } = await supabase.from('mira-agent-vto-packs-jobs').select('id, created_at, metadata').eq('user_id', session.user.id);
      if (packsError) throw packsError;

      return { reports, packs };
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
    const { packs, reports = [] } = queryData;
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

    for (const report of reports) {
      if (!packsMap.has(report.vto_pack_job_id)) continue;
      const summary = packsMap.get(report.vto_pack_job_id)!;
      summary.total_jobs++;
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
      }
    }

    return Array.from(packsMap.values()).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
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

  const handleRetryAllFailed = async (pack: PackSummary) => {
    if (!session?.user) return;
    setIsRetrying(pack.pack_id);
    const toastId = showLoading(`Re-queueing ${pack.failed_jobs} failed jobs...`);
    try {
        const { data, error } = await supabase.functions.invoke('MIRA-AGENT-tool-retry-all-failed-in-pack', {
            body: { pack_id: pack.pack_id, user_id: session.user.id }
        });
        if (error) throw error;
        dismissToast(toastId);
        showSuccess(data.message);
        queryClient.invalidateQueries({ queryKey: ['vtoPackSummaries', session.user.id] });
    } catch (err: any) {
        dismissToast(toastId);
        showError(`Operation failed: ${err.message}`);
    } finally {
        setIsRetrying(null);
    }
  };

  const handleDeleteAnalysis = async (pack: PackSummary) => {
    if (!session?.user) return;
    setIsDeleting(pack.pack_id);
    const toastId = showLoading("Deleting analysis report...");
    try {
        const { error } = await supabase.rpc('MIRA-AGENT-admin-reset-vto-pack-analysis', {
            p_pack_id: pack.pack_id,
            p_user_id: session.user.id
        });
        if (error) throw error;
        dismissToast(toastId);
        showSuccess(`Analysis for "${pack.metadata?.name || pack.pack_id}" has been reset.`);
        queryClient.invalidateQueries({ queryKey: ['vtoQaReportsAndPacks', session.user.id] });
    } catch (err: any) {
        dismissToast(toastId);
        showError(`Failed to delete analysis: ${err.message}`);
    } finally {
        setIsDeleting(null);
    }
  };

  if (isLoading) {
    return <div className="p-8 space-y-4"><Skeleton className="h-32 w-full" /><Skeleton className="h-32 w-full" /></div>;
  }

  if (error) {
    return <div className="p-8"><Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Error</AlertTitle><AlertDescription>{error.message}</AlertDescription></Alert></div>;
  }

  if (packSummaries.length === 0) {
    return (
      <div className="p-4 md:p-8 h-screen overflow-y-auto">
        <header className="pb-4 mb-8 border-b">
          <h1 className="text-3xl font-bold">{t('vtoAnalysisReports')}</h1>
          <p className="text-muted-foreground">{t('vtoAnalysisReportsDescription')}</p>
        </header>
        <div className="text-center py-16">
          <h2 className="mt-4 text-xl font-semibold">{t('noReportsGenerated')}</h2>
          <p className="mt-2 text-muted-foreground">{t('noReportsGeneratedDescription')}</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="p-4 md:p-8 h-screen overflow-y-auto">
        <header className="pb-4 mb-8 border-b">
          <h1 className="text-3xl font-bold">{t('vtoAnalysisReports')}</h1>
          <p className="text-muted-foreground">{t('vtoAnalysisReportsDescription')}</p>
        </header>
        <div className="space-y-4">
          <Accordion type="single" collapsible className="w-full space-y-4" onValueChange={setOpenPackId}>
            {packSummaries.map(report => {
              const totalReports = report.passed_perfect + report.passed_pose_change + report.passed_logo_issue + report.passed_detail_issue + report.failed_jobs;
              const isReportReady = totalReports > 0;
              const isRefinementPack = !!report.metadata?.refinement_of_pack_id;

              return (
                <AccordionItem key={report.pack_id} value={report.pack_id} className="border rounded-md">
                  <div className="flex items-center p-4">
                    <AccordionTrigger className="flex-1 text-left p-0 hover:no-underline">
                      <div className="text-left">
                        <p className="font-semibold flex items-center gap-2">
                          {isRefinementPack && <Wand2 className="h-5 w-5 text-purple-500" />}
                          <span>{report.metadata?.name || `Pack from ${new Date(report.created_at).toLocaleString()}`}</span>
                        </p>
                        <div className="flex items-center gap-2 mt-2">
                          <Progress value={(report.completed_jobs / (report.metadata?.total_pairs || report.total_jobs || 1)) * 100} className="h-2 w-32" />
                          <p className="text-sm text-muted-foreground">
                            {report.completed_jobs} / {report.metadata?.total_pairs || report.total_jobs} completed
                          </p>
                        </div>
                      </div>
                    </AccordionTrigger>
                    <div className="flex items-center gap-2 pl-4">
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10" disabled={!isReportReady}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>{t('deleteReportConfirmTitle')}</AlertDialogTitle>
                            <AlertDialogDescription>{t('deleteReportConfirmDescription')}</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleDeleteAnalysis(report)} disabled={isDeleting === report.pack_id}>
                              {isDeleting === report.pack_id && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                              {t('deleteReportConfirmAction')}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                      {report.failed_jobs > 0 && (
                        <Button variant="destructive" size="sm" onClick={() => handleRetryAllFailed(report)} disabled={isRetrying === report.pack_id}>
                          {isRetrying === report.pack_id ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                          Retry All Failed ({report.failed_jobs})
                        </Button>
                      )}
                      <Button variant="outline" size="sm" onClick={() => setPackToDownload(report)}>
                        <HardDriveDownload className="h-4 w-4 mr-2" />
                        {t('downloadPack')}
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setPackToAnalyze(report)} disabled={isAnalyzing === report.pack_id}>
                        {isAnalyzing === report.pack_id ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <BarChart2 className="h-4 w-4 mr-2" />}
                        {t('analyzePack')}
                      </Button>
                      {!isRefinementPack && (
                        <Button variant="secondary" size="sm" onClick={() => setPackToRefine(report)} disabled={isStartingRefinement === report.pack_id || report.completed_jobs === 0}>
                          {isStartingRefinement === report.pack_id ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Wand2 className="h-4 w-4 mr-2" />}
                          {t('refinePack')}
                        </Button>
                      )}
                      <Link to={`/vto-reports/${report.pack_id}`} onClick={(e) => !isReportReady && e.preventDefault()}>
                        <Button disabled={!isReportReady}>{t('viewReport')}</Button>
                      </Link>
                    </div>
                  </div>
                  <AccordionContent className="p-4 pt-0">
                    <VtoPackDetailView packId={report.pack_id} isOpen={openPackId === report.pack_id} />
                  </AccordionContent>
                </AccordionItem>
              )
            })}
          </Accordion>
        </div>
      </div>
      <AnalyzePackModal isOpen={!!packToAnalyze} onClose={() => setPackToAnalyze(null)} onAnalyze={handleAnalyze} isLoading={!!isAnalyzing} packName={packToAnalyze?.metadata?.name || ''} />
      <DownloadPackModal isOpen={!!packToDownload} onClose={() => setPackToDownload(null)} pack={packToDownload} />
      <RefinePackModal isOpen={!!packToRefine} onClose={() => setPackToRefine(null)} onRefine={handleStartRefinement} isLoading={!!isStartingRefinement} packName={packToRefine?.metadata?.name || ''} />
    </>
  );
};

export default VtoReports;