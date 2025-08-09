import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { Link } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { BarChart2, AlertTriangle, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMemo } from "react";
import { Progress } from "@/components/ui/progress";
import { differenceInMinutes } from 'date-fns';

interface AnalyzedPack {
  id: string;
  metadata: { name?: string, total_pairs?: number };
  created_at: string;
  synthesis_report: string | null;
  total_reports: number;
  last_report_updated_at: string | null;
}

const InProgressReportCard = ({ pack }: { pack: AnalyzedPack }) => {
  const totalJobs = pack.metadata?.total_pairs || 0;
  const progress = totalJobs > 0 ? (pack.total_reports / totalJobs) * 100 : 0;
  
  const lastUpdate = pack.last_report_updated_at ? new Date(pack.last_report_updated_at) : null;
  const minutesSinceUpdate = lastUpdate ? differenceInMinutes(new Date(), lastUpdate) : null;
  const isStuck = minutesSinceUpdate !== null && minutesSinceUpdate > 5;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex justify-between items-center">
          <div>
            <p className="font-semibold">{pack.metadata?.name || `Report from ${new Date(pack.created_at).toLocaleDateString()}`}</p>
            <p className="text-sm text-muted-foreground">Analysis started {new Date(pack.created_at).toLocaleString()}</p>
          </div>
          {isStuck && <Badge variant="destructive">Stalled</Badge>}
        </div>
        <div className="mt-4">
          <div className="flex justify-between items-center mb-1">
            <span className="text-sm text-muted-foreground">Progress</span>
            <span className="text-sm font-medium">{pack.total_reports} / {totalJobs} reports</span>
          </div>
          <Progress value={progress} />
        </div>
      </CardContent>
    </Card>
  );
};

const VtoReports = () => {
  const { supabase, session } = useSession();
  const { t } = useLanguage();

  const { data: queryData, isLoading, error } = useQuery({
    queryKey: ['vtoReportsAndPacks', session?.user?.id],
    queryFn: async () => {
      if (!session?.user) return { packs: [], reports: [] };
      const packsPromise = supabase
        .from('mira-agent-vto-packs-jobs')
        .select('id, metadata, created_at, synthesis_report')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false });
      
      const reportsPromise = supabase
        .from('mira-agent-vto-qa-reports')
        .select('vto_pack_job_id, updated_at')
        .eq('user_id', session.user.id);

      const [{ data: packs, error: packsError }, { data: reports, error: reportsError }] = await Promise.all([packsPromise, reportsPromise]);

      if (packsError) throw packsError;
      if (reportsError) throw reportsError;
      
      return { packs, reports };
    },
    enabled: !!session?.user,
    refetchInterval: 15000, // Poll for updates
  });

  const { completedPacks, inProgressPacks } = useMemo(() => {
    if (!queryData?.packs) return { completedPacks: [], inProgressPacks: [] };
    
    const reportsByPack = new Map<string, { count: number, lastUpdate: string | null }>();
    queryData.reports?.forEach(report => {
      const existing = reportsByPack.get(report.vto_pack_job_id) || { count: 0, lastUpdate: null };
      existing.count++;
      if (!existing.lastUpdate || new Date(report.updated_at) > new Date(existing.lastUpdate)) {
        existing.lastUpdate = report.updated_at;
      }
      reportsByPack.set(report.vto_pack_job_id, existing);
    });

    const allPacks: AnalyzedPack[] = queryData.packs.map(pack => ({
      ...pack,
      total_reports: reportsByPack.get(pack.id)?.count || 0,
      last_report_updated_at: reportsByPack.get(pack.id)?.lastUpdate || null,
    }));

    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const completed = allPacks.filter(p => p.synthesis_report && p.synthesis_report !== 'Analysis in progress...');
    const inProgress = allPacks.filter(p => p.synthesis_report === 'Analysis in progress...' && new Date(p.created_at) > twentyFourHoursAgo);

    return { completedPacks: completed, inProgressPacks: inProgress };
  }, [queryData]);

  const getOverallPassRate = (report: string) => {
    if (!report) return null;
    let match = report.match(/Overall Pass Rate: (\d+\.\d+)%/);
    if (!match) {
      match = report.match(/Tasso di Successo Complessivo: (\d+\.\d+)%/);
    }
    return match ? parseFloat(match[1]) : null;
  };

  return (
    <div className="p-4 md:p-8 h-screen overflow-y-auto">
      <header className="pb-4 mb-8 border-b">
        <h1 className="text-3xl font-bold">{t('vtoAnalysisReports')}</h1>
        <p className="text-muted-foreground">{t('vtoAnalysisReportsDescription')}</p>
      </header>
      
      <Tabs defaultValue="completed">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="completed">Completed Reports</TabsTrigger>
          <TabsTrigger value="in-progress">
            In Progress
            {inProgressPacks.length > 0 && <Badge className="ml-2">{inProgressPacks.length}</Badge>}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="completed" className="mt-4">
          {isLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" />
            </div>
          ) : error ? (
            <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Error</AlertTitle><AlertDescription>{(error as Error).message}</AlertDescription></Alert>
          ) : completedPacks.length > 0 ? (
            <div className="space-y-4">
              {completedPacks.map(pack => {
                const passRate = getOverallPassRate(pack.synthesis_report!);
                return (
                  <Link to={`/vto-reports/${pack.id}`} key={pack.id}>
                    <Card className="hover:border-primary transition-colors">
                      <CardContent className="p-4 flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="p-3 bg-muted rounded-lg"><BarChart2 className="h-6 w-6 text-muted-foreground" /></div>
                          <div>
                            <p className="font-semibold">{pack.metadata?.name || `Report from ${new Date(pack.created_at).toLocaleDateString()}`}</p>
                            <p className="text-sm text-muted-foreground">Analyzed on {new Date(pack.created_at).toLocaleString()}</p>
                          </div>
                        </div>
                        {passRate !== null && (
                          <div className="flex items-center gap-2">
                            <span className="text-lg font-bold">{passRate.toFixed(1)}%</span>
                            {passRate >= 80 ? <CheckCircle className="h-5 w-5 text-green-500" /> : <XCircle className="h-5 w-5 text-destructive" />}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-16">
              <BarChart2 className="mx-auto h-16 w-16 text-muted-foreground" />
              <h2 className="mt-4 text-xl font-semibold">{t('noReportsGenerated')}</h2>
              <p className="mt-2 text-muted-foreground">{t('noReportsGeneratedDescription')}</p>
            </div>
          )}
        </TabsContent>
        <TabsContent value="in-progress" className="mt-4">
          {isLoading ? (
            <div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin" /></div>
          ) : inProgressPacks.length > 0 ? (
            <div className="space-y-4">
              {inProgressPacks.map(pack => <InProgressReportCard key={pack.id} pack={pack} />)}
            </div>
          ) : (
            <div className="text-center py-16">
              <h2 className="mt-4 text-xl font-semibold">No analysis jobs in progress.</h2>
              <p className="mt-2 text-muted-foreground">Start an analysis from the Virtual Try-On (Packs) page to see it here.</p>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default VtoReports;