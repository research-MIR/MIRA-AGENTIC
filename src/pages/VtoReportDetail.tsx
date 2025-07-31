import { useParams, Link } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, AlertTriangle, Loader2, BrainCircuit, BarChart2, CheckCircle, XCircle, ImageIcon, RefreshCw } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { SecureImageDisplay } from "@/components/VTO/SecureImageDisplay";
import { useEffect, useState, useMemo } from "react";
import { RealtimeChannel } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { showError, showLoading, dismissToast, showSuccess } from "@/utils/toast";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { useSecureImage } from "@/hooks/useSecureImage";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

interface ReportDetail {
  report_id: string;
  job_id: string;
  status: string;
  comparative_report: {
    thinking?: string;
    overall_pass: boolean;
    pass_with_notes: boolean;
    pass_notes_category: string | null;
    confidence_score: number;
    failure_category: string | null;
    mismatch_reason: string | null;
    garment_analysis: any;
    garment_comparison: any;
    pose_and_body_analysis: any;
    quality_analysis: any;
  } | null;
  source_person_image_url: string;
  source_garment_image_url: string;
  final_image_url: string;
}

interface PackData {
  id: string;
  synthesis_report: string | null;
  synthesis_thinking: string | null;
}

const ScoreIndicator = ({ score, label }: { score: number, label: string }) => (
  <div>
    <div className="flex justify-between items-center mb-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="text-xs font-bold">{score?.toFixed(1) || 'N/A'}/10</span>
    </div>
    <Progress value={score ? score * 10 : 0} className="h-2" />
  </div>
);

const BooleanIndicator = ({ value, label }: { value: boolean, label: string }) => (
  <div className="flex items-center justify-between text-xs p-2 bg-muted rounded-md">
    <span className="font-medium">{label}</span>
    {value ? <CheckCircle className="h-4 w-4 text-green-500" /> : <XCircle className="h-4 w-4 text-destructive" />}
  </div>
);

const ImageCard = ({ title, url }: { title: string, url?: string }) => {
  const { displayUrl, isLoading, error } = useSecureImage(url);
  return (
    <div className="space-y-1">
      <h3 className="text-sm font-semibold text-center text-muted-foreground">{title}</h3>
      <div className="aspect-square bg-muted rounded-md flex items-center justify-center overflow-hidden">
        {!url ? <p className="text-xs text-muted-foreground">Not available</p> :
         isLoading ? <Loader2 className="h-8 w-8 animate-spin" /> :
         error ? <AlertTriangle className="h-8 w-8 text-destructive" /> :
         displayUrl ? <img src={displayUrl} alt={title} className="max-w-full max-h-full object-contain" /> : null
        }
      </div>
    </div>
  );
};

const ReportDetailModal = ({ report, isOpen, onClose }: { report: ReportDetail | null, isOpen: boolean, onClose: () => void }) => {
  if (!isOpen || !report) return null;

  const reportData = report.comparative_report;
  const confidenceScore = reportData?.confidence_score || 0;
  const normalizedConfidence = confidenceScore > 1 ? confidenceScore / 10 : confidenceScore;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-[90vw] w-full h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Forensic Analysis Report</DialogTitle>
          <DialogDescription>Job ID: {report.job_id}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 py-4 flex-1 overflow-hidden">
          <div className="lg:col-span-1 space-y-4 flex flex-col">
            <ImageCard title="Source Person" url={report.source_person_image_url} />
            <ImageCard title="Reference Garment" url={report.source_garment_image_url} />
          </div>
          
          <div className="lg:col-span-3 h-full overflow-hidden">
            <ScrollArea className="h-full pr-4">
              {reportData ? (
                <div className="space-y-4">
                  <Card>
                    <CardHeader><CardTitle className="text-base">Overall Assessment</CardTitle></CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      <BooleanIndicator value={reportData.overall_pass} label="Overall Pass" />
                      {reportData.pass_with_notes && <p><strong>Note:</strong> <Badge variant="secondary">{reportData.pass_notes_category?.replace(/_/g, ' ')}</Badge></p>}
                      <p><strong>Confidence:</strong> {(normalizedConfidence * 100).toFixed(0)}%</p>
                      {reportData.failure_category && <p><strong>Failure Category:</strong> <Badge variant="destructive">{reportData.failure_category.replace(/_/g, ' ')}</Badge></p>}
                    </CardContent>
                  </Card>
                  <Accordion type="multiple" defaultValue={['garment', 'pose', 'quality']}>
                    <AccordionItem value="garment">
                      <AccordionTrigger>Garment Comparison</AccordionTrigger>
                      <AccordionContent className="space-y-3">
                        <div className="grid grid-cols-2 gap-4">
                          <ScoreIndicator score={reportData.garment_comparison?.scores?.color_fidelity} label="Color Fidelity" />
                          <ScoreIndicator score={reportData.garment_comparison?.scores?.texture_realism} label="Texture Realism" />
                          <ScoreIndicator score={reportData.garment_comparison?.scores?.pattern_accuracy} label="Pattern Accuracy" />
                          <ScoreIndicator score={reportData.garment_comparison?.scores?.fit_and_shape} label="Fit & Shape" />
                          <ScoreIndicator score={reportData.garment_comparison?.scores?.logo_fidelity} label="Logo Fidelity" />
                          <ScoreIndicator score={reportData.garment_comparison?.scores?.detail_accuracy} label="Detail Accuracy" />
                        </div>
                        <p className="text-xs italic text-muted-foreground pt-2 border-t border-border/50"><strong>Inspector Notes:</strong> {reportData.garment_comparison?.notes}</p>
                      </AccordionContent>
                    </AccordionItem>
                    <AccordionItem value="pose">
                      <AccordionTrigger>Pose & Body Analysis</AccordionTrigger>
                      <AccordionContent className="space-y-3">
                        <div className="grid grid-cols-2 gap-4">
                          <ScoreIndicator score={reportData.pose_and_body_analysis?.scores?.pose_preservation} label="Pose Preservation" />
                          <ScoreIndicator score={reportData.pose_and_body_analysis?.scores?.anatomical_correctness} label="Anatomical Correctness" />
                        </div>
                        <BooleanIndicator value={!reportData.pose_and_body_analysis?.pose_changed} label="Pose Maintained" />
                        <p className="text-xs italic text-muted-foreground"><strong>Inspector Notes:</strong> {reportData.pose_and_body_analysis?.notes}</p>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No detailed report data available.</p>
              )}
            </ScrollArea>
          </div>

          <div className="lg:col-span-1 flex flex-col space-y-1">
            <h3 className="text-sm font-semibold text-center text-muted-foreground">Final Result</h3>
            <div className="flex-1 bg-muted rounded-md flex items-center justify-center overflow-hidden">
              <SecureImageDisplay imageUrl={report.final_image_url} alt="Final Result" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const VtoReportDetail = () => {
  const { packId } = useParams();
  const { t } = useLanguage();
  const { supabase, session } = useSession();
  const queryClient = useQueryClient();
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [selectedReport, setSelectedReport] = useState<ReportDetail | null>(null);
  const [isRerunning, setIsRerunning] = useState<string | null>(null);

  const { data: packData, isLoading: isLoadingPack } = useQuery<PackData | null>({
    queryKey: ['vtoPackData', packId],
    queryFn: async () => {
      if (!packId) return null;
      const { data, error } = await supabase.from('mira-agent-vto-packs-jobs').select('id, synthesis_report, synthesis_thinking').eq('id', packId).single();
      if (error) throw error;
      return data;
    },
    enabled: !!packId,
  });

  const { data: reportDetails, isLoading: isLoadingReports, error } = useQuery<ReportDetail[]>({
    queryKey: ['vtoReportDetail', packId],
    queryFn: async () => {
      if (!packId) return [];
      const { data, error } = await supabase.rpc('get_vto_report_details_for_pack', {
        p_pack_id: packId,
      });
      if (error) throw error;
      return data;
    },
    enabled: !!packId,
  });

  useEffect(() => {
    if (!packId || !session?.user?.id) return;
    const channel: RealtimeChannel = supabase
      .channel(`vto-report-detail-tracker-${packId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'mira-agent-vto-qa-reports', filter: `vto_pack_job_id=eq.${packId}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ['vtoReportDetail', packId] });
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'mira-agent-vto-packs-jobs', filter: `id=eq.${packId}` },
        (payload) => {
          queryClient.setQueryData(['vtoPackData', packId], payload.new);
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [packId, session?.user?.id, supabase, queryClient]);

  const unknownFailures = useMemo(() => {
    if (!reportDetails) return [];
    return reportDetails.filter(j => j.comparative_report && !j.comparative_report.overall_pass && (j.comparative_report.failure_category === 'Unknown' || !j.comparative_report.failure_category));
  }, [reportDetails]);

  const handleGenerateAnalysis = async () => {
    if (!packId || !session?.user) return;
    setIsAnalyzing(true);
    const toastId = showLoading("Starting analysis...");
    try {
      const { data, error } = await supabase.functions.invoke('MIRA-AGENT-orchestrator-vto-report-synthesis', {
        body: { pack_id: packId, user_id: session.user.id }
      });
      if (error) throw error;
      dismissToast(toastId);
      showSuccess(data.message);
    } catch (err: any) {
      dismissToast(toastId);
      showError(`Analysis failed: ${err.message}`);
    } finally {
      setIsAnalyzing(false);
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
        queryClient.invalidateQueries({ queryKey: ['vtoReportDetail', packId] });
    } catch (err: any) {
        dismissToast(toastId);
        showError(`Operation failed: ${err.message}`);
    } finally {
        setIsRerunning(null);
    }
  };

  const passedJobs = reportDetails?.filter(j => j.comparative_report?.overall_pass) || [];
  const failedJobs = reportDetails?.filter(j => !j.comparative_report?.overall_pass) || [];

  const renderJobGrid = (jobs: ReportDetail[]) => (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
      {jobs.map(job => (
        <Card 
          key={job.job_id} 
          className="relative group cursor-pointer aspect-square"
          onClick={() => setSelectedReport(job)}
        >
          <SecureImageDisplay imageUrl={job.final_image_url} alt={`Job ${job.job_id}`} className="w-full h-full object-cover rounded-md" />
          <Badge variant={job.comparative_report?.overall_pass ? 'default' : 'destructive'} className="absolute top-2 right-2">
            {job.comparative_report?.overall_pass ? 'PASS' : 'FAIL'}
          </Badge>
        </Card>
      ))}
    </div>
  );

  const isLoading = isLoadingPack || isLoadingReports;
  const analysisInProgress = packData?.synthesis_report === 'Analysis in progress...';

  if (isLoading) {
    return <div className="p-8"><Skeleton className="h-12 w-1/3" /><div className="grid grid-cols-6 gap-4 mt-8">{[...Array(12)].map((_, i) => <Skeleton key={i} className="h-40 w-full" />)}</div></div>;
  }

  if (error) {
    return <div className="p-8"><Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Error</AlertTitle><AlertDescription>{error.message}</AlertDescription></Alert></div>;
  }

  return (
    <>
      <div className="p-4 md:p-8 h-screen flex flex-col">
        <header className="pb-4 mb-4 border-b shrink-0">
          <Link to="/vto-reports" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-2">
            <ArrowLeft className="h-4 w-4" />
            Back to All Reports
          </Link>
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold">{t('vtoReportDetailTitle')}</h1>
              <p className="text-muted-foreground">Pack ID: {packId}</p>
            </div>
            <div className="flex items-center gap-2">
              {unknownFailures.length > 0 && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="secondary" size="sm" disabled={isRerunning === packId}>
                      {isRerunning === packId ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                      {t('rerunUnknownFailures', { count: unknownFailures.length })}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{t('rerunFailedAnalysesTitle')}</AlertDialogTitle>
                      <AlertDialogDescription>
                        {t('rerunFailedAnalysesDescription', { count: unknownFailures.length })}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                      <AlertDialogAction onClick={() => handleRerunFailed(packId!)}>
                        {t('rerunFailedAnalysesAction')}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
              <Button onClick={handleGenerateAnalysis} disabled={isAnalyzing || analysisInProgress}>
                {(isAnalyzing || analysisInProgress) ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <BarChart2 className="mr-2 h-4 w-4" />}
                {analysisInProgress ? "Analyzing..." : packData?.synthesis_report ? "Re-generate Analysis" : "Generate Strategic Analysis"}
              </Button>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          {(isAnalyzing || analysisInProgress) && <div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin" /></div>}
          
          {packData?.synthesis_report && !analysisInProgress && (
            <Card className="mb-8">
              <CardContent className="p-6">
                <div className="markdown-content">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{packData.synthesis_report}</ReactMarkdown>
                </div>
                {packData.synthesis_thinking && (
                  <Accordion type="single" collapsible className="w-full mt-4">
                    <AccordionItem value="item-1">
                      <AccordionTrigger>
                        <div className="flex items-center gap-2 text-sm font-semibold">
                          <BrainCircuit className="h-4 w-4" />
                          View AI's Thought Process
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="markdown-content p-4 bg-muted rounded-md mt-2 text-sm">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{packData.synthesis_thinking}</ReactMarkdown>
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                )}
              </CardContent>
            </Card>
          )}

          <Tabs defaultValue="all" className="w-full">
            <TabsList>
              <TabsTrigger value="all">{t('allJobs')} ({reportDetails?.length || 0})</TabsTrigger>
              <TabsTrigger value="passed">{t('passedJobs')} ({passedJobs.length})</TabsTrigger>
              <TabsTrigger value="failed">{t('failedJobs')} ({failedJobs.length})</TabsTrigger>
            </TabsList>
            <TabsContent value="all" className="mt-4">
              {renderJobGrid(reportDetails || [])}
            </TabsContent>
            <TabsContent value="passed" className="mt-4">
              {renderJobGrid(passedJobs)}
            </TabsContent>
            <TabsContent value="failed" className="mt-4">
              {renderJobGrid(failedJobs)}
            </TabsContent>
          </Tabs>
        </div>
      </div>
      <ReportDetailModal isOpen={!!selectedReport} onClose={() => setSelectedReport(null)} report={selectedReport} />
    </>
  );
};

export default VtoReportDetail;