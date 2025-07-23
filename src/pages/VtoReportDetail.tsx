import { useParams, Link } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, AlertTriangle, Loader2 } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { SecureImageDisplay } from "@/components/VTO/SecureImageDisplay";
import { useImagePreview } from "@/context/ImagePreviewContext";
import { useEffect } from "react";
import { RealtimeChannel } from "@supabase/supabase-js";

interface ReportDetail {
  report_id: string;
  job_id: string;
  status: string;
  comparative_report: {
    overall_pass: boolean;
  } | null;
  source_person_image_url: string;
  source_garment_image_url: string;
  final_image_url: string;
}

const VtoReportDetail = () => {
  const { packId } = useParams();
  const { t } = useLanguage();
  const { supabase, session } = useSession();
  const { showImage } = useImagePreview();
  const queryClient = useQueryClient();

  const { data: reportDetails, isLoading, error } = useQuery<ReportDetail[]>({
    queryKey: ['vtoReportDetail', packId],
    queryFn: async () => {
      if (!packId || !session?.user) return [];
      const { data, error } = await supabase.rpc('get_vto_report_details_for_pack', {
        p_pack_id: packId,
        p_user_id: session.user.id
      });
      if (error) throw error;
      return data;
    },
    enabled: !!packId && !!session?.user,
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
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [packId, session?.user?.id, supabase, queryClient]);

  const passedJobs = reportDetails?.filter(j => j.comparative_report?.overall_pass) || [];
  const failedJobs = reportDetails?.filter(j => !j.comparative_report?.overall_pass) || [];

  const renderJobGrid = (jobs: ReportDetail[]) => (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
      {jobs.map(job => (
        <Card 
          key={job.job_id} 
          className="relative group cursor-pointer"
          onClick={() => showImage({ images: [{ url: job.final_image_url }], currentIndex: 0 })}
        >
          <SecureImageDisplay imageUrl={job.final_image_url} alt={`Job ${job.job_id}`} className="w-full h-full object-cover rounded-md" />
          <Badge variant={job.comparative_report?.overall_pass ? 'default' : 'destructive'} className="absolute top-2 right-2">
            {job.comparative_report?.overall_pass ? 'PASS' : 'FAIL'}
          </Badge>
        </Card>
      ))}
    </div>
  );

  if (isLoading) {
    return <div className="p-8"><Skeleton className="h-12 w-1/3" /><div className="grid grid-cols-6 gap-4 mt-8">{[...Array(12)].map((_, i) => <Skeleton key={i} className="h-40 w-full" />)}</div></div>;
  }

  if (error) {
    return <div className="p-8"><Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Error</AlertTitle><AlertDescription>{error.message}</AlertDescription></Alert></div>;
  }

  return (
    <div className="p-4 md:p-8 h-screen flex flex-col">
      <header className="pb-4 mb-8 border-b">
        <Link to="/vto-reports" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-2">
          <ArrowLeft className="h-4 w-4" />
          Back to All Reports
        </Link>
        <h1 className="text-3xl font-bold">{t('vtoReportDetailTitle')}</h1>
        <p className="text-muted-foreground">Pack ID: {packId}</p>
      </header>
      <Tabs defaultValue="all" className="w-full flex-1 flex flex-col">
        <TabsList>
          <TabsTrigger value="all">{t('allJobs')} ({reportDetails?.length || 0})</TabsTrigger>
          <TabsTrigger value="passed">{t('passedJobs')} ({passedJobs.length})</TabsTrigger>
          <TabsTrigger value="failed">{t('failedJobs')} ({failedJobs.length})</TabsTrigger>
        </TabsList>
        <div className="flex-1 overflow-y-auto mt-4">
          <TabsContent value="all">
            {renderJobGrid(reportDetails || [])}
          </TabsContent>
          <TabsContent value="passed">
            {renderJobGrid(passedJobs)}
          </TabsContent>
          <TabsContent value="failed">
            {renderJobGrid(failedJobs)}
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
};

export default VtoReportDetail;