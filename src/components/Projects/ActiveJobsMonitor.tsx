import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { Badge } from "@/components/ui/badge";

interface ActiveJob {
  job_id: string;
  job_type: string;
  status: string;
  prompt_snippet: string;
  created_at: string;
}

export const ActiveJobsMonitor = ({ projectId }: { projectId: string }) => {
  const { supabase, session } = useSession();
  const { t } = useLanguage();

  const { data: activeJobs, isLoading } = useQuery<ActiveJob[]>({
    queryKey: ['activeProjectJobs', projectId],
    queryFn: async () => {
      if (!projectId || !session?.user) return [];
      const { data, error } = await supabase.rpc('get_active_jobs_for_project', {
        p_project_id: projectId,
        p_user_id: session.user.id
      });
      if (error) throw error;
      return data;
    },
    enabled: !!projectId && !!session?.user,
    refetchInterval: 5000, // Poll every 5 seconds
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('liveJobStatus')}</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center p-4">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : activeJobs && activeJobs.length > 0 ? (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {activeJobs.map(job => (
              <div key={job.job_id} className="flex items-center justify-between p-2 rounded-md bg-muted/50">
                <div className="flex items-center gap-2 overflow-hidden">
                  <Loader2 className="h-4 w-4 animate-spin flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium truncate">{job.prompt_snippet || job.job_type}</p>
                    <p className="text-xs text-muted-foreground">{job.job_type}</p>
                  </div>
                </div>
                <Badge variant="secondary" className="capitalize">{job.status.replace(/_/g, ' ')}</Badge>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">No active jobs for this project.</p>
        )}
      </CardContent>
    </Card>
  );
};