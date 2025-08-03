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
    <div className="p-4 md:p-8 h-screen overflow-y-auto">
      <header className="pb-4 mb-8 border-b">
        <h1 className="text-3xl font-bold">{t('vtoAnalysisReports')}</h1>
        <p className="text-muted-foreground">{t('vtoAnalysisReportsDescription')}</p>
      </header>
      <div className="space-y-4">
        {packSummaries.map(report => (
          <Card key={report.pack_id}>
            <CardHeader>
              <CardTitle className="flex justify-between items-center">
                <span>{report.metadata?.name || `Pack from ${new Date(report.created_at).toLocaleString()}`}</span>
                <Link to={`/vto-reports/${report.pack_id}`}>
                  <Button>{t('viewReport')}</Button>
                </Link>
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
        ))}
      </div>
    </div>
  );
};

export default VtoReports;