import { useState } from "react";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/context/LanguageContext";
import { Loader2, AlertTriangle, RefreshCw } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { showError, showLoading, dismissToast, showSuccess } from "@/utils/toast";

const AdminChatDashboard = () => {
  const { supabase } = useSession();
  const { t } = useLanguage();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['adminChatDashboard'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_admin_chat_dashboard_data');
      if (error) throw new Error(error.message);
      return data;
    },
    retry: false,
  });

  const getStatusVariant = (status: string) => {
    switch (status) {
      case 'complete': return 'default';
      case 'processing': return 'secondary';
      case 'awaiting_feedback': return 'secondary';
      case 'failed': return 'destructive';
      default: return 'outline';
    }
  };

  return (
    <Card className="lg:col-span-2">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>User Chat Dashboard</CardTitle>
          <CardDescription>Monitor all user conversations and job statuses.</CardDescription>
        </div>
        <Button variant="outline" size="icon" onClick={() => refetch()} disabled={isLoading}>
          <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading && (
          <div className="flex items-center justify-center p-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        )}
        {data && (
          <Accordion type="multiple" className="w-full">
            {data.map((user: any) => (
              <AccordionItem key={user.user_id} value={user.user_id}>
                <AccordionTrigger>
                  <div className="flex items-center gap-4">
                    <span>{user.email}</span>
                    <Badge variant="outline">{user.jobs.length} chats</Badge>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-2 max-h-96 overflow-y-auto pr-2">
                    {user.jobs.map((job: any) => (
                      <Link to={`/chat/${job.id}`} key={job.id} className="block p-2 rounded-md hover:bg-muted border">
                        <div className="flex justify-between items-start">
                          <p className="font-medium text-sm truncate pr-4">{job.original_prompt || "Untitled Chat"}</p>
                          <Badge variant={getStatusVariant(job.status)}>{job.status}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          Last updated: {new Date(job.updated_at).toLocaleString()}
                        </p>
                      </Link>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        )}
      </CardContent>
    </Card>
  );
};

const Developer = () => {
  const { supabase } = useSession();
  const { t } = useLanguage();
  const [isCancelling, setIsCancelling] = useState(false);

  const handleCancelAllJobs = async () => {
    setIsCancelling(true);
    const toastId = showLoading("Cancelling all active jobs...");
    try {
        const { data, error } = await supabase.functions.invoke('MIRA-AGENT-tool-admin-cancel-all-comfy-jobs');
        if (error) throw error;
        dismissToast(toastId);
        showSuccess(data.message);
    } catch (err: any) {
        dismissToast(toastId);
        showError(`Failed to cancel jobs: ${err.message}`);
    } finally {
        setIsCancelling(false);
    }
  };

  return (
    <div className="p-4 md:p-8 h-screen overflow-y-auto">
      <header className="pb-4 mb-8 border-b">
        <h1 className="text-3xl font-bold">{t('developerTools')}</h1>
        <p className="text-muted-foreground">{t('developerToolsDescription')}</p>
      </header>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <AdminChatDashboard />
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Admin Site-Wide Actions</CardTitle>
              <CardDescription>These actions affect all users and jobs on the platform. Use with extreme caution.</CardDescription>
            </CardHeader>
            <CardContent>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive">Cancel All ComfyUI Jobs</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will cancel ALL active ('queued' or 'processing') ComfyUI jobs for EVERY user on the platform. This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleCancelAllJobs} disabled={isCancelling}>
                      {isCancelling && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Yes, cancel all jobs
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Developer;