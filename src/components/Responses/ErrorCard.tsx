import { Card, CardContent } from "@/components/ui/card";
import { Bot, AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { showError, showLoading, dismissToast, showSuccess } from "@/utils/toast";
import { useState } from "react";

interface ErrorCardProps {
  message: string;
  jobId: string;
}

export const ErrorCard = ({ message, jobId }: ErrorCardProps) => {
  const { supabase } = useSession();
  const [isRetrying, setIsRetrying] = useState(false);

  const handleRetry = async () => {
    setIsRetrying(true);
    const toastId = showLoading("Retrying...");
    try {
      // 1. Fetch the job to get the last known history
      const { data: job, error: fetchError } = await supabase
        .from('mira-agent-jobs')
        .select('context')
        .eq('id', jobId)
        .single();
      
      if (fetchError) throw fetchError;

      const history = job.context?.history || [];
      
      // 2. Find and remove the last model turn (the failed tool call)
      // This forces the agent to re-plan from the previous state.
      let lastModelTurnIndex = -1;
      for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].role === 'model') {
          lastModelTurnIndex = i;
          break;
        }
      }

      let newHistory = history;
      if (lastModelTurnIndex !== -1) {
        newHistory = history.slice(0, lastModelTurnIndex);
      }

      // 3. Update the job with the corrected history and set status to processing
      const { error: updateError } = await supabase
        .from('mira-agent-jobs')
        .update({ 
          status: 'processing', 
          error_message: null,
          context: { ...job.context, history: newHistory }
        })
        .eq('id', jobId);

      if (updateError) throw updateError;

      // 4. Directly invoke the worker to ensure a fast response.
      // The UI will update via the realtime subscription from the update above.
      const { error: invokeError } = await supabase.functions.invoke('MIRA-AGENT-master-worker', {
        body: { job_id: jobId }
      });
      if (invokeError) {
          // This is not critical, the watchdog will pick it up. Just log it.
          console.warn(`Direct invocation failed, watchdog will handle it: ${invokeError.message}`);
      }

      dismissToast(toastId);
      showSuccess("Retrying from last step...");
    } catch (err: any) {
      dismissToast(toastId);
      showError(`Failed to retry: ${err.message}`);
    } finally {
      setIsRetrying(false);
    }
  };

  return (
    <Card className="max-w-lg bg-destructive/10 border-destructive">
      <CardContent className="p-3">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-destructive rounded-full text-destructive-foreground">
            <Bot size={20} />
          </div>
          <div className="flex-1">
            <p className="font-semibold text-destructive">An Error Occurred</p>
            <p className="text-sm text-destructive/90">{message}</p>
          </div>
          <Button variant="destructive" size="sm" onClick={handleRetry} disabled={isRetrying}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};