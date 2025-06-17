import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { showError, showSuccess, showLoading, dismissToast } from "@/utils/toast";
import { FileDropzone } from "@/components/FileDropzone";
import { RealtimeChannel } from "@supabase/supabase-js";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ControlPanel } from "@/components/Chat/ControlPanel";
import { PromptInput } from "@/components/Chat/PromptInput";
import { MessageList, Message } from "@/components/Chat/MessageList";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import { PlusCircle } from "lucide-react";
import { optimizeImage } from "@/lib/utils";
import { BranchPrompt } from "@/components/Chat/BranchPrompt";

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

const parseHistoryToMessages = (jobData: any): Message[] => {
    const history = jobData?.context?.history;
    const messages: Message[] = [];
    if (!history) return messages;

    for (let i = 0; i < history.length; i++) {
        const turn = history[i];
        const historyIndex = i;

        if (turn.role === 'user') {
            const message: Message = { from: 'user', imageUrls: [] };
            const textPart = turn.parts.find((p: any) => p.text);
            const imageParts = turn.parts.filter((p: any) => p.inlineData);

            if (textPart) message.text = textPart.text;
            if (imageParts.length > 0) {
                message.imageUrls = imageParts.map((p: any) => `data:${p.inlineData.mimeType};base64,${p.inlineData.data}`);
            }
            if (message.text || (message.imageUrls && message.imageUrls.length > 0)) {
                messages.push(message);
            }
            continue;
        }

        if (turn.role === 'function') {
            const response = turn.parts[0]?.functionResponse?.response;
            const callName = history[i - 1]?.parts[0]?.functionCall?.name;

            if (!response || !callName) continue;
            
            if (callName === 'finish_task') continue;

            const botMessage: Message = { from: 'bot', historyIndex };

            switch (callName) {
                case 'dispatch_to_artisan_engine':
                    botMessage.artisanResponse = response;
                    break;
                case 'generate_image':
                case 'generate_image_with_reference':
                    botMessage.imageGenerationResponse = response;
                    break;
                case 'dispatch_to_brand_analyzer':
                    botMessage.brandAnalysisResponse = response;
                    break;
                case 'present_image_choice':
                    botMessage.imageChoiceProposal = response;
                    const nextTurn = history[i + 1];
                    if (nextTurn && nextTurn.role === 'user' && nextTurn.parts[0]?.text?.startsWith("I choose image number")) {
                        const match = nextTurn.parts[0].text.match(/I choose image number (\d+)/);
                        if (match && match[1]) {
                            botMessage.imageChoiceSelectedIndex = parseInt(match[1], 10) - 1;
                            i++;
                        }
                    }
                    break;
                case 'critique_images':
                    // Don't render critique messages for now to keep UI clean
                    continue;
                default:
                    // Don't render unknown tool calls
                    continue;
            }
            messages.push(botMessage);
        }
    }
    return messages;
};


const Index = () => {
  const { supabase, session } = useSession();
  const { jobId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { t, language } = useLanguage();
  const queryClient = useQueryClient();
  
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatTitle, setChatTitle] = useState<string>(t.newChat);
  const [input, setInput] = useState("");
  const [isJobRunning, setIsJobRunning] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [isDesignerMode, setIsDesignerMode] = useState(false);
  const [ratioMode, setRatioMode] = useState<'auto' | string>('auto');
  const [numImagesMode, setNumImagesMode] = useState<'auto' | number>('auto');
  const [isOwner, setIsOwner] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSendMessage = useCallback(async (messageText?: string) => {
    const textToSend = messageText || input;
    const isSilent = textToSend.startsWith("I choose image number");

    if ((!textToSend.trim() && uploadedFiles.length === 0) || isJobRunning || isSending) {
      return;
    }
    
    const filesToProcess = [...uploadedFiles];

    if (!isSilent) {
      const optimisticMessage: Message = {
        from: 'user',
        text: textToSend,
        imageUrls: filesToProcess.map(f => f.previewUrl)
      };
      setMessages(prev => [...prev, optimisticMessage]);
    }

    setInput("");
    setUploadedFiles([]);
    setIsSending(true);

    try {
        const payload = { 
            jobId, 
            prompt: textToSend, 
            storagePaths: filesToProcess.map(f => f.path), 
            userId: session?.user.id, 
            isDesignerMode, 
            selectedModelId, 
            language, 
            ratioMode, 
            numImagesMode,
            isSilent
        };
        if (!payload.userId) throw new Error("User session not found.");
        
        if (jobId) {
            await supabase.functions.invoke("MIRA-AGENT-continue-job", { body: payload });
        } else {
            const { data: createData, error: createError } = await supabase.functions.invoke("MIRA-AGENT-create-job", { body: payload });
            if (createError) throw createError;
            
            const newJob = createData.newJob;
            if (!newJob || !newJob.id) throw new Error("Failed to create a new job.");

            queryClient.setQueryData(['chatJob', newJob.id], newJob);
            
            navigate(`/chat/${newJob.id}`);
        }
    } catch (error: any) {
      showError("Error communicating with Mira: " + error.message);
      setIsSending(false);
    }
  }, [input, uploadedFiles, isJobRunning, isSending, jobId, session, isDesignerMode, selectedModelId, language, ratioMode, numImagesMode, supabase, navigate, queryClient]);

  const processJobData = useCallback((jobData: any) => {
    if (!jobData) return;
    
    setIsOwner(jobData.user_id === session?.user?.id);
    setChatTitle(jobData.original_prompt || "Untitled Chat");
    if (jobData.context?.isDesignerMode !== undefined) setIsDesignerMode(jobData.context.isDesignerMode);
    if (jobData.context?.selectedModelId) setSelectedModelId(jobData.context.selectedModelId);
    if (jobData.context?.ratioMode) setRatioMode(jobData.context.ratioMode);
    if (jobData.context?.numImagesMode) setNumImagesMode(jobData.context.numImagesMode);

    let conversationMessages = parseHistoryToMessages(jobData);
    const isRunning = jobData.status === 'processing' || jobData.status === 'awaiting_refinement';

    setIsJobRunning(isRunning);
    if (!isRunning) {
        setIsSending(false);
    }
    
    if (jobData.status === 'complete') {
        const finalResult = jobData.final_result;
        if (finalResult?.isCreativeProcess) {
            conversationMessages.push({ from: 'bot', creativeProcessResponse: finalResult });
        } else if (finalResult?.isImageGeneration) {
            conversationMessages.push({ from: 'bot', imageGenerationResponse: finalResult });
        } else if (finalResult?.isBrandAnalysis) {
            conversationMessages.push({ from: 'bot', brandAnalysisResponse: finalResult });
        } else if (finalResult?.text) {
            conversationMessages.push({ from: 'bot', text: finalResult.text });
        }
    } else if (isRunning) {
        const message = jobData.status === 'processing' ? 'Thinking...' : 'Refining image in the background...';
        conversationMessages.push({ from: 'bot', jobInProgress: { jobId: jobData.id, message } });
    } else if (jobData.status === 'failed') {
        conversationMessages.push({ from: 'bot', text: jobData.error_message });
    } else if (jobData.status === 'awaiting_feedback') {
        if (jobData.final_result?.isImageChoiceProposal) {
            conversationMessages.push({ from: 'bot', imageChoiceProposal: jobData.final_result });
        } else if (jobData.final_result?.isRefinementProposal) {
            conversationMessages.push({ from: 'bot', refinementProposal: jobData.final_result });
        } else if (jobData.final_result?.text) {
            conversationMessages.push({ from: 'bot', text: jobData.final_result.text });
        }
    }
    
    setMessages(conversationMessages);
  }, [session?.user?.id]);

  const fetchChatJob = async (jobId: string | undefined) => {
    if (!jobId || !session?.user) return null;
    const { data, error } = await supabase.from("mira-agent-jobs").select("*").eq("id", jobId).single();
    if (error) {
        if (error.code === 'PGRST116') {
            showError("Chat not found or you don't have permission to view it.");
            navigate('/chat');
            return null;
        }
        throw new Error("Could not load chat history.");
    }
    return data;
  };

  const { data: jobData, error } = useQuery({
    queryKey: ['chatJob', jobId],
    queryFn: () => fetchChatJob(jobId),
    enabled: !!jobId,
    initialData: () => location.state?.initialJobData,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  useEffect(() => {
    if (jobId && jobData) {
      processJobData(jobData);
    } else if (!jobId) {
      setMessages([{ from: "bot", text: "Ciao! Come posso aiutarti oggi?" }]);
      setChatTitle(t.newChat);
      setInput("");
      setUploadedFiles([]);
      setIsJobRunning(false);
      setIsSending(false);
      setIsOwner(true);
    }
  }, [jobId, jobData, processJobData, t.newChat]);

  useEffect(() => {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    if (!jobId) return;

    const channel = supabase
      .channel(`job-updates-${jobId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'mira-agent-jobs', filter: `id=eq.${jobId}` },
        (payload) => {
          console.log('[Realtime] Job update received. Invalidating query cache to refetch.');
          queryClient.invalidateQueries({ queryKey: ['chatJob', jobId] });
        }
      )
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
            console.log(`[Realtime] Subscribed to job-updates-${jobId}`);
        }
        if (status === 'CHANNEL_ERROR') {
            console.error('[Realtime] Channel error:', err);
            showError(`Realtime connection failed: ${err?.message}`);
        }
      });
    
    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [jobId, supabase, queryClient]);

  useEffect(() => {
    if (error) {
      showError(error.message);
      navigate("/chat");
    }
  }, [error, navigate]);

  const handleFileUpload = useCallback(async (files: FileList | null): Promise<UploadedFile[]> => {
    if (!files || files.length === 0) return [];
    
    const validFiles: File[] = [];
    const invalidFiles: string[] = [];

    Array.from(files).forEach(file => {
      if (file.type.startsWith('video/') || file.type === 'image/avif') {
        invalidFiles.push(file.name);
      } else {
        validFiles.push(file);
      }
    });

    if (invalidFiles.length > 0) {
      showError(`Unsupported file type(s): ${invalidFiles.join(', ')}. AVIF and video formats are not allowed.`);
    }

    if (validFiles.length === 0) return [];

    const optimizationToastId = showLoading(`Optimizing ${validFiles.length} file(s)...`);
    
    try {
      const optimizationPromises = validFiles.map(file => {
        if (file.type.startsWith('image/')) {
          return optimizeImage(file);
        }
        return Promise.resolve(file); // Pass non-image files through
      });

      const optimizedFiles = await Promise.all(optimizationPromises);
      dismissToast(optimizationToastId);

      const uploadToastId = showLoading(`Uploading ${optimizedFiles.length} file(s)...`);
      
      const uploadPromises = optimizedFiles.map(file => {
        const sanitized = sanitizeFilename(file.name);
        const filePath = `${session?.user.id}/${Date.now()}-${sanitized}`;
        return supabase.storage.from('mira-agent-user-uploads').upload(filePath, file).then(({ error }) => {
          if (error) throw error;
          const isImage = file.type.startsWith('image/');
          const previewUrl = isImage ? URL.createObjectURL(file) : '';
          return { name: file.name, path: filePath, previewUrl, isImage };
        });
      });

      const newFiles = await Promise.all(uploadPromises);
      setUploadedFiles(prev => [...prev, ...newFiles]);
      dismissToast(uploadToastId);
      showSuccess(`${newFiles.length} file(s) uploaded successfully!`);
      return newFiles;

    } catch (error: any) {
      dismissToast(optimizationToastId);
      showError("Upload failed: " + error.message);
      return [];
    }
  }, [session, supabase]);

  const handleRefinementComplete = useCallback((newImageUrl: string) => {
    setMessages(prev => {
      const newMessages = prev.filter(m => !m.refinementProposal);
      newMessages.push({
        from: 'bot',
        refinementProposal: {
          summary: "REFINEMENT_FURTHER",
          options: [{ url: newImageUrl, jobId: jobId || '' }]
        }
      });
      return newMessages;
    });
  }, [jobId]);

  const handleBranch = useCallback(async (historyIndex: number) => {
    if (!jobId || !session?.user) return;
    const toastId = showLoading("Creating new branch...");
    try {
      const { data, error } = await supabase.functions.invoke('MIRA-AGENT-branch-job', {
        body: {
          source_job_id: jobId,
          history_index: historyIndex,
          invoker_user_id: session.user.id
        }
      });
      if (error) throw error;
      
      dismissToast(toastId);
      showSuccess("Branched chat created.");
      await queryClient.invalidateQueries({ queryKey: ["jobHistory"] });
      navigate(`/chat/${data.newJobId}`);

    } catch (err: any) {
      dismissToast(toastId);
      showError(`Failed to branch chat: ${err.message}`);
    }
  }, [jobId, session, supabase, navigate, queryClient]);

  const lastMessageWithHistory = [...messages].reverse().find(m => m.historyIndex !== undefined);
  const lastHistoryIndex = lastMessageWithHistory?.historyIndex;

  return (
    <div className="flex flex-col h-full relative" onDragEnter={() => setIsDragging(true)}>
      {isDragging && <FileDropzone onDrop={(files) => handleFileUpload(files)} onDragStateChange={setIsDragging} />}
      
      <header className="border-b p-4 md:p-6 flex justify-between items-center shrink-0">
        <div>
          <h1 className="text-2xl font-bold truncate">{jobId ? chatTitle : t.newChat}</h1>
          <p className="text-muted-foreground">{t.agentInteraction}</p>
        </div>
        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          <ThemeToggle />
          <Button id="new-chat-button" variant="outline" onClick={() => navigate("/chat")}><PlusCircle className="mr-2 h-4 w-4" />{t.newChat}</Button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="p-4 md:p-6 space-y-4">
            <MessageList messages={messages} jobId={jobId} onRefinementComplete={handleRefinementComplete} onSendMessage={handleSendMessage} />
            <div ref={messagesEndRef} />
        </div>
      </div>

      <div className="border-t shrink-0 sticky bottom-0 bg-background">
        <ControlPanel
          selectedModelId={selectedModelId}
          onModelChange={setSelectedModelId}
          isDesignerMode={isDesignerMode}
          onDesignerModeChange={setIsDesignerMode}
          ratioMode={ratioMode}
          onRatioModeChange={setRatioMode}
          numImagesMode={numImagesMode}
          onNumImagesModeChange={setNumImagesMode}
          isJobActive={!!jobId}
        />
        {isOwner ? (
          <PromptInput
            input={input}
            onInputChange={setInput}
            onFileUpload={handleFileUpload}
            uploadedFiles={uploadedFiles}
            onRemoveFile={(path) => setUploadedFiles(files => files.filter(f => f.path !== path))}
            isJobRunning={isJobRunning}
            isSending={isSending}
            onSendMessage={() => handleSendMessage()}
          />
        ) : (
          jobId && lastHistoryIndex !== undefined ? (
            <BranchPrompt onBranch={() => handleBranch(lastHistoryIndex)} />
          ) : null
        )}
      </div>
    </div>
  );
};

export default Index;