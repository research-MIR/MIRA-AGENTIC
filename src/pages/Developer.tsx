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

const workflowTemplate = `
{
  "9": {
    "inputs": {
      "clip_name1": "clip_l.safetensors",
      "clip_name2": "t5xxl_fp16.safetensors",
      "type": "flux",
      "device": "default"
    },
    "class_type": "DualCLIPLoader",
    "_meta": {
      "title": "DualCLIPLoader"
    }
  },
  "10": {
    "inputs": {
      "vae_name": "ae.safetensors"
    },
    "class_type": "VAELoader",
    "_meta": {
      "title": "Load VAE"
    }
  },
  "20": {
    "inputs": {
      "dishonesty_factor": -0.010000000000000002,
      "start_percent": 0.6600000000000001,
      "end_percent": 0.9500000000000002,
      "sampler": [
        "21",
        0
      ]
    },
    "class_type": "LyingSigmaSampler",
    "_meta": {
      "title": "Lying Sigma Sampler"
    }
  },
  "21": {
    "inputs": {
      "sampler_name": "dpmpp_2m"
    },
    "class_type": "KSamplerSelect",
    "_meta": {
      "title": "KSamplerSelect"
    }
  },
  "249": {
    "inputs": {
      "lora_name": "IDunnohowtonameLora.safetensors",
      "strength_model": 0.8000000000000002,
      "model": [
        "304",
        0
      ]
    },
    "class_type": "LoraLoaderModelOnly",
    "_meta": {
      "title": "LoraLoaderModelOnly"
    }
  },
  "304": {
    "inputs": {
      "unet_name": "realDream_flux1V1.safetensors",
      "weight_dtype": "default"
    },
    "class_type": "UNETLoader",
    "_meta": {
      "title": "Load Diffusion Model"
    }
  },
  "307": {
    "inputs": {
      "String": "HERE THE PROMPT"
    },
    "class_type": "String",
    "_meta": {
      "title": "Actual Scene Description"
    }
  },
  "349": {
    "inputs": {
      "clip_l": [
        "307",
        0
      ],
      "t5xxl": [
        "307",
        0
      ],
      "guidance": 3.1,
      "clip": [
        "9",
        0
      ]
    },
    "class_type": "CLIPTextEncodeFlux",
    "_meta": {
      "title": "CLIPTextEncodeFlux"
    }
  },
  "361": {
    "inputs": {
      "clip_l": "over exposed,ugly, depth of field ",
      "t5xxl": "over exposed,ugly, depth of field",
      "guidance": 3.1,
      "clip": [
        "9",
        0
      ]
    },
    "class_type": "CLIPTextEncodeFlux",
    "_meta": {
      "title": "CLIPTextEncodeFlux"
    }
  },
  "363": {
    "inputs": {
      "lora_name": "Samsung_UltraReal.safetensors",
      "strength_model": 0.6800000000000002,
      "model": [
        "249",
        0
      ]
    },
    "class_type": "LoraLoaderModelOnly",
    "_meta": {
      "title": "LoraLoaderModelOnly"
    }
  },
  "389": {
    "inputs": {
      "filename_prefix": "Output",
      "images": [
        "407",
        0
      ]
    },
    "class_type": "SaveImage",
    "_meta": {
      "title": "Save Image"
    }
  },
  "402": {
    "inputs": {
      "control_net_name": "fluxcontrolnetupscale.safetensors"
    },
    "class_type": "ControlNetLoader",
    "_meta": {
      "title": "Load ControlNet Model"
    }
  },
  "403": {
    "inputs": {
      "strength": 1.0000000000000002,
      "start_percent": 0,
      "end_percent": 1,
      "positive": [
        "349",
        0
      ],
      "negative": [
        "361",
        0
      ],
      "control_net": [
        "402",
        0
      ],
      "image": [
        "404",
        0
      ],
      "vae": [
        "10",
        0
      ]
    },
    "class_type": "ControlNetApplyAdvanced",
    "_meta": {
      "title": "Apply ControlNet"
    }
  },
  "404": {
    "inputs": {
      "image": "placeholder.png"
    },
    "class_type": "LoadImage",
    "_meta": {
      "title": "Load Image"
    }
  },
  "407": {
    "inputs": {
      "upscale_by": 1.4000000000000004,
      "seed": 576355546919873,
      "steps": 20,
      "cfg": 1,
      "sampler_name": "euler",
      "scheduler": "normal",
      "denoise": 0.25000000000000006,
      "mode_type": "Linear",
      "tile_width": 1024,
      "tile_height": 1024,
      "mask_blur": 8,
      "tile_padding": 32,
      "seam_fix_mode": "None",
      "seam_fix_denoise": 1,
      "seam_fix_width": 64,
      "seam_fix_mask_blur": 8,
      "seam_fix_padding": 16,
      "force_uniform_tiles": true,
      "tiled_decode": false,
      "image": [
        "404",
        0
      ],
      "model": [
        "363",
        0
      ],
      "positive": [
        "403",
        0
      ],
      "negative": [
        "403",
        1
      ],
      "vae": [
        "10",
        0
      ],
      "upscale_model": [
        "408",
        0
      ],
      "custom_sampler": [
        "20",
        0
      ],
      "custom_sigmas": [
        "409",
        0
      ]
    },
    "class_type": "UltimateSDUpscaleCustomSample",
    "_meta": {
      "title": "Ultimate SD Upscale (Custom Sample)"
    }
  },
  "408": {
    "inputs": {
      "model_name": "4x-UltraSharp.pth"
    },
    "class_type": "UpscaleModelLoader",
    "_meta": {
      "title": "Load Upscale Model"
    }
  },
  "409": {
    "inputs": {
      "scheduler": "normal",
      "steps": 20,
      "denoise": 0.25000000000000006,
      "model": [
        "363",
        0
      ]
    },
    "class_type": "BasicScheduler",
    "_meta": {
      "title": "BasicScheduler"
    }
  }
}
`;

const Developer = () => {
  const { supabase, session } = useSession();
  const { t } = useLanguage();
  const [isDevAuthenticated, setIsDevAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const channelRef = useRef<RealtimeChannel | null>(null);

  // ComfyUI State
  const [comfyAddress, setComfyAddress] = useState("https://your-ngrok-or-public-url.io");
  const [activeJob, setActiveJob] = useState<ComfyJob | null>(null);
  const [comfyPrompt, setComfyPrompt] = useState("");
  const [sourceImage, setSourceImage] = useState<File | null>(null);

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
    console.log("[DevPage] handleQueuePrompt started.");
    if (!session?.user) return showError("You must be logged in to queue a job.");
    const invokerUserId = session.user.id;
    if (!sourceImage) return showError("A source image is required for this workflow.");
    if (!comfyPrompt.trim()) return showError("A prompt is required for this workflow.");

    setActiveJob({ id: '', status: 'queued' });
    let toastId = showLoading("Uploading source image...");
    console.log("[DevPage] Step 1: Uploading source image...");

    try {
      const uploadFormData = new FormData();
      uploadFormData.append('image', sourceImage);
      uploadFormData.append('comfyui_address', comfyAddress);
      
      const { data: uploadResult, error: uploadError } = await supabase.functions.invoke('MIRA-AGENT-proxy-comfyui-upload', {
          body: uploadFormData
      });

      if (uploadError) throw new Error(`Image upload failed: ${uploadError.message}`);
      const uploadedFilename = uploadResult.name;
      if (!uploadedFilename) throw new Error("ComfyUI did not return a filename for the uploaded image.");
      console.log(`[DevPage] Step 1 complete. Uploaded filename: ${uploadedFilename}`);
      
      dismissToast(toastId);
      toastId = showLoading("Injecting inputs into workflow...");
      console.log("[DevPage] Step 2: Populating workflow template...");

      let finalWorkflow = JSON.parse(workflowTemplate);
      
      // Inject filename into LoadImage node (404)
      if (finalWorkflow['404']) {
          finalWorkflow['404'].inputs.image = uploadedFilename;
      } else {
          throw new Error("Could not find the LoadImage node (404) in the workflow template.");
      }

      // Inject prompt into String node (307)
      if (finalWorkflow['307']) {
          finalWorkflow['307'].inputs.String = comfyPrompt;
      } else {
          throw new Error("Could not find the Prompt node (307) in the workflow template.");
      }
      console.log("[DevPage] Step 2 complete. Final workflow populated.");
      console.log("[DevPage] Final workflow being sent:", JSON.stringify(finalWorkflow, null, 2));


      dismissToast(toastId);
      toastId = showLoading("Sending prompt to ComfyUI...");
      console.log("[DevPage] Step 3: Queuing prompt via proxy...");

      const { data, error } = await supabase.functions.invoke('MIRA-AGENT-proxy-comfyui', {
        body: {
          comfyui_address: comfyAddress,
          prompt_workflow: finalWorkflow,
          invoker_user_id: invokerUserId
        }
      });

      if (error) throw error;
      
      const { jobId } = data;
      if (!jobId) throw new Error("Did not receive a job ID from the server.");
      console.log(`[DevPage] Step 3 complete. Received ComfyUI job ID: ${jobId}`);
      
      dismissToast(toastId);
      showSuccess("ComfyUI job queued. Waiting for result...");
      setActiveJob({ id: jobId, status: 'queued' });

      console.log(`[DevPage] Step 4: Subscribing to Realtime updates for job ${jobId}`);
      if (channelRef.current) supabase.removeChannel(channelRef.current);

      channelRef.current = supabase.channel(`comfyui-job-${jobId}`)
        .on<ComfyJob>(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'mira-agent-comfyui-jobs', filter: `id=eq.${jobId}` },
          (payload) => {
            console.log('[DevPage] Realtime update received:', payload.new);
            setActiveJob(payload.new as ComfyJob);
            if (payload.new.status === 'complete' || payload.new.status === 'failed') {
              console.log(`[DevPage] Job ${jobId} finished. Unsubscribing from Realtime channel.`);
              supabase.removeChannel(channelRef.current!);
              channelRef.current = null;
            }
          }
        )
        .subscribe((status, err) => {
            if (status === 'SUBSCRIBED') {
                console.log(`[DevPage] Successfully subscribed to Realtime channel for job ${jobId}.`);
            }
            if (err) {
                console.error(`[DevPage] Realtime subscription error for job ${jobId}:`, err);
            }
        });

    } catch (err: any) {
      setActiveJob(null);
      showError(`Failed to queue prompt: ${err.message}`);
      console.error("[DevPage] Error in handleQueuePrompt:", err);
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