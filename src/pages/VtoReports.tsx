import { useMemo, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import { BarChart, CheckCircle, XCircle, Loader2, AlertTriangle, UserCheck2 } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { RealtimeChannel } from "@supabase/supabase-js";

interface QaReport {
  id: string;
  vto_pack_job_id: string;
  created_at: string;
  comparative_report: {
    overall_pass: boolean;
    failure_category: string | null;
    pose_and_body_analysis?: {
        pose_changed: boolean;
    }
  } | null;
}

interface PackSummary {
  pack_id: string;
  created_at: string;
  total_jobs: number;
  passed_jobs: number;
  passed_with_pose_change: number;
  failed_jobs: number;
  failure_summary: Record<string, number>;
}

const VtoReports = () => {
  const { t } = useLanguage();
  const { supabase, session } = useSession();
  const queryClient = useQueryClient();

  const { data: reports, isLoading, error } = useQuery<QaReport[]>({
    queryKey: ['vtoQaReports', session?.user?.id],
    queryFn: async () => {
      if (!session?.user) return [];
      const { data, error } = await supabase.rpc('get_vto_qa_reports_for_user', { p_user_id: session.user.id });
      if (error) throw error;
      return data;
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
          queryClient.invalidateQueries({ queryKey: ['vtoQaReports', session.user.id] });
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [session?.user?.id, supabase, queryClient]);

  const packSummaries = useMemo((): PackSummary[] => {
    if (!reports) return [];
    const packs = new Map<string, PackSummary>();
    for (const report of reports) {
      if (!packs.has(report.vto_pack_job_id)) {
        packs.set(report.vto_pack_job_id, {
          pack_id: report.vto_pack_job_id,
          created_at: report.created_at,
          total_jobs: 0,
          passed_jobs: 0,
          passed_with_pose_change: 0,
          failed_jobs: 0,
          failure_summary: {},
        });
      }
      const summary = packs.get(report.vto_pack_job_id)!;
      summary.total_jobs++;
      if (report.comparative_report?.overall_pass) {
        if (report.comparative_report.pose_and_body_analysis?.pose_changed) {
            summary.passed_with_pose_change++;
        } else {
            summary.passed_jobs++;
        }
      } else {
        summary.failed_jobs++;
        const reason = report.comparative_report?.failure_category || "Unknown";
        summary.failure_summary[reason] = (summary.failure_summary[reason] || 0) + 1;
      }
    }
    return Array.from(packs.values()).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [reports]);

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
          return (
            <Card key={report.pack_id}>
              <CardHeader>
                <CardTitle className="flex justify-between items-center">
                  <span>Pack from {new Date(report.created_at).toLocaleString()}</span>
                  <Link to={`/vto-reports/${report.pack_id}`}>
                    <Button variant="outline">{t('viewReport')}</Button>
                  </Link>
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <h3 className="font-semibold text-sm">{t('overallPassRate')}</h3>
                  <div className="flex items-center gap-4 flex-wrap">
                    <div className="flex items-center gap-2 text-green-600">
                      <CheckCircle className="h-5 w-5" />
                      <span className="text-2xl font-bold">{report.passed_jobs}</span>
                      <span>Passed</span>
                    </div>
                    <div className="flex items-center gap-2 text-yellow-500">
                      <UserCheck2 className="h-5 w-5" />
                      <span className="text-2xl font-bold">{report.passed_with_pose_change}</span>
                      <span>Passed (Pose Change)</span>
                    </div>
                    <div className="flex items-center gap-2 text-destructive">
                      <XCircle className="h-5 w-5" />
                      <span className="text-2xl font-bold">{report.failed_jobs}</span>
                      <span>Failed</span>
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  <h3 className="font-semibold text-sm">{t('failureReasons')}</h3>
                  {Object.keys(report.failure_summary).length > 0 ? (
                    <div className="text-xs text-muted-foreground space-y-1">
                      {Object.entries(report.failure_summary).map(([reason, count]) => (
                        <div key={reason} className="flex justify-between">
                          <span>{reason}</span>
                          <span>{count}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="h-24 bg-muted rounded-md flex items-center justify-center text-muted-foreground">
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