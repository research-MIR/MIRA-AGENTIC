import { Card, CardContent } from "@/components/ui/card";
import { Bot, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { showLoading, dismissToast, showError, showSuccess } from "@/utils/toast";
import { useState } from "react";

interface JobStatusCardProps {
  message: string;
  jobId: string;
}

export const JobStatusCard = ({ message, jobId }: JobStatusCardProps) => {
  const { supabase } = useSession();
  const [isRetrying, setIsRetrying] = useState(false);

  const handleRetry = async () => {
    setIsRetrying(true);
    const toastId = showLoading("Forcing agent to continue...");
    try {
      const { error } = await supabase.functions.invoke('MIRA-AGENT-master-worker', {
        body: { job_id: jobId }
      });
      if (error) throw error;
      showSuccess("Agent re-triggered successfully.");
    } catch (err: any) {
      showError(`Failed to re-trigger agent: ${err.message}`);
    } finally {
      dismissToast(toastId);
      setIsRetrying(false);
    }
  };

  return (
    <Card className="max-w-lg bg-secondary/50">
      <CardContent className="p-3">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary rounded-full text-primary-foreground">
            <Bot size={20} />
          </div>
          <div className="flex-1">
            <p className="font-semibold">Working on it...</p>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{message}</span>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={handleRetry} disabled={isRetrying}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Try Again
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};