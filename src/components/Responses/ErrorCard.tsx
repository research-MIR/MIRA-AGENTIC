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
    const toastId = showLoading("Forcing agent to continue...");
    try {
      // This re-invokes the worker, which will pick up from the last state.
      const { error } = await supabase.functions.invoke('MIRA-AGENT-master-worker', {
        body: { job_id: jobId }
      });
      if (error) throw error;
      showSuccess("Agent re-triggered successfully.");
      // The UI will update automatically via the realtime subscription.
    } catch (err: any) {
      showError(`Failed to re-trigger agent: ${err.message}`);
    } finally {
      dismissToast(toastId);
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