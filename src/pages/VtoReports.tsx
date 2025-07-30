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
  failed_jobs: number;
  in_progress_jobs: number;
  unique_garment_count: number;
  has_refinement_pass: boolean;
}

const Stat = ({ icon, value, label }: { icon: React.ReactNode, value: number, label: string }) => (
  <div className="flex items-center gap-1 text-xs text-muted-foreground">
    {icon}
    <span className="font-medium">{value}</span>
    <span>{label}</span>
  </div>
);

const VtoReports = () => {
  const { t } = useLanguage();
  const { supabase, session } = useSession();
  const queryClient = useQueryClient();
  const [openPackId, setOpenPackId] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState<string | null>(null);
  const [packToAnalyze, setPackToAnalyze] = useState<PackSummary | null>(null);
  const [isStartingRefinement, setIsStartingRefinement] = useState<string | null>(null);

  const { data: rawSummaries, isLoading, error } = useQuery<Omit<PackSummary, 'has_refinement_pass'>[]>({
    queryKey: ['vtoPackSummaries', session?.user?.id],
    queryFn: async () => {
      if (!session?.user) return [];
      const { data, error } = await supabase.rpc('get_vto_pack_summaries', { p_user_id: session.user.id });
      if (error) throw error;
      return data;
    },
    enabled: !!session?.user,
  });

  useEffect(() => {
    if (!session?.user?.id) return;
    const channel: RealtimeChannel = supabase
      .channel(`vto-qa-reports-tracker-recent-packs-${session.user.id}`)
      .on(
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
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [session?.user?.id, supabase, queryClient]);

  const packSummaries = useMemo((): PackSummary[] => {
    if (!rawSummaries) return [];
    return rawSummaries.map(summary => ({
        ...summary,
        has_refinement_pass: rawSummaries.some(p => p.metadata?.refinement_of_pack_id === summary.pack_id)
    }));
  }, [rawSummaries]);

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
      queryClient.invalidateQueries({ queryKey: ['vtoPackSummaries', session.user.id] });
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
      queryClient.invalidateQueries({ queryKey: ['vtoPackSummaries', session.user.id] });
    } catch (err: any) {
      dismissToast(toastId);
      showError(`Failed to start refinement pass: ${err.message}`);
    } finally {
      setIsStartingRefinement(null);
    }
  };

  if (isLoading) {
    return <div className="p-8 space-y-4"><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /></div>;
  }

  if (error) {
    return <div className="p-8"><Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Error</AlertTitle><AlertDescription>{error.message}</AlertDescription></Alert></div>;
  }

  if (!packSummaries || packSummaries.length === 0) {
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
                      <div className="flex items-center gap-4 mt-2">
                        <Stat icon={<ImageIcon className="h-3 w-3" />} value={pack.total_jobs} label="Images" />
                        <Stat icon={<Shirt className="h-3 w-3" />} value={pack.unique_garment_count} label="Garments" />
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
        </div>
      </div>
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