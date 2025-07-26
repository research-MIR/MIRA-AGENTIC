import { useState } from "react";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/context/LanguageContext";
import { Loader2, AlertTriangle, RefreshCw, Layers, Skull, BoxSelect, ClipboardCheck } from "lucide-react";
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
  const [isCancellingVTO, setIsCancellingVTO] = useState(false);
  const [isShuttingDown, setIsShuttingDown] = useState(false);
  const [isResettingVtoPacks, setIsResettingVtoPacks] = useState(false);
  const [isClearingFailedJobs, setIsClearingFailedJobs] = useState(false);
  const [isRecompositing, setIsRecompositing] = useState(false);

  const handleCancelAllSegmentationJobs = async () => {
    setIsCancelling(true);
    const toastId = showLoading("Cancelling all active segmentation jobs...");
    try {
        const { data, error } = await supabase.functions.invoke('MIRA-AGENT-tool-admin-cancel-all-segmentation-jobs');
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

  const handleCancelAllVTOJobs = async () => {
    setIsCancellingVTO(true);
    const toastId = showLoading("Cancelling all VTO Pro Mode jobs...");
    try {
        const { data, error } = await supabase.functions.invoke('MIRA-AGENT-tool-admin-cancel-all-pro-mode-jobs');
        if (error) throw error;
        dismissToast(toastId);
        showSuccess(data.message);
    } catch (err: any) {
        dismissToast(toastId);
        showError(`Failed to cancel jobs: ${err.message}`);
    } finally {
        setIsCancellingVTO(false);
    }
  };

  const handleShutdown = async () => {
    setIsShuttingDown(true);
    const toastId = showLoading("Initiating system-wide job shutdown...");
    try {
        const { data, error } = await supabase.functions.invoke('MIRA-AGENT-tool-admin-shutdown-all-jobs');
        if (error) throw error;
        dismissToast(toastId);
        showSuccess(data.message);
    } catch (err: any) {
        dismissToast(toastId);
        showError(`Shutdown failed: ${err.message}`);
    } finally {
        setIsShuttingDown(false);
    }
  };

  const handleResetVtoPacks = async () => {
    setIsResettingVtoPacks(true);
    const toastId = showLoading("Resetting all incomplete VTO packs...");
    try {
        const { data, error } = await supabase.functions.invoke('MIRA-AGENT-tool-admin-reset-vto-packs');
        if (error) throw error;
        dismissToast(toastId);
        showSuccess(data.message);
    } catch (err: any) {
        dismissToast(toastId);
        showError(`Failed to reset packs: ${err.message}`);
    } finally {
        setIsResettingVtoPacks(false);
    }
  };

  const handleClearFailedVTOJobs = async () => {
    setIsClearingFailedJobs(true);
    const toastId = showLoading("Deleting all failed VTO jobs...");
    try {
        const { data, error } = await supabase.functions.invoke('MIRA-AGENT-tool-admin-clear-failed-vto-jobs');
        if (error) throw error;
        dismissToast(toastId);
        showSuccess(data.message);
    } catch (err: any) {
        dismissToast(toastId);
        showError(`Failed to clear jobs: ${err.message}`);
    } finally {
        setIsClearingFailedJobs(false);
    }
  };

  const handleRecompositeAll = async () => {
    setIsRecompositing(true);
    const toastId = showLoading("Finding and re-queuing failed compositing jobs...");
    try {
        const { data, error } = await supabase.functions.invoke('MIRA-AGENT-tool-admin-recomposite-all-failed');
        if (error) throw error;
        dismissToast(toastId);
        showSuccess(data.message);
    } catch (err: any) {
        dismissToast(toastId);
        showError(`Operation failed: ${err.message}`);
    } finally {
        setIsRecompositing(false);
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
            <CardContent className="flex flex-col gap-4">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive">Re-run Failed Compositors</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will find all failed VTO Pro jobs that have a generated patch and re-run the final compositing step. This is useful for fixing jobs that failed due to a compositing error.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleRecompositeAll} disabled={isRecompositing}>
                      {isRecompositing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Yes, re-run compositors
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive">Cancel All Segmentation Jobs</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will cancel ALL active ('aggregating' or 'compositing') Segmentation jobs for EVERY user on the platform. This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleCancelAllSegmentationJobs} disabled={isCancelling}>
                      {isCancelling && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Yes, cancel all segmentation jobs
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive">Cancel All VTO Pro Mode Jobs</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will cancel ALL active ('queued', 'processing', 'compositing', 'delegated') VTO Pro Mode (inpaint) jobs for EVERY user. This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleCancelAllVTOJobs} disabled={isCancellingVTO}>
                      {isCancellingVTO && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Yes, cancel all VTO Pro jobs
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive">Reset Incomplete VTO Packs</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently DELETE all incomplete VTO packs and their associated child jobs for ALL users. This is useful for clearing stuck jobs from the system. This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleResetVtoPacks} disabled={isResettingVtoPacks}>
                      {isResettingVtoPacks && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Yes, reset VTO packs
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive">Clear All Failed VTO Jobs</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently DELETE all jobs from the 'mira-agent-bitstudio-jobs' table with a status of 'permanently_failed'. This can improve query performance but is irreversible.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleClearFailedVTOJobs} disabled={isClearingFailedJobs}>
                      {isClearingFailedJobs && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Yes, clear failed jobs
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-destructive">
                    <Skull className="h-5 w-5" />
                    Emergency Actions
                </CardTitle>
                <CardDescription>
                    These actions are irreversible and affect the entire platform. Use with extreme caution.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <AlertDialog>
                    <AlertDialogTrigger asChild>
                        <Button variant="destructive">EMERGENCY SHUTDOWN: Cancel All Active Jobs</Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                            <AlertDialogDescription>
                                This will attempt to cancel EVERY active job across ALL tables for ALL users. This is a last resort for system-wide issues. This action cannot be undone.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={handleShutdown} disabled={isShuttingDown} className="bg-destructive hover:bg-destructive/90">
                                {isShuttingDown && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                Yes, shut it all down
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
                <CardTitle>Experimental Tools</CardTitle>
                <CardDescription>Access bleeding-edge features and test new capabilities.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col items-start gap-2">
                <Link to="/developer/segmentation">
                    <Button variant="outline">
                        <Layers className="mr-2 h-4 w-4" />
                        Image Segmentation Tool
                    </Button>
                </Link>
                <Link to="/developer/bounding-box-tester">
                    <Button variant="outline">
                        <BoxSelect className="mr-2 h-4 w-4" />
                        Bounding Box Tester
                    </Button>
                </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Developer;