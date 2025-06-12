import { useState, useEffect, useRef } from "react";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { showError, showLoading, dismissToast, showSuccess } from "@/utils/toast";
import { useLanguage } from "@/context/LanguageContext";
import { Loader2 } from "lucide-react";
import { RealtimeChannel } from "@supabase/supabase-js";

interface ComfyJob {
  id: string;
  status: 'queued' | 'processing' | 'complete' | 'failed';
  final_result?: { publicUrl: string };
  error_message?: string;
}

const workflowTemplate = `{
  "3": {
    "inputs": {
      "seed": 123,
      "steps": 8,
      "cfg": 1.8,
      "sampler_name": "dpmpp_2m_sde",
      "scheduler": "karras",
      "denoise": 1,
      "model": ["4", 0],
      "positive": ["6", 0],
      "negative": ["7", 0],
      "latent_image": ["5", 0]
    },
    "class_type": "KSampler"
  },
  "4": {
    "inputs": {
      "ckpt_name": "sd_xl_base_1.0.safetensors"
    },
    "class_type": "CheckpointLoaderSimple"
  },
  "5": {
    "inputs": {
      "width": 1024,
      "height": 1024,
      "batch_size": 1
    },
    "class_type": "EmptyLatentImage"
  },
  "6": {
    "inputs": {
      "text": "A beautiful fiorucci angel",
      "clip": ["4", 1]
    },
    "class_type": "CLIPTextEncode"
  },
  "7": {
    "inputs": {
      "text": "text, watermark",
      "clip": ["4", 1]
    },
    "class_type": "CLIPTextEncode"
  },
  "8": {
    "inputs": {
      "samples": ["3", 0],
      "vae": ["4", 2]
    },
    "class_type": "VAEDecode"
  },
  "9": {
    "inputs": {
      "filename_prefix": "ComfyUI",
      "images": ["8", 0]
    },
    "class_type": "SaveImage"
  }
}`;

const Developer = () => {
  const { supabase, session } = useSession();
  const { t } = useLanguage();
  const [isDevAuthenticated, setIsDevAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const channelRef = useRef<RealtimeChannel | null>(null);

  // ComfyUI State
  const [comfyAddress, setComfyAddress] = useState("https://your-ngrok-or-public-url.io");
  const [workflowJson, setWorkflowJson] = useState(workflowTemplate);
  const [activeJob, setActiveJob] = useState<ComfyJob | null>(null);
  const [comfyPrompt, setComfyPrompt] = useState("");
  const [sourceImage, setSourceImage] = useState<File | null>(null);
  const [imageNodeId, setImageNodeId] = useState("404");
  const [promptNodeId, setPromptNodeId] = useState("307");
  const [promptFieldName, setPromptFieldName] = useState("String");


  useEffect(() => {
    const devAuthStatus = sessionStorage.getItem('dev_authenticated') === 'true';
    if (devAuthStatus) setIsDevAuthenticated(true);

    return () => {
      if (channelRef.current) {
        console.log("[DevPage] Cleaning up Realtime channel.");
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

  const handleQueuePrompt = async () => {
    if (!session?.user) return showError("You must be logged in.");

    setActiveJob({ id: '', status: 'queued' });
    let toastId = showLoading("Starting workflow...");

    try {
      let finalWorkflow;
      try {
        finalWorkflow = JSON.parse(workflowJson);
      } catch (e) {
        throw new Error("Workflow API Data is not valid JSON.");
      }

      // Step 1: Upload image if provided
      if (sourceImage) {
        dismissToast(toastId);
        toastId = showLoading("Uploading source image...");
        
        const uploadFormData = new FormData();
        uploadFormData.append('image', sourceImage);
        uploadFormData.append('comfyui_address', comfyAddress);
        
        const { data: uploadResult, error: uploadError } = await supabase.functions.invoke('MIRA-AGENT-proxy-comfyui-upload', {
            body: uploadFormData
        });

        if (uploadError) throw new Error(`Image upload failed: ${uploadError.message}`);
        const uploadedFilename = uploadResult.name;
        if (!uploadedFilename) throw new Error("ComfyUI did not return a filename for the uploaded image.");
        
        if (finalWorkflow[imageNodeId]) {
            finalWorkflow[imageNodeId].inputs.image = uploadedFilename;
        } else {
            throw new Error(`Could not find the LoadImage node with ID '${imageNodeId}' in the workflow.`);
        }
      }

      // Step 2: Inject prompt if provided
      if (comfyPrompt.trim()) {
        if (finalWorkflow[promptNodeId]) {
            finalWorkflow[promptNodeId].inputs[promptFieldName] = comfyPrompt;
        } else {
            throw new Error(`Could not find the Prompt node with ID '${promptNodeId}' in the workflow.`);
        }
      }
      
      // Step 3: Queue the prompt
      dismissToast(toastId);
      toastId = showLoading("Sending prompt to ComfyUI...");

      const { data, error } = await supabase.functions.invoke('MIRA-AGENT-proxy-comfyui', {
        body: {
          comfyui_address: comfyAddress,
          prompt_workflow: finalWorkflow,
          invoker_user_id: session.user.id
        }
      });

      if (error) throw error;
      
      const { jobId } = data;
      if (!jobId) throw new Error("Did not receive a job ID from the server.");
      
      dismissToast(toastId);
      showSuccess("ComfyUI job queued. Waiting for result...");
      setActiveJob({ id: jobId, status: 'queued' });

      // Step 4: Subscribe to updates
      if (channelRef.current) supabase.removeChannel(channelRef.current);

      channelRef.current = supabase.channel(`comfyui-job-${jobId}`)
        .on<ComfyJob>(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'mira-agent-comfyui-jobs', filter: `id=eq.${jobId}` },
          (payload) => {
            setActiveJob(payload.new as ComfyJob);
            if (payload.new.status === 'complete' || payload.new.status === 'failed') {
              supabase.removeChannel(channelRef.current!);
              channelRef.current = null;
            }
          }
        )
        .subscribe();

    } catch (err: any) {
      setActiveJob(null);
      showError(`Failed to queue prompt: ${err.message}`);
      dismissToast(toastId);
    }
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
            <CardHeader><CardTitle>{t.workflowInputs}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="comfy-prompt">{t.promptText}</Label>
                <Textarea id="comfy-prompt" value={comfyPrompt} onChange={(e) => setComfyPrompt(e.target.value)} placeholder={t.promptTextPlaceholder} />
              </div>
              <div>
                <Label htmlFor="source-image">{t.sourceImage}</Label>
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
              <div className="grid grid-cols-2 gap-4">
                <div>
                    <Label htmlFor="image-node-id">Image Node ID</Label>
                    <Input id="image-node-id" value={imageNodeId} onChange={(e) => setImageNodeId(e.target.value)} placeholder="e.g., 404" />
                </div>
                <div>
                    <Label htmlFor="prompt-node-id">Prompt Node ID</Label>
                    <Input id="prompt-node-id" value={promptNodeId} onChange={(e) => setPromptNodeId(e.target.value)} placeholder="e.g., 307" />
                </div>
                 <div>
                    <Label htmlFor="prompt-field-name">Prompt Field Name</Label>
                    <Input id="prompt-field-name" value={promptFieldName} onChange={(e) => setPromptFieldName(e.target.value)} placeholder="e.g., String or text" />
                </div>
              </div>
               <div>
                <Label htmlFor="workflow-json">{t.workflowAPIData}</Label>
                <Textarea id="workflow-json" value={workflowJson} onChange={(e) => setWorkflowJson(e.target.value)} rows={15} />
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