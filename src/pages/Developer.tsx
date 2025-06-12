import { useState, useEffect, useRef } from "react";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { showError, showLoading, dismissToast, showSuccess } from "@/utils/toast";
import { useLanguage } from "@/context/LanguageContext";
import { Loader2, Upload } from "lucide-react";
import { RealtimeChannel } from "@supabase/supabase-js";

interface ComfyJob {
  id: string;
  status: 'queued' | 'processing' | 'complete' | 'failed';
  final_result?: { publicUrl: string };
  error_message?: string;
}

const Developer = () => {
  const { supabase, session } = useSession();
  const { t } = useLanguage();
  const [isDevAuthenticated, setIsDevAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

  // ComfyUI State
  const [comfyAddress, setComfyAddress] = useState("https://your-ngrok-or-public-url.io");
  const [workflowJson, setWorkflowJson] = useState("");
  const [activeJob, setActiveJob] = useState<ComfyJob | null>(null);
  const [comfyPrompt, setComfyPrompt] = useState("");
  const [sourceImage, setSourceImage] = useState<File | null>(null);

  useEffect(() => {
    const devAuthStatus = sessionStorage.getItem('dev_authenticated') === 'true';
    if (devAuthStatus) setIsDevAuthenticated(true);

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, [supabase]);

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    const toastId = showLoading("Verifying password...");
    try {
      const { data, error } = await supabase.functions.invoke('MIRA-AGENT-verify-dev-pass', { body: { password } });
      if (error) throw error;
      if (data.success) {
        sessionStorage.setItem('dev_authenticated', 'true');
        setIsDevAuthenticated(true);
        showSuccess("Access granted.");
      } else {
        showError("Incorrect password.");
      }
    } catch (err: any) {
      showError(err.message);
    } finally {
      dismissToast(toastId);
      setIsLoading(false);
    }
  };

  const handleWorkflowFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.type === "application/json") {
      const reader = new FileReader();
      reader.onload = (e) => {
        if (typeof e.target?.result === 'string') setWorkflowJson(e.target.result);
      };
      reader.readAsText(file);
    } else {
      showError("Please upload a valid JSON file.");
    }
  };

  const handleQueuePrompt = async () => {
    if (!session?.user) return showError("You must be logged in.");
    let parsedWorkflow;
    try {
      parsedWorkflow = JSON.parse(workflowJson);
    } catch (e) {
      return showError("Invalid Workflow API JSON.");
    }

    // This is a placeholder for the more complex logic to come.
    // For now, it will still fail if the workflow requires inputs.
    showError("Logic not yet implemented. This will be wired up in the next step.");
    console.log({ comfyPrompt, sourceImage, parsedWorkflow });
    return;


    // setActiveJob({ id: '', status: 'queued' });
    // const toastId = showLoading("Sending prompt to ComfyUI...");
    
    // try {
    //   const { data, error } = await supabase.functions.invoke('MIRA-AGENT-proxy-comfyui', {
    //     body: {
    //       comfyui_address: comfyAddress,
    //       prompt_workflow: parsedWorkflow,
    //       invoker_user_id: session.user.id
    //     }
    //   });

    //   if (error) throw error;
      
    //   const { jobId } = data;
    //   if (!jobId) throw new Error("Did not receive a job ID from the server.");
      
    //   dismissToast(toastId);
    //   showSuccess("ComfyUI job queued. Waiting for result...");
    //   setActiveJob({ id: jobId, status: 'queued' });

    //   if (channelRef.current) {
    //     supabase.removeChannel(channelRef.current);
    //   }

    //   channelRef.current = supabase.channel(`comfyui-job-${jobId}`)
    //     .on<ComfyJob>(
    //       'postgres_changes',
    //       { event: 'UPDATE', schema: 'public', table: 'mira-agent-comfyui-jobs', filter: `id=eq.${jobId}` },
    //       (payload) => {
    //         console.log('Realtime update received:', payload.new);
    //         setActiveJob(payload.new as ComfyJob);
    //         if (payload.new.status === 'complete' || payload.new.status === 'failed') {
    //           supabase.removeChannel(channelRef.current!);
    //           channelRef.current = null;
    //         }
    //       }
    //     )
    //     .subscribe();

    // } catch (err: any) {
    //   setActiveJob(null);
    //   showError(`Failed to queue prompt: ${err.message}`);
    //   dismissToast(toastId);
    // }
  };

  const renderJobStatus = () => {
    if (!activeJob) return <p className="text-center text-muted-foreground">{t.resultsPlaceholder}</p>;

    switch (activeJob.status) {
      case 'queued':
        return <div className="flex items-center justify-center"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Waiting in queue...</div>;
      case 'processing':
        return <div className="flex items-center justify-center"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating image...</div>;
      case 'complete':
        return activeJob.final_result?.publicUrl ? (
          <img src={activeJob.final_result.publicUrl} alt="Generated by ComfyUI" className="max-w-full mx-auto rounded-lg" />
        ) : <p>Job complete, but no image URL found.</p>;
      case 'failed':
        return <p className="text-destructive">Job failed: {activeJob.error_message}</p>;
      default:
        return null;
    }
  };

  if (!isDevAuthenticated) {
    return (
      <div className="flex items-center justify-center h-full">
        <Card className="w-full max-w-sm">
          <CardHeader><CardTitle>{t.enterDeveloperPassword}</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              <div>
                <Label htmlFor="dev-password">Password</Label>
                <Input id="dev-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </div>
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t.submit}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 h-screen overflow-y-auto">
      <header className="pb-4 mb-8 border-b">
        <h1 className="text-3xl font-bold">{t.developerTools}</h1>
        <p className="text-muted-foreground">{t.developerToolsDescription}</p>
      </header>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Workflow Inputs</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="comfy-prompt">Prompt Text</Label>
                <Textarea id="comfy-prompt" value={comfyPrompt} onChange={(e) => setComfyPrompt(e.target.value)} placeholder="The prompt to inject into your workflow..." />
              </div>
              <div>
                <Label htmlFor="source-image">Source Image (for Img2Img/Upscale)</Label>
                <Input id="source-image" type="file" onChange={(e) => setSourceImage(e.target.files?.[0] || null)} accept="image/*" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>{t.comfyUIWorkflowTester}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="comfy-address">{t.comfyUIServerAddress}</Label>
                <Input id="comfy-address" value={comfyAddress} onChange={(e) => setComfyAddress(e.target.value)} />
                <p className="text-xs text-muted-foreground mt-1">{t.comfyUIAddressDescription}</p>
              </div>
              <div>
                <div className="flex justify-between items-center mb-2">
                  <Label htmlFor="workflow-json">{t.workflowAPIData}</Label>
                  <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                    <Upload className="mr-2 h-4 w-4" /> {t.uploadWorkflow}
                  </Button>
                  <input type="file" ref={fileInputRef} onChange={handleWorkflowFileUpload} className="hidden" accept=".json" />
                </div>
                <Textarea id="workflow-json" value={workflowJson} onChange={(e) => setWorkflowJson(e.target.value)} placeholder='Paste your ComfyUI "API format" JSON here...' rows={15} className="font-mono text-sm" />
              </div>
              <Button onClick={handleQueuePrompt} disabled={!!activeJob && activeJob.status !== 'complete' && activeJob.status !== 'failed'}>
                {(activeJob && (activeJob.status === 'queued' || activeJob.status === 'processing')) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t.queuePrompt}
              </Button>
            </CardContent>
          </Card>
        </div>
        <div>
          <Card>
            <CardHeader><CardTitle>{t.results}</CardTitle></CardHeader>
            <CardContent className="min-h-[300px] flex items-center justify-center">
              {renderJobStatus()}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Developer;