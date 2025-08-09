import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { Link } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { BarChart2, AlertTriangle, CheckCircle, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface AnalyzedPack {
  id: string;
  metadata: { name?: string };
  created_at: string;
  synthesis_report: string;
}

const VtoReports = () => {
  const { supabase, session } = useSession();
  const { t } = useLanguage();

  const { data: analyzedPacks, isLoading, error } = useQuery<AnalyzedPack[]>({
    queryKey: ['analyzedVtoPacks', session?.user?.id],
    queryFn: async () => {
      if (!session?.user) return [];
      const { data, error } = await supabase
        .from('mira-agent-vto-packs-jobs')
        .select('id, metadata, created_at, synthesis_report')
        .eq('user_id', session.user.id)
        .not('synthesis_report', 'is', null)
        .neq('synthesis_report', 'Analysis in progress...')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!session?.user,
  });

  const getOverallPassRate = (report: string) => {
    if (!report) return null;
    // Check for English first, then Italian to handle reports in either language.
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
      
      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : error ? (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      ) : analyzedPacks && analyzedPacks.length > 0 ? (
        <div className="space-y-4">
          {analyzedPacks.map(pack => {
            const passRate = getOverallPassRate(pack.synthesis_report);
            return (
              <Link to={`/vto-reports/${pack.id}`} key={pack.id}>
                <Card className="hover:border-primary transition-colors">
                  <CardContent className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="p-3 bg-muted rounded-lg">
                        <BarChart2 className="h-6 w-6 text-muted-foreground" />
                      </div>
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
    </div>
  );
};

export default VtoReports;