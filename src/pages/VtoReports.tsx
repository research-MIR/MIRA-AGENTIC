import { useMemo, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Progress } from "@/components/ui/progress";
import { BarChart2, CheckCircle, XCircle, Loader2, AlertTriangle, UserCheck2, BadgeAlert, FileText, RefreshCw, Wand2, Download, HardDriveDownload, Shirt, ArrowLeft, ImageIcon } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { RealtimeChannel } from "@supabase/supabase-js";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { showError, showLoading, dismissToast, showSuccess } from "@/utils/toast";
import JSZip from 'jszip';
import { VtoPackDetailView } from '@/components/VTO/VtoPackDetailView';
import { AnalyzePackModal, AnalysisScope } from '@/components/VTO/AnalyzePackModal';

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

export const RecentVtoPacks = () => {
  const { t } = useLanguage();
  const { supabase, session } = useSession();
  const queryClient = useQueryClient();
  const [openPackId, setOpenPackId] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState<string | null>(null);
  const [packToAnalyze, setPackToAnalyze] = useState<PackSummary | null>(null);
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
        .select('id, vto_pack_job_id, status')
        .eq('user_id', session.user.id)
        .not('vto_pack_job_id', 'is', null);
      if (jobsError) throw jobsError;

      return { reports, packs, jobs };
    },
    enabled: !!session?.user,
  });

  useEffect(() => {
    if (!session?.user?.id) return;
    const channel: RealtimeChannel = supabase
      .channel(`vto-qa-reports-tracker-recent-packs-${session.user.id}`)
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
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [session?.user?.id, supabase, queryClient]);

  const packSummaries = useMemo((): PackSummary[] => {
    if (!queryData?.packs || !queryData?.jobs) return [];
    const packsMap = new Map<string, PackSummary>();

    for (const pack of queryData.packs) {
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

    for (const job of queryData.jobs) {
        if (job.vto_pack_job_id && packsMap.has(job.vto_pack_job_id)) {
            const summary = packsMap.get(job.vto_pack_job_id)!;
            summary.total_jobs++;
            if (job.status === 'complete' || job.status === 'done' || job.status === 'failed' || job.status === 'permanently_failed') {
                summary.completed_jobs++;
            }
        }
    }

    for (const report of queryData.reports || []) {
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
      }
    }

    const allPacks = Array.from(packsMap.values());
    allPacks.forEach(pack => {
        pack.has_refinement_pass = allPacks.some(p => p.metadata?.refinement_of_pack_id === pack.pack_id);
    });

    return allPacks.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [queryData]);

  const handleAnalyzePack = async (scope: AnalysisScope) => {
    if (!packToAnalyze || !session?.user) return;
    setIsAnalyzing(packToAnalyze.pack_id);
    const toastId = showLoading("Starting analysis...");
    try {
      const { data, error } = await supabase.functions.invoke('MIRA-AGENT-orchestrator-vto-reporter', {
        body: { 
          pack_id: packToAnalyze.pack_id, 
          user_id: session.user.id,
          analysis_scope: scope
        }
      });
      if (error) throw error;
      dismissToast(toastId);
      showSuccess(data.message);
      queryClient.invalidateQueries({ queryKey: ['vtoQaReportsAndPacks', session.user.id] });
    } catch (err: any) {
      dismissToast(toastId);
      showError(`Analysis failed: ${err.message}`);
    } finally {
      setIsAnalyzing(null);
      setPackToAnalyze(null);
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
    return <div className="space-y-4"><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /></div>;
  }

  if (error) {
    return <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Error</AlertTitle><AlertDescription>{error.message}</AlertDescription></Alert>;
  }

  if (!queryData?.packs || queryData.packs.length === 0) {
    return <p className="text-center text-muted-foreground py-8">No recent batch jobs found.</p>;
  }

  return (
    <>
      <Accordion type="single" collapsible className="w-full space-y-4" onValueChange={setOpenPackId}>
        {packSummaries.map(pack => {
          const isRefinementPack = !!pack.metadata?.refinement_of_pack_id;
          const hasRefinementPass = pack.has_refinement_pass;

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
                      <Progress value={(pack.completed_jobs / (pack.metadata?.total_pairs || 1)) * 100} className="h-2 w-32" />
                      <p className="text-sm text-muted-foreground">
                        {pack.completed_jobs} / {pack.metadata?.total_pairs || pack.total_jobs} completed
                      </p>
                    </div>
                  </div>
                </AccordionTrigger>
                <div className="flex items-center gap-2 pl-4">
                  {!isRefinementPack && (
                      hasRefinementPass ? (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="secondary" size="sm" disabled={isStartingRefinement === pack.pack_id} onClick={(e) => e.stopPropagation()}>
                              {isStartingRefinement === pack.pack_id ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                              Re-run Refinement Pass
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will permanently delete the existing refinement pass and all its associated images and jobs. A new refinement pass will then be created. This action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleStartRefinementPass(pack.pack_id)}>
                                Yes, Reset and Re-run
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      ) : (
                        <Button variant="secondary" size="sm" onClick={(e) => { e.stopPropagation(); handleStartRefinementPass(pack.pack_id); }} disabled={isStartingRefinement === pack.pack_id}>
                          {isStartingRefinement === pack.pack_id ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Wand2 className="h-4 w-4 mr-2" />}
                          Start Refinement Pass
                        </Button>
                      )
                    )}
                  <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); setPackToAnalyze(pack); }}>
                    {isAnalyzing === pack.pack_id ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <BarChart2 className="h-4 w-4 mr-2" />}
                    Analyze
                  </Button>
                  <Link to={`/vto-reports/${pack.pack_id}`} onClick={(e) => e.stopPropagation()}>
                    <Button variant="outline" size="sm">View Report</Button>
                  </Link>
                </div>
              </div>
              <AccordionContent className="p-4 pt-0">
                <VtoPackDetailView packId={pack.pack_id} isOpen={openPackId === pack.pack_id} />
              </AccordionContent>
            </AccordionItem>
          )
        })}
      </Accordion>
      <AnalyzePackModal
        isOpen={!!packToAnalyze}
        onClose={() => setPackToAnalyze(null)}
        onAnalyze={handleAnalyzePack}
        isLoading={isAnalyzing === packToAnalyze?.pack_id}
        packName={packToAnalyze?.metadata?.name || `Pack from ${new Date(packToAnalyze?.created_at || '').toLocaleString()}`}
      />
    </>
  );
};

export default VtoReports;