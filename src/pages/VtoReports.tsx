import { useMemo, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import { BarChart2, CheckCircle, XCircle, Loader2, AlertTriangle, UserCheck2, BadgeAlert, FileText, RefreshCw, Shirt, User, Wand2 } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { RealtimeChannel } from "@supabase/supabase-js";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { showError, showLoading, dismissToast, showSuccess } from "@/utils/toast";

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
  const [isAnalyzing, setIsAnalyzing] = useState<string | null>(null);
  const [isRerunning, setIsRerunning] = useState<string | null>(null);
  const [isStartingRefinement, setIsStartingRefinement] = useState<string | null>(null);

  const { data: reports, isLoading, error } = useQuery<any[]>({ // Using any for now to accommodate packs table
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
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [session?.user?.id, supabase, queryClient]);

  const packSummaries = useMemo((): PackSummary[] => {
    if (!reports?.packs) return [];
    const packsMap = new Map<string, PackSummary>();

    // Initialize all packs from the packs table
    for (const pack of reports.packs) {
        packsMap.set(pack.id, {
            pack_id: pack.id,
            created_at: pack.created_at,
            metadata: pack.metadata || {},
            total_jobs: 0, passed_perfect: 0, passed_pose_change: 0, passed_logo_issue: 0, passed_detail_issue: 0,
            failed_jobs: 0, failure_summary: {}, shape_mismatches: 0, avg_body_preservation_score: null, has_refinement_pass: false,
        });
    }

    // Populate with report data
    for (const report of reports.reports) {
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
    // Second pass to determine if a refinement pass exists for each pack
    allPacks.forEach(pack => {
        pack.has_refinement_pass = allPacks.some(p => p.metadata?.refinement_of_pack_id === pack.pack_id);
    });

    return allPacks.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [reports]);

  const handleResetAndAnalyze = async (packId: string) => {
    if (!session?.user) return;
    setIsAnalyzing(packId);
    const toastId = showLoading("Resetting previous analysis...");
    try {
      const { data: resetData, error: resetError } = await supabase.rpc('MIRA-AGENT-admin-reset-vto-pack-analysis', {
        p_pack_id: packId,
        p_user_id: session.user.id
      });
      if (resetError) throw resetError;
      
      dismissToast(toastId);
      showSuccess(`Reset ${resetData} old reports. Starting new analysis...`);
      
      const { data: orchestratorData, error: orchestratorError } = await supabase.functions.invoke('MIRA-AGENT-orchestrator-vto-reporter', {
        body: { pack_id: packId, user_id: session.user.id }
      });
      if (orchestratorError) throw orchestratorError;

      showSuccess(orchestratorData.message);
      queryClient.invalidateQueries({ queryKey: ['vtoQaReportsAndPacks', session.user.id] });

    } catch (err: any) {
      dismissToast(toastId);
      showError(`Operation failed: ${err.message}`);
    } finally {
      setIsAnalyzing(null);
    }
  };

  const handleRerunFailed = async (packId: string) => {
    if (!session?.user) return;
    setIsRerunning(packId);
    const toastId = showLoading("Re-queuing failed analysis jobs...");
    try {
        const { data, error } = await supabase.functions.invoke('MIRA-AGENT-tool-rerun-failed-analyses', {
            body: { pack_id: packId, user_id: session.user.id }
        });
        if (error) throw error;
        dismissToast(toastId);
        showSuccess(data.message);
        queryClient.invalidateQueries({ queryKey: ['vtoQaReportsAndPacks', session.user.id] });
    } catch (err: any) {
        dismissToast(toastId);
        showError(`Operation failed: ${err.message}`);
    } finally {
        setIsRerunning(null);
    }
  };

  const handleStartRefinementPass = async (packId: string) => {
    if (!session?.user) return;
    setIsStartingRefinement(packId);
    const toastId = showLoading("Starting refinement pass...");
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
      showError(`Failed to start refinement pass: ${err.message}`);
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

  return (
    <div className="p-4 md:p-8 h-screen overflow-y-auto">
      <header className="pb-4 mb-8 border-b">
        <h1 className="text-3xl font-bold">{t('vtoAnalysisReports')}</h1>
        <p className="text-muted-foreground">{t('vtoAnalysisReportsDescription')}</p>
      </header>
      <div className="space-y-4">
        {packSummaries.map(report => {
          const unknownFailures = report.failure_summary['Unknown'] || 0;
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
                    {!isRefinementPack && (
                      <Button variant="secondary" size="sm" onClick={() => handleStartRefinementPass(report.pack_id)} disabled={isStartingRefinement === report.pack_id || report.has_refinement_pass}>
                        {isStartingRefinement === report.pack_id ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Wand2 className="h-4 w-4 mr-2" />}
                        Start Refinement Pass
                      </Button>
                    )}
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="secondary" size="sm" disabled={unknownFailures === 0 || isRerunning === report.pack_id}>
                          {isRerunning === report.pack_id ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                          {t('rerunUnknownFailures', { count: unknownFailures })}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>{t('rerunFailedAnalysesTitle')}</AlertDialogTitle>
                          <AlertDialogDescription>
                            {t('rerunFailedAnalysesDescription', { count: unknownFailures })}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                          <AlertDialogAction onClick={() => handleRerunFailed(report.pack_id)}>
                            {t('rerunFailedAnalysesAction')}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="outline" size="sm" disabled={isAnalyzing === report.pack_id}>
                          {isAnalyzing === report.pack_id ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <BarChart2 className="h-4 w-4 mr-2" />}
                          Re-analyze Pack
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Reset and Re-analyze?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will permanently delete all existing QA reports for this pack and generate new ones from scratch. This is useful if the analysis logic has been updated. This action cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => handleResetAndAnalyze(report.pack_id)}>
                            Yes, Reset & Re-analyze
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                    <Link to={`/vto-reports/${report.pack_id}`}>
                      <Button>{t('viewReport')}</Button>
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
                      <User className="h-5 w-5" />
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
  );
};

export default VtoReports;