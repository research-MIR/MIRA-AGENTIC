import { useMemo, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from '@/components/Auth/SessionContextProvider';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { AlertTriangle, CheckCircle, Loader2, XCircle, Download, HardDriveDownload, BarChart2, RefreshCw, Wand2 } from 'lucide-react';
import { SecureImageDisplay } from './SecureImageDisplay';
import { BitStudioJob } from '@/types/vto';
import { RealtimeChannel } from '@supabase/supabase-js';
import { Button } from '../ui/button';
import { showError, showLoading, dismissToast, showSuccess } from '@/utils/toast';
import JSZip from 'jszip';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useVtoPackJobs } from '@/hooks/useVtoPackJobs';
import { VtoJobDetailModal } from './VtoJobDetailModal';
import { AnalyzePackModal, AnalysisScope } from './AnalyzePackModal';
import { Link } from 'react-router-dom';

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

const VtoPackDetailView = ({ packId, isOpen }: { packId: string, isOpen: boolean }) => {
  const { data: childJobs, isLoading } = useVtoPackJobs(packId, isOpen);
  const [selectedJob, setSelectedJob] = useState<BitStudioJob | null>(null);

  if (isLoading) {
    return <div className="flex justify-center p-4"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {childJobs?.map(job => {
          const isFailed = job.status === 'failed' || job.status === 'permanently_failed';
          const inProgressStatuses = ['processing', 'queued', 'segmenting', 'delegated', 'compositing', 'awaiting_fix', 'fixing', 'pending'];
          const isInProgress = inProgressStatuses.includes(job.status);
          const isComplete = job.status === 'complete' || job.status === 'done';

          return (
            <div 
              key={job.id} 
              className="w-32 h-32 relative group cursor-pointer"
              onClick={() => setSelectedJob(job)}
            >
              <SecureImageDisplay 
                imageUrl={job.final_image_url || job.source_person_image_url || null} 
                alt="Job result" 
                className="w-full h-full object-cover rounded-md"
              />
              {isComplete && <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity" />}
              {isFailed && (
                job.final_image_url ? (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="absolute inset-0 bg-yellow-500/70 flex items-center justify-center rounded-md">
                          <AlertTriangle className="h-8 w-8 text-white" />
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Job failed quality checks but produced an image.</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                ) : (
                  <div className="absolute inset-0 bg-destructive/70 flex items-center justify-center rounded-md">
                    <XCircle className="h-8 w-8 text-destructive-foreground" />
                  </div>
                )
              )}
              {isInProgress && <div className="absolute inset-0 bg-black/70 flex items-center justify-center rounded-md"><Loader2 className="h-8 w-8 animate-spin text-white" /></div>}
            </div>
          )
        })}
      </div>
      <VtoJobDetailModal 
        isOpen={!!selectedJob}
        onClose={() => setSelectedJob(null)}
        job={selectedJob}
      />
    </>
  );
};

export const RecentVtoPacks = () => {
  const { t } = useLanguage();
  const { supabase, session } = useSession();
  const queryClient = useQueryClient();
  const [openPackId, setOpenPackId] = useState<string | null>(null);
  const [isDownloadingResults, setIsDownloadingResults] = useState<string | null>(null);
  const [isDownloadingDebug, setIsDownloadingDebug] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState<string | null>(null);
  const [packToAnalyze, setPackToAnalyze] = useState<VtoPackSummary | null>(null);
  const [isRerunning, setIsRerunning] = useState<string | null>(null);
  const [isStartingRefinement, setIsStartingRefinement] = useState<string | null>(null);

  const { data: reports, isLoading: isLoadingPacks, error: packsError } = useQuery<any>({ // Using any for now to accommodate packs table
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

  const downloadFromSupabase = async (url: string | null): Promise<Blob | null> => {
    if (!url) return null;
    try {
        const urlObj = new URL(url);
        const pathSegments = urlObj.pathname.split('/');
        const objectSegmentIndex = pathSegments.indexOf('object');
        if (objectSegmentIndex === -1 || objectSegmentIndex + 2 >= pathSegments.length) {
            console.error(`Could not parse bucket from URL: ${url}`);
            return null;
        }
        const bucketName = pathSegments[objectSegmentIndex + 2];
        const pathStartIndex = urlObj.pathname.indexOf(bucketName) + bucketName.length + 1;
        const storagePath = decodeURIComponent(urlObj.pathname.substring(pathStartIndex));

        const { data, error } = await supabase.storage.from(bucketName).download(storagePath);
        if (error) {
            console.error(`Failed to download ${storagePath}:`, error);
            return null;
        }
        return data;
    } catch (e) {
        console.error(`Error in downloadFromSupabase for URL ${url}:`, e);
        return null;
    }
  };

  const handleDownloadResults = async (packId: string) => {
    setIsDownloadingResults(packId);
    const toastId = showLoading("Fetching job results...");
    try {
      const { data: jobs, error } = await supabase
        .from('mira-agent-bitstudio-jobs')
        .select('id, final_image_url')
        .eq('vto_pack_job_id', packId)
        .in('status', ['complete', 'done'])
        .not('final_image_url', 'is', null);
      if (error) throw error;

      if (jobs.length === 0) {
        dismissToast(toastId);
        showSuccess("No completed images to download for this pack.");
        return;
      }

      dismissToast(toastId);
      showLoading(`Downloading ${jobs.length} images...`);

      const zip = new JSZip();
      const imagePromises = jobs.map(async (job) => {
        const blob = await downloadFromSupabase(job.final_image_url);
        if (blob) {
          zip.file(`result_${job.id}.png`, blob);
        }
      });
      await Promise.all(imagePromises);

      dismissToast(toastId);
      showLoading("Zipping files...");

      const content = await zip.generateAsync({ type: "blob" });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(content);
      link.download = `results_pack_${packId}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);

      dismissToast(toastId);
      showSuccess("Download started!");
    } catch (err: any) {
      dismissToast(toastId);
      showError(`Download failed: ${err.message}`);
    } finally {
      setIsDownloadingResults(null);
    }
  };

  const handleDownloadDebugPack = async (packId: string) => {
    setIsDownloadingDebug(packId);
    const toastId = showLoading("Fetching all job assets...");
    try {
      const { data: jobs, error } = await supabase
        .from('mira-agent-bitstudio-jobs')
        .select('id, source_person_image_url, source_garment_image_url, final_image_url')
        .eq('vto_pack_job_id', packId);
      if (error) throw error;

      if (jobs.length === 0) {
        dismissToast(toastId);
        showSuccess("No jobs found in this pack.");
        return;
      }

      dismissToast(toastId);
      showLoading(`Processing ${jobs.length} jobs for debug pack...`);

      const zip = new JSZip();
      const individualAssetsFolder = zip.folder("individual_assets");
      const comparisonSheetsFolder = zip.folder("_comparison_sheets");

      const jobPromises = jobs.map(async (job) => {
        try {
          const [personBlob, garmentBlob, resultBlob] = await Promise.all([
            downloadFromSupabase(job.source_person_image_url),
            downloadFromSupabase(job.source_garment_image_url),
            downloadFromSupabase(job.final_image_url)
          ]);

          const jobFolder = individualAssetsFolder!.folder(job.id);
          if (personBlob) jobFolder!.file("source_person.png", personBlob);
          if (garmentBlob) jobFolder!.file("source_garment.png", garmentBlob);
          if (resultBlob) jobFolder!.file("final_result.png", resultBlob);

          // Create comparison sheet
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          if (!ctx) return;

          const personImg = personBlob ? await createImageBitmap(personBlob) : null;
          const garmentImg = garmentBlob ? await createImageBitmap(garmentBlob) : null;
          const resultImg = resultBlob ? await createImageBitmap(resultBlob) : null;

          const images = [personImg, garmentImg, resultImg];
          const maxWidth = Math.max(...images.map(img => img?.width || 0));
          const maxHeight = Math.max(...images.map(img => img?.height || 0));

          if (maxWidth === 0 || maxHeight === 0) {
            console.warn(`Skipping comparison sheet for job ${job.id} as no images could be loaded.`);
            return;
          }

          const padding = 40;
          const labelHeight = 60;
          const fontSize = 30;

          canvas.width = (maxWidth * 3) + (padding * 4);
          canvas.height = maxHeight + (padding * 2) + labelHeight;
          
          ctx.fillStyle = '#f0f0f0';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = '#333';
          ctx.font = `${fontSize}px sans-serif`;
          ctx.textAlign = 'center';

          const drawImageWithLabel = (img: ImageBitmap | null, slotIndex: number, label: string) => {
            const slotX = padding + (maxWidth + padding) * slotIndex;
            
            ctx.fillText(label, slotX + maxWidth / 2, padding + fontSize);
            
            const targetX = slotX;
            const targetY = padding + labelHeight;
            
            if (img) {
              const xOffset = (maxWidth - img.width) / 2;
              const yOffset = (maxHeight - img.height) / 2;
              ctx.drawImage(img, targetX + xOffset, targetY + yOffset);
            } else {
              ctx.fillStyle = '#ddd';
              ctx.fillRect(targetX, targetY, maxWidth, maxHeight);
            }
          };

          drawImageWithLabel(personImg, 0, "Source Person");
          drawImageWithLabel(garmentImg, 1, "Garment");
          drawImageWithLabel(resultImg, 2, "Final Result");

          const comparisonBlob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
          if (comparisonBlob) {
            comparisonSheetsFolder!.file(`${job.id}_comparison.png`, comparisonBlob);
          }
        } catch (e) {
          console.error(`Failed to process job ${job.id}:`, e);
        }
      });

      await Promise.all(jobPromises);

      dismissToast(toastId);
      showLoading("Zipping debug files...");

      const content = await zip.generateAsync({ type: "blob" });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(content);
      link.download = `debug_pack_${packId}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);

      dismissToast(toastId);
      showSuccess("Debug pack download started!");
    } catch (err: any) {
      dismissToast(toastId);
      showError(`Download failed: ${err.message}`);
    } finally {
      setIsDownloadingDebug(null);
    }
  };

  if (isLoadingPacks) {
    return <div className="space-y-4"><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /></div>;
  }

  if (packsError) {
    return <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Error</AlertTitle><AlertDescription>{packsError.message}</AlertDescription></Alert>;
  }

  if (!packs || packs.length === 0) {
    return <p className="text-center text-muted-foreground py-8">No recent batch jobs found.</p>;
  }

  return (
    <>
      <Accordion type="single" collapsible className="w-full space-y-4" onValueChange={setOpenPackId}>
        {packSummaries.map(pack => {
          const unknownFailures = pack.failure_summary['Unknown'] || 0;
          const isRefinementPack = !!pack.metadata?.refinement_of_pack_id;
          const hasRefinementPass = pack.has_refinement_pass;
          const inProgress = pack.in_progress_jobs > 0;
          const hasFailures = pack.failed_jobs > 0;
          const isComplete = !inProgress && pack.total_jobs > 0;

          return (
            <AccordionItem key={pack.pack_id} value={pack.pack_id} className="border rounded-md">
              <div className="flex justify-between items-center p-4">
                <AccordionTrigger className="p-0 hover:no-underline flex-1 text-left">
                  <div className="flex items-center gap-2">
                    {isRefinementPack && <Wand2 className="h-5 w-5 text-purple-500" />}
                    <div className="text-left">
                      <p className="font-semibold">{pack.metadata?.name || `Pack from ${new Date(pack.created_at).toLocaleString()}`}</p>
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
                          <Button variant="secondary" size="sm" disabled={isStartingRefinement === pack.pack_id}>
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
                      <Button variant="secondary" size="sm" onClick={() => handleStartRefinementPass(pack.pack_id)} disabled={isStartingRefinement === pack.pack_id}>
                        {isStartingRefinement === pack.pack_id ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Wand2 className="h-4 w-4 mr-2" />}
                        Start Refinement Pass
                      </Button>
                    )
                  )}
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="secondary" size="sm" disabled={unknownFailures === 0 || isRerunning === pack.pack_id}>
                        {isRerunning === pack.pack_id ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
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
                        <AlertDialogAction onClick={() => handleRerunFailed(pack.pack_id)}>
                          {t('rerunFailedAnalysesAction')}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                  <Link to={`/vto-reports/${pack.pack_id}`}>
                    <Button>{t('viewReport')}</Button>
                  </Link>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="icon" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); handleDownloadResults(pack.pack_id); }} disabled={isDownloadingResults === pack.pack_id}>
                      {isDownloadingResults === pack.pack_id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    </Button>
                    <Button variant="outline" size="icon" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); handleDownloadDebugPack(pack.pack_id); }} disabled={isDownloadingDebug === pack.pack_id}>
                      {isDownloadingDebug === pack.pack_id ? <Loader2 className="h-4 w-4 animate-spin" /> : <HardDriveDownload className="h-4 w-4" />}
                    </Button>
                    {inProgress && <Loader2 className="h-5 w-5 animate-spin text-primary" />}
                    {hasFailures && <XCircle className="h-5 w-5 text-destructive" />}
                    {isComplete && !hasFailures && <CheckCircle className="h-5 w-5 text-green-600" />}
                  </div>
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