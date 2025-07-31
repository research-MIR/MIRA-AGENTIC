import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Progress } from "@/components/ui/progress";
import { BarChart2, CheckCircle, XCircle, Loader2, AlertTriangle, UserCheck2, BadgeAlert, FileText, RefreshCw, Wand2, Shirt } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { RealtimeChannel } from "@supabase/supabase-js";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { showError, showLoading, dismissToast, showSuccess } from "@/utils/toast";
import { VtoPackDetailView } from './VtoPackDetailView';
import { AnalyzePackModal, AnalysisScope } from './AnalyzePackModal';

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
  failed_jobs: number;
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

  const { data: queryData, isLoading, error } = useQuery<any>({
    queryKey: ['vtoPackSummaries', session?.user?.id],
    queryFn: async () => {
      if (!session?.user) return { packs: [], jobs: [], batchPairJobs: [], reports: [] };
      
      const packsPromise = supabase.from('mira-agent-vto-packs-jobs').select('id, created_at, metadata').eq('user_id', session.user.id);
      const jobsPromise = supabase.from('mira-agent-bitstudio-jobs').select('id, vto_pack_job_id, status, batch_pair_job_id').eq('user_id', session.user.id).not('vto_pack_job_id', 'is', null);
      const batchPairJobsPromise = supabase.from('mira-agent-batch-inpaint-pair-jobs').select('id, metadata, status').eq('user_id', session.user.id).not('metadata->>vto_pack_job_id', 'is', null);
      const reportsPromise = supabase.rpc('get_vto_qa_reports_for_user', { p_user_id: session.user.id });

      const [{ data: packs, error: packsError }, { data: jobs, error: jobsError }, { data: batchPairJobs, error: batchPairError }, { data: reports, error: reportsError }] = await Promise.all([packsPromise, jobsPromise, batchPairJobsPromise, reportsPromise]);

      if (packsError) throw packsError;
      if (jobsError) throw jobsError;
      if (batchPairError) throw batchPairError;
      if (reportsError) throw reportsError;

      return { packs, jobs, batchPairJobs, reports };
    },
    enabled: !!session?.user,
  });

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
            passed_perfect: 0,
            failed_jobs: 0,
            has_refinement_pass: false,
        });
    }

    for (const pack of packs) {
        const summary = packsMap.get(pack.id)!;

        // Filter jobs specifically for the current pack
        const bitstudioJobsForPack = bitstudioJobs.filter((j: any) => j.vto_pack_job_id === pack.id);
        const batchPairJobsForPack = batchPairJobs.filter((j: any) => j.metadata?.vto_pack_job_id === pack.id);

        // Identify which pair jobs have already been processed into bitstudio jobs
        const processedPairJobIdsForPack = new Set(bitstudioJobsForPack.map((j: any) => j.batch_pair_job_id).filter(Boolean));

        // Find the precursor jobs that are still in the batch_inpaint_pair_jobs table
        const precursorJobsForPack = batchPairJobsForPack
            .filter((job: any) => !processedPairJobIdsForPack.has(job.id));

        // Combine all jobs for this pack
        const allJobsForThisPack = [...bitstudioJobsForPack, ...precursorJobsForPack];

        summary.total_jobs = allJobsForThisPack.length;
        summary.completed_jobs = allJobsForThisPack.filter((j: any) => ['complete', 'done', 'failed', 'permanently_failed'].includes(j.status)).length;
    }

    for (const report of reports) {
      if (!packsMap.has(report.vto_pack_job_id)) continue;
      const summary = packsMap.get(report.vto_pack_job_id)!;
      const reportData = report.comparative_report;
      if (reportData) {
        if (reportData.overall_pass) {
          summary.passed_perfect++;
        } else {
          summary.failed_jobs++;
        }
      }
    }

    const allPacks = Array.from(packsMap.values());
    allPacks.forEach(pack => {
        pack.has_refinement_pass = allPacks.some(p => p.metadata?.refinement_of_pack_id === pack.pack_id);
    });

    return allPacks.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [queryData]);

  if (isLoading) {
    return <div className="space-y-4"><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /></div>;
  }

  if (error) {
    return <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Error</AlertTitle><AlertDescription>{error.message}</AlertDescription></Alert>;
  }

  if (packSummaries.length === 0) {
    return <p className="text-center text-muted-foreground py-8">No recent batch jobs found.</p>;
  }

  return (
    <Accordion type="single" collapsible className="w-full space-y-4" onValueChange={setOpenPackId}>
      {packSummaries.map(pack => (
        <AccordionItem key={pack.pack_id} value={pack.pack_id} className="border rounded-md">
          <div className="flex items-center p-4">
            <AccordionTrigger className="flex-1 text-left p-0 hover:no-underline">
              <div className="text-left">
                <p className="font-semibold flex items-center gap-2">
                  {pack.metadata?.refinement_of_pack_id && <Wand2 className="h-5 w-5 text-purple-500" />}
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
              <Link to={`/vto-reports/${pack.pack_id}`} onClick={(e) => e.stopPropagation()}>
                <Button variant="outline" size="sm">View Report</Button>
              </Link>
            </div>
          </div>
          <AccordionContent className="p-4 pt-0">
            <VtoPackDetailView packId={pack.pack_id} isOpen={openPackId === pack.pack_id} />
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
};