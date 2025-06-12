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

const Developer = () => {
  const { supabase } = useSession();
  const { t } = useLanguage();
  const [isDevAuthenticated, setIsDevAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ComfyUI State
  const [comfyAddress, setComfyAddress] = useState("https://your-ngrok-or-public-url.io");
  const [workflowJson, setWorkflowJson] = useState("");
  const [comfyResponse, setComfyResponse] = useState("");
  const [isQueueing, setIsQueueing] = useState(false);

  useEffect(() => {
    const devAuthStatus = sessionStorage.getItem('dev_authenticated') === 'true';
    console.log(`[DeveloperPage] Initializing. Dev authenticated: ${devAuthStatus}`);
    if (devAuthStatus) {
      setIsDevAuthenticated(true);
    }
  }, []);

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    console.log("[DeveloperPage] Attempting to verify developer password.");
    const toastId = showLoading("Verifying password...");
    try {
      const { data, error } = await supabase.functions.invoke('MIRA-AGENT-verify-dev-pass', {
        body: { password }
      });

      if (error) throw error;

      if (data.success) {
        console.log("[DeveloperPage] Password verification successful.");
        sessionStorage.setItem('dev_authenticated', 'true');
        setIsDevAuthenticated(true);
        showSuccess("Access granted.");
      } else {
        console.warn("[DeveloperPage] Password verification failed.");
        showError("Incorrect password.");
      }
    } catch (err: any) {
      console.error("[DeveloperPage] Error during password verification:", err);
      showError(err.message);
    } finally {
      dismissToast(toastId);
      setIsLoading(false);
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.type === "application/json") {
      console.log(`[DeveloperPage] Reading workflow from file: ${file.name}`);
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result;
        if (typeof text === 'string') {
          setWorkflowJson(text);
          showSuccess("Workflow JSON loaded from file.");
        }
      };
      reader.onerror = (e) => {
        console.error("[DeveloperPage] Error reading file:", e);
        showError("Failed to read the JSON file.");
      }
      reader.readAsText(file);
    } else {
      showError("Please upload a valid JSON file.");
    }
  };

  const handleQueuePrompt = async () => {
    console.log("[DeveloperPage] handleQueuePrompt triggered.");
    let parsedWorkflow;
    try {
      parsedWorkflow = JSON.parse(workflowJson);
      console.log("[DeveloperPage] Workflow JSON parsed successfully.");
    } catch (e) {
      console.error("[DeveloperPage] Invalid Workflow API JSON:", e);
      showError("Invalid Workflow API JSON.");
      return;
    }

    setIsQueueing(true);
    setComfyResponse("");
    const toastId = showLoading("Sending prompt to ComfyUI...");
    console.log(`[DeveloperPage] Sending request to ComfyUI proxy at address: ${comfyAddress}`);
    try {
      const { data, error } = await supabase.functions.invoke('MIRA-AGENT-proxy-comfyui', {
        body: {
          comfyui_address: comfyAddress,
          prompt_workflow: parsedWorkflow
        }
      });

      if (error) throw error;
      
      console.log("[DeveloperPage] Received successful response from ComfyUI proxy:", data);
      setComfyResponse(JSON.stringify(data, null, 2));
      showSuccess("ComfyUI job queued successfully.");

    } catch (err: any) {
      console.error("[DeveloperPage] Error queueing prompt:", err);
      setComfyResponse(`Error: ${err.message}`);
      showError(`Failed to queue prompt: ${err.message}`);
    } finally {
      dismissToast(toastId);
      setIsQueueing(false);
    }
  };

  if (!isDevAuthenticated) {
    return (
      <div className="flex items-center justify-center h-full">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>{t.enterDeveloperPassword}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              <div>
                <Label htmlFor="dev-password">Password</Label>
                <Input
                  id="dev-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
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
      <Card>
        <CardHeader>
          <CardTitle>{t.comfyUIWorkflowTester}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="comfy-address">{t.comfyUIServerAddress}</Label>
            <Input
              id="comfy-address"
              value={comfyAddress}
              onChange={(e) => setComfyAddress(e.target.value)}
            />
             <p className="text-xs text-muted-foreground mt-1">
              {t.comfyUIAddressDescription}
            </p>
          </div>
          <div>
            <div className="flex justify-between items-center mb-2">
              <Label htmlFor="workflow-json">{t.workflowAPIData}</Label>
              <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                <Upload className="mr-2 h-4 w-4" />
                {t.uploadWorkflow}
              </Button>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileUpload}
                className="hidden"
                accept=".json"
              />
            </div>
            <Textarea
              id="workflow-json"
              value={workflowJson}
              onChange={(e) => setWorkflowJson(e.target.value)}
              placeholder='Paste your ComfyUI "API format" JSON here or upload a file...'
              rows={15}
              className="font-mono text-sm"
            />
          </div>
          <Button onClick={handleQueuePrompt} disabled={isQueueing}>
            {isQueueing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t.queuePrompt}
          </Button>
          <div>
            <Label htmlFor="comfy-response">{t.response}</Label>
            <Textarea
              id="comfy-response"
              value={comfyResponse}
              readOnly
              placeholder="Response from ComfyUI will appear here..."
              rows={10}
              className="font-mono text-sm bg-muted"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Developer;