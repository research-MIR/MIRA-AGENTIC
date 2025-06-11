import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Send, User, Bot, Paperclip, X, PlusCircle, Copy } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { showError, showSuccess, showLoading, dismissToast } from "@/utils/toast";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FileDropzone } from "@/components/FileDropzone";
import { ArtisanEngineResponse } from "@/components/ArtisanEngineResponse";
import { BrandAnalyzerResponse } from "@/components/BrandAnalyzerResponse";
import { JobStatusCard } from "@/components/JobStatusCard";
import { ImageGenerationResponse } from "@/components/ImageGenerationResponse";
import { CreativeProcessResponse } from "@/components/CreativeProcessResponse";
import { RealtimeChannel } from "@supabase/supabase-js";
import { ModelSelector } from "@/components/ModelSelector";
import { useParams, useNavigate } from "react-router-dom";
import { useImagePreview } from "@/context/ImagePreviewContext";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ThemeToggle } from "@/components/ThemeToggle";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

// --- Type Definitions ---
interface ImageResult {
  publicUrl: string;
  storagePath: string;
}

interface ImageAnalysis {
  image_description: string;
  lighting_style: string;
  photography_style: string;
  composition_and_setup: string;
}

interface BrandAnalysisData {
  isBrandAnalysis: boolean;
  brand_name: string;
  website_analysis?: { url: string; analysis: { dominant_colors: string[]; image_analysis: ImageAnalysis[]; synthesis: string; }; };
  social_media_analysis?: { url: string; analysis: { dominant_colors: string[]; image_analysis: ImageAnalysis[]; synthesis: string; }; };
  combined_synthesis: string;
  follow_up_message?: string;
}

interface ArtisanResponseData {
  isArtisanResponse: boolean;
  version: number;
  analysis: { [key: string]: string };
  prompt: string;
  rationale: string;
  follow_up_message?: string;
}

interface ImageGenerationData {
    isImageGeneration: true;
    images: ImageResult[];
    follow_up_message?: string;
}

interface CreativeProcessData {
    isCreativeProcess: true;
    iterations: any[];
    final_generation_result: any;
    follow_up_message?: string;
}

interface Message {
  from: "bot" | "user";
  jobId?: string;
  text?: string;
  imageUrls?: string[];
  artisanResponse?: ArtisanResponseData;
  brandAnalysisResponse?: BrandAnalysisData;
  imageGenerationResponse?: ImageGenerationData;
  creativeProcessResponse?: CreativeProcessData;
  jobInProgress?: { jobId: string; message: string; };
}

interface UploadedFile {
  name: string;
  path: string;
  previewUrl: string;
  isImage: boolean;
}

const sanitizeFilename = (filename: string): string => {
  return filename
    .replace(/[^a-zA-Z0-9_.-]/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/\.{2,}/g, '.');
};

const parseHistoryToMessages = (history: any[], finalResult: any): Message[] => {
    const messages: Message[] = [];
    if (!history) return messages;

    let creativeProcessBuffer: any[] = [];
    let isCreativeProcessComplete = finalResult?.isCreativeProcess;

    const flushCreativeProcessBuffer = () => {
        if (creativeProcessBuffer.length > 0) {
            const lastIterationWithRefinement = [...creativeProcessBuffer].reverse().find(it => it.refined_generation_result);
            const finalGeneration = lastIterationWithRefinement 
                ? lastIterationWithRefinement.refined_generation_result 
                : [...creativeProcessBuffer].reverse().find(it => it.initial_generation_result)?.initial_generation_result;
            
            messages.push({
                from: 'bot',
                creativeProcessResponse: {
                    isCreativeProcess: true,
                    iterations: creativeProcessBuffer,
                    final_generation_result: finalGeneration,
                }
            });
            creativeProcessBuffer = [];
        }
    };

    for (const turn of history) {
        if (turn.role === 'user') {
            flushCreativeProcessBuffer();
            const userMessage: Message = { from: 'user', imageUrls: [] };
            const textPart = turn.parts.find((p: any) => p.text);
            const imageParts = turn.parts.filter((p: any) => p.inlineData);

            if (textPart) userMessage.text = textPart.text;
            if (imageParts.length > 0) {
                userMessage.imageUrls = imageParts.map((p: any) => `data:${p.inlineData.mimeType};base64,${p.inlineData.data}`);
            }
            if (userMessage.text || (userMessage.imageUrls && userMessage.imageUrls.length > 0)) {
                messages.push(userMessage);
            }
        } else if (turn.role === 'model') {
            const textPart = turn.parts.find((p: any) => p.text);
            if (textPart && textPart.text) {
                flushCreativeProcessBuffer();
                messages.push({ from: 'bot', text: textPart.text });
            }
        } else if (turn.role === 'function') {
            const response = turn.parts[0]?.functionResponse?.response;
            const name = turn.parts[0]?.functionResponse?.name;

            if (response) {
                if (name === 'dispatch_to_artisan_engine') {
                    if (creativeProcessBuffer.length > 0) flushCreativeProcessBuffer();
                    creativeProcessBuffer.push({ artisan_result: response });
                } else if (['generate_image', 'generate_image_with_reference'].includes(name)) {
                    if (creativeProcessBuffer.length > 0) {
                       const lastIteration = creativeProcessBuffer[creativeProcessBuffer.length - 1];
                       lastIteration.initial_generation_result = { toolName: name, response: response };
                    }
                } else if (name === 'fal_image_to_image') {
                    if (creativeProcessBuffer.length > 0) {
                       const lastIteration = creativeProcessBuffer[creativeProcessBuffer.length - 1];
                       lastIteration.refined_generation_result = { toolName: name, response: response };
                    }
                } else if (name === 'critique_images') {
                    if (creativeProcessBuffer.length > 0) {
                        const lastIteration = creativeProcessBuffer[creativeProcessBuffer.length - 1];
                        lastIteration.critique_result = response;
                        if (response.is_good_enough === false) {
                            flushCreativeProcessBuffer();
                        }
                    }
                } else if (response.isBrandAnalysis) {
                    flushCreativeProcessBuffer();
                    messages.push({ from: 'bot', brandAnalysisResponse: response });
                }
            }
        }
    }
    
    if (isCreativeProcessComplete) {
        flushCreativeProcessBuffer();
    }
    
    return messages;
};


// --- Main Component ---
const Index = () => {
  const { supabase, session } = useSession();
  const { jobId } = useParams();
  const navigate = useNavigate();
  const { showImage } = useImagePreview();
  
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatTitle, setChatTitle] = useState<string>("New Chat");
  const [input, setInput] = useState("");
  const [isPageLoading, setIsPageLoading] = useState(true);
  const [isJobRunning, setIsJobRunning] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [isDesignerMode, setIsDesignerMode] = useState(false);
  const [pipelineMode, setPipelineMode] = useState<'auto' | 'on' | 'off'>('auto');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollAreaRef = useRef<any>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const resetChatState = () => {
    setMessages([{ from: "bot", text: "Hello! How can I help you today?" }]);
    setChatTitle("New Chat");
    setInput("");
    setUploadedFiles([]);
    setIsPageLoading(false);
    setIsJobRunning(false);
    setIsSending(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (channelRef.current) {
      channelRef.current.unsubscribe();
      channelRef.current = null;
    }
  };

  const processJobData = (jobData: any) => {
    if (!jobData) return;

    setIsJobRunning(jobData.status === 'processing');

    setChatTitle(jobData.original_prompt || "Untitled Chat");
    if (jobData.context?.isDesignerMode !== undefined) {
      setIsDesignerMode(jobData.context.isDesignerMode);
    }
    if (jobData.context?.pipelineMode) {
      setPipelineMode(jobData.context.pipelineMode);
    }
    if (jobData.context?.selectedModelId) {
      setSelectedModelId(jobData.context.selectedModelId);
    }

    let conversationMessages = parseHistoryToMessages(jobData.context?.history, jobData.final_result);

    if (jobData.status === 'complete' || jobData.status === 'awaiting_feedback') {
        const result = jobData.final_result;
        if (result && !result.isCreativeProcess) {
            if (result.text) {
                conversationMessages.push({ from: 'bot', text: result.text });
            }
            if (result.follow_up_message) {
                conversationMessages.push({ from: 'bot', text: result.follow_up_message });
            }
        }
    } else if (jobData.status === 'processing') {
        conversationMessages.push({ from: 'bot', jobInProgress: { jobId: jobData.id, message: 'This job is in progress...' } });
    } else if (jobData.status === 'failed') {
        conversationMessages.push({ from: 'bot', text: `I'm sorry, an error occurred: ${jobData.error_message}` });
    }
    
    setMessages(conversationMessages);
  };

  useEffect(() => {
    const loadChat = async () => {
      if (!jobId) {
        resetChatState();
        return;
      }
      if (!session?.user) return;
      
      setIsPageLoading(true);
      const toastId = showLoading("Loading chat history...");
      try {
        const { data, error } = await supabase
          .from("mira-agent-jobs")
          .select("id, original_prompt, context, status, final_result, error_message")
          .eq("id", jobId)
          .eq("user_id", session.user.id)
          .single();

        if (error || !data) {
          showError("Could not load chat history.");
          navigate("/chat");
          return;
        }
        
        processJobData(data);
        subscribeToJob(jobId);

      } catch (err) {
        console.error(`[UI][${jobId}] An unexpected error occurred in loadChat:`, err);
        showError("An error occurred while loading the chat.");
        navigate("/chat");
      } finally {
        dismissToast(toastId);
        setIsPageLoading(false);
      }
    };

    loadChat();
    
    return () => {
        if (channelRef.current) {
            channelRef.current.unsubscribe();
            channelRef.current = null;
        }
    }
  }, [jobId, session, supabase, navigate]);

  const subscribeToJob = (jobIdToWatch: string) => {
    if (channelRef.current) channelRef.current.unsubscribe();
    
    const channel = supabase.channel(`job_${jobIdToWatch}`);
    channel.on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'mira-agent-jobs', filter: `id=eq.${jobIdToWatch}` },
      (payload) => {
        processJobData(payload.new);
      }
    ).subscribe();
    channelRef.current = channel;
  };

  const handleFileUpload = async (files: FileList | null): Promise<UploadedFile[]> => {
    if (!files || files.length === 0) return [];
    const toastId = showLoading(`Uploading ${files.length} file(s)...`);
    try {
      const uploadPromises = Array.from(files).map(file => {
        const fileExt = file.name.split('.').pop()?.toLowerCase();
        const sanitized = sanitizeFilename(file.name);
        const filePath = `${session?.user.id}/${Date.now()}-${sanitized}`;
        return supabase.storage.from('mira-agent-user-uploads').upload(filePath, file).then(({ error }) => {
          if (error) throw error;
          const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(fileExt || '');
          const previewUrl = isImage ? URL.createObjectURL(file) : '';
          return { name: file.name, path: filePath, previewUrl, isImage };
        });
      });
      const newFiles = await Promise.all(uploadPromises);
      dismissToast(toastId);
      showSuccess(`${files.length} file(s) uploaded successfully!`);
      return newFiles;
    } catch (error: any) {
      dismissToast(toastId);
      showError("Upload failed: " + error.message);
      return [];
    }
  };

  useEffect(() => {
    if (scrollAreaRef.current?.viewport) {
      scrollAreaRef.current.viewport.scrollTop = scrollAreaRef.current.viewport.scrollHeight;
    }
  }, [messages]);

  const handleSendMessage = async () => {
    if ((!input.trim() && uploadedFiles.length === 0) || isJobRunning || isSending) return;

    let currentInput = input;
    if (!currentInput.trim() && uploadedFiles.length > 0) currentInput = "Please analyze the attached file(s).";
    
    const filesToProcess = [...uploadedFiles];

    setInput("");
    setUploadedFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setIsSending(true);

    try {
        const payload = { 
            jobId: jobId, 
            prompt: currentInput, 
            storagePaths: filesToProcess.map(f => f.path), 
            userId: session?.user.id,
            isDesignerMode: isDesignerMode,
            pipelineMode: pipelineMode,
            selectedModelId: selectedModelId
        };
        if (!payload.userId) throw new Error("User session not found. Please log in again.");

        if (jobId) {
            await supabase.functions.invoke("MIRA-AGENT-continue-job", { body: payload });
        } else {
            const { data, error } = await supabase.functions.invoke("MIRA-AGENT-master-worker", { body: payload });
            if (error) throw error;
            const newJobId = data.reply.jobId;
            navigate(`/chat/${newJobId}`);
        }
    } catch (error: any) {
      showError("Error communicating with Mira: " + error.message);
      setMessages(prev => [...prev, { from: 'bot', text: "Sorry, I'm having trouble connecting right now." }]);
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const removeFile = (path: string) => {
    setUploadedFiles(prev => prev.filter(f => f.path !== path));
  };

  return (
    <div className="flex flex-col h-screen relative">
      {isDragging && <FileDropzone onDrop={(files) => handleFileUpload(files).then(setUploadedFiles)} onDragStateChange={setIsDragging} />}
      
      <header className="border-b p-4 md:p-6 flex justify-between items-center shrink-0">
        <div>
          <h1 className="text-2xl font-bold truncate">{chatTitle}</h1>
          <p className="text-muted-foreground">Agent Interaction</p>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button id="new-chat-button" variant="outline" onClick={() => navigate("/chat")}>
            <PlusCircle className="mr-2 h-4 w-4" />
            New Chat
          </Button>
        </div>
      </header>

      <ScrollArea className="flex-1" ref={scrollAreaRef}>
        <div className="p-4 md:p-6 space-y-4">
          {messages.map((message, index) => (
            <div key={index} className={`flex items-start gap-3 ${message.from === "user" ? "justify-end" : ""}`}>
              {message.from === "bot" && !message.artisanResponse && !message.brandAnalysisResponse && !message.jobInProgress && !message.imageGenerationResponse && !message.creativeProcessResponse && <div className="p-2 bg-primary rounded-full text-primary-foreground self-start"><Bot size={20} /></div>}
              
              {message.jobInProgress ? (
                <JobStatusCard message={message.jobInProgress.message} />
              ) : message.creativeProcessResponse ? (
                <CreativeProcessResponse data={message.creativeProcessResponse} jobId={jobId} />
              ) : message.imageGenerationResponse ? (
                <ImageGenerationResponse data={message.imageGenerationResponse} jobId={jobId} />
              ) : message.artisanResponse ? (
                <div className="flex items-center gap-2">
                  <ArtisanEngineResponse data={message.artisanResponse} />
                  <Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(message.artisanResponse!.prompt); showSuccess("Prompt copied!"); }}><Copy className="h-4 w-4 mr-2" /> Copy</Button>
                </div>
              ) : message.brandAnalysisResponse ? (
                <BrandAnalyzerResponse data={message.brandAnalysisResponse} />
              ) : (
                <Card className={`max-w-lg ${message.from === "user" ? "bg-primary text-primary-foreground" : "bg-secondary"}`}>
                  <CardContent className="p-3">
                    {message.imageUrls && message.imageUrls.length > 0 && (
                      <div className="grid grid-cols-2 gap-2 mb-2">
                        {message.imageUrls.map((url, i) => (
                          <button key={i} onClick={() => showImage({ url, jobId })} className="block w-full h-full">
                              <img src={url} alt={`User upload ${i+1}`} className="rounded-md max-w-full" />
                          </button>
                        ))}
                      </div>
                    )}
                    {message.text && <div className="markdown-content"><ReactMarkdown remarkPlugins={[remarkGfm]}>{message.text}</ReactMarkdown></div>}
                  </CardContent>
                </Card>
              )}

              {message.from === "user" && <div className="p-2 bg-secondary rounded-full text-secondary-foreground self-start"><User size={20} /></div>}
            </div>
          ))}
        </div>
      </ScrollArea>

      <div className="border-t p-4 md:p-6 space-y-2 shrink-0">
          <div className="flex items-center space-x-4">
              <div id="model-selector">
                <ModelSelector selectedModelId={selectedModelId} onModelChange={setSelectedModelId} disabled={!!jobId} />
              </div>
              <div id="designer-mode-switch" className="flex items-center space-x-2">
                  <Switch id="designer-mode" checked={isDesignerMode} onCheckedChange={setIsDesignerMode} />
                  <Label htmlFor="designer-mode">Designer Mode</Label>
              </div>
              <div id="pipeline-mode-radiogroup">
                <Label className="text-sm font-medium">Pipeline Mode</Label>
                <RadioGroup value={pipelineMode} onValueChange={(v) => setPipelineMode(v as any)} className="flex items-center space-x-4 mt-1">
                    <div className="flex items-center space-x-1">
                        <RadioGroupItem value="auto" id="auto" />
                        <Label htmlFor="auto" className="text-sm font-normal">Auto</Label>
                    </div>
                    <div className="flex items-center space-x-1">
                        <RadioGroupItem value="on" id="on" />
                        <Label htmlFor="on" className="text-sm font-normal">On</Label>
                    </div>
                    <div className="flex items-center space-x-1">
                        <RadioGroupItem value="off" id="off" />
                        <Label htmlFor="off" className="text-sm font-normal">Off</Label>
                    </div>
                </RadioGroup>
              </div>
          </div>
          <div className="flex items-start gap-2">
            <div id="file-upload-button">
              <input type="file" ref={fileInputRef} onChange={(e) => handleFileUpload(e.target.files).then(newFiles => setUploadedFiles(prev => [...prev, ...newFiles]))} className="hidden" id="file-upload" multiple />
              <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}><Paperclip className="h-4 w-4" /></Button>
            </div>
            <div id="prompt-input-area" className="flex-1 relative min-w-0">
                <Textarea 
                  value={input} 
                  onChange={(e) => setInput(e.target.value)} 
                  onKeyDown={handleKeyDown}
                  placeholder="Ask about the file(s) or type a message... (Shift+Enter to send)" 
                  className="pr-4 min-h-[40px] max-h-40"
                  rows={1}
                />
                {uploadedFiles.length > 0 && (
                <div className="absolute right-2 top-2 flex items-center gap-2 bg-muted p-1 rounded-md text-sm max-w-[50%]">
                      <div className="flex gap-2 overflow-x-auto p-1">
                      {uploadedFiles.map(file => (
                      <div key={file.path} className="relative flex-shrink-0">
                          {file.isImage ? <img src={file.previewUrl} alt="Preview" className="h-6 w-6 rounded object-cover" /> : <div className="h-6 w-6 bg-secondary rounded flex items-center justify-center"><Paperclip className="h-4 w-4 text-muted-foreground"/></div>}
                          <button type="button" onClick={() => removeFile(file.path)} className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-0.5 h-4 w-4 flex items-center justify-center">
                          <X className="h-2 w-2" />
                          </button>
                      </div>
                      ))}
                      </div>
                  </div>
                )}
            </div>
            <div id="send-button">
              <Button type="button" onClick={handleSendMessage} disabled={isJobRunning || isSending}><Send className="h-4 w-4" /><span className="sr-only">Send</span></Button>
            </div>
          </div>
      </div>
    </div>
  );
};

export default Index;