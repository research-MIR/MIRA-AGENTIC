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
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import { PlusCircle, Trash2 } from "lucide-react";
import { optimizeImage } from "@/lib/utils";

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

function assembleCreativeProcessResult(history: any[]): any {
    const iterations: any[] = [];
    let currentIteration: any = {};

    for (const turn of history) {
        if (turn.role === 'function') {
            const callName = turn.parts[0]?.functionResponse?.name;
            const response = turn.parts[0]?.functionResponse?.response;

            if (!callName || !response) continue;

            switch (callName) {
                case 'dispatch_to_artisan_engine':
                    if (Object.keys(currentIteration).length > 0) {
                        iterations.push(currentIteration);
                    }
                    currentIteration = { artisan_result: response };
                    break;
                case 'generate_image':
                case 'generate_image_with_reference':
                    if (currentIteration.initial_generation_result) {
                        currentIteration.refined_generation_result = { toolName: callName, response };
                    } else {
                        currentIteration.initial_generation_result = { toolName: callName, response };
                    }
                    break;
                case 'critique_images':
                    currentIteration.critique_result = response;
                    break;
            }
        }
    }

    if (Object.keys(currentIteration).length > 0) {
        iterations.push(currentIteration);
    }

    if (iterations.length === 0) {
        return null;
    }

    const lastIteration = iterations[iterations.length - 1];
    const final_generation_result = lastIteration.refined_generation_result || lastIteration.initial_generation_result;

    return {
        isCreativeProcess: true,
        iterations: iterations,
        final_generation_result: final_generation_result,
    };
}

const parseHistoryToMessages = (jobData: any): Message[] => {
    const history = jobData?.context?.history;
    const messages: Message[] = [];
    if (!history) return messages;

    let creativeProcessBuffer: any[] = [];

    const flushCreativeProcessBuffer = () => {
        if (creativeProcessBuffer.length > 0) {
            const lastIteration = creativeProcessBuffer[creativeProcessBuffer.length - 1];
            const finalGeneration = lastIteration.refined_generation_result || lastIteration.initial_generation_result;

            messages.push({
                from: 'bot',
                creativeProcessResponse: {
                    isCreativeProcess: true,
                    iterations: [...creativeProcessBuffer],
                    final_generation_result: finalGeneration,
                }
            });
            creativeProcessBuffer = [];
        }
    };

    for (let i = 0; i < history.length; i++) {
        const turn = history[i];

        if (turn.role === 'user' || (turn.role === 'model' && turn.parts[0]?.text)) {
            flushCreativeProcessBuffer();
            const message: Message = { from: turn.role, imageUrls: [] };
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

            if (callName === 'finish_task') {
                flushCreativeProcessBuffer();
                const result = response;
                if (result.isCreativeProcess) {
                    if (result.text) {
                        messages.push({ from: 'bot', text: result.text });
                    }
                } else if (result.text) {
                    messages.push({ from: 'bot', text: result.text });
                }
                if (result.follow_up_message) {
                    messages.push({ from: 'bot', text: result.follow_up_message });
                }
            } else if (callName === 'dispatch_to_artisan_engine') {
                flushCreativeProcessBuffer();
                creativeProcessBuffer.push({ artisan_result: response });
            } else if (callName === 'generate_image' || callName === 'generate_image_with_reference') {
                if (creativeProcessBuffer.length > 0) {
                    const currentIteration = creativeProcessBuffer[creativeProcessBuffer.length - 1];
                    if (!currentIteration.initial_generation_result) {
                        currentIteration.initial_generation_result = { toolName: callName, response };
                    } else {
                        currentIteration.refined_generation_result = { toolName: callName, response };
                    }
                } else {
                    flushCreativeProcessBuffer();
                    messages.push({ from: 'bot', imageGenerationResponse: response });
                }
            } else if (callName === 'critique_images') {
                if (creativeProcessBuffer.length > 0) {
                    creativeProcessBuffer[creativeProcessBuffer.length - 1].critique_result = response;
                }
            } else {
                flushCreativeProcessBuffer();
                if (response.isImageChoiceProposal) {
                    const choiceMessage: Message = { from: 'bot', imageChoiceProposal: response };
                    const nextTurn = history[i + 1];
                    if (nextTurn && nextTurn.role === 'user' && nextTurn.parts[0]?.text?.startsWith("I choose image number")) {
                        const match = nextTurn.parts[0].text.match(/I choose image number (\d+)/);
                        if (match && match[1]) {
                            choiceMessage.imageChoiceSelectedIndex = parseInt(match[1], 10) - 1;
                            i++;
                        }
                    }
                    messages.push(choiceMessage);
                } else if (response.isBrandAnalysis) {
                    messages.push({ from: 'bot', brandAnalysisResponse: response });
                } else if (response.isRefinementProposal) {
                    messages.push({ from: 'bot', refinementProposal: response });
                }
            }
        }
    }
    
    flushCreativeProcessBuffer();

    // Fallback logic for completed jobs, now runs regardless of status
    const lastMessage = messages[messages.length - 1];
    if (lastMessage && !lastMessage.creativeProcessResponse) {
        const creativeResult = assembleCreativeProcessResult(history);
        if (creativeResult) {
            while (messages.length > 0 && messages[messages.length - 1].text) {
                messages.pop();
            }
            messages.push({
                from: 'bot',
                creativeProcessResponse: creativeResult
            });
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
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

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
    
    let isRunning = jobData.status === 'processing' || jobData.status === 'awaiting_refinement';

    setChatTitle(jobData.original_prompt || "Untitled Chat");
    if (jobData.context?.isDesignerMode !== undefined) setIsDesignerMode(jobData.context.isDesignerMode);
    if (jobData.context?.selectedModelId) setSelectedModelId(jobData.context.selectedModelId);
    if (jobData.context?.ratioMode) setRatioMode(jobData.context.ratioMode);
    if (jobData.context?.numImagesMode) setNumImagesMode(jobData.context.numImagesMode);

    let conversationMessages = parseHistoryToMessages(jobData);
    
    const lastParsedMessage = conversationMessages[conversationMessages.length - 1];
    if (isRunning && lastParsedMessage?.creativeProcessResponse) {
        console.log("[ProcessJobData] Overriding 'running' status because a final creative card was assembled.");
        isRunning = false;
    }

    if (!isRunning) {
        setIsSending(false);
    }
    setIsJobRunning(isRunning);
    
    if (isRunning) {
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
  }, []);

  const fetchChatJob = async (jobId: string | undefined) => {
    if (!jobId || !session?.user) return null;
    const { data, error } = await supabase.from("mira-agent-jobs").select("*").eq("id", jobId).eq("user_id", session.user.id).single();
    if (error) {
        if (error.code === 'PGRST116') {
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
    }
  }, [jobId, jobData, processJobData, t.newChat]);

  useEffect(() => {
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

    return () => {
      supabase.removeChannel(channel);
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

  const handleDeleteChat = useCallback(async () => {
    if (!jobId) return;
    const toastId = showLoading("Deleting chat...");
    try {
      const { error } = await supabase.rpc('delete_mira_agent_job', { p_job_id: jobId });
      if (error) throw error;
      dismissToast(toastId);
      showSuccess(t.chatDeleted);
      await queryClient.invalidateQueries({ queryKey: ["jobHistory"] });
      navigate("/chat");
    } catch (error: any) {
      dismissToast(toastId);
      showError(`${t.errorDeletingChat}: ${error.message}`);
    }
  }, [jobId, supabase, navigate, queryClient, t]);

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
          {jobId && (
            <>
              <AlertDialog>
                <AlertDialogTrigger asChild><Button variant="destructive" size="icon" title={t.deleteChat}><Trash2 className="h-4 w-4" /></Button></AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader><AlertDialogTitle>{t.deleteConfirmationTitle}</AlertDialogTitle><AlertDialogDescription>{t.deleteConfirmationDescription}</AlertDialogDescription></AlertDialogHeader>
                  <AlertDialogFooter><AlertDialogCancel>{t.cancel}</AlertDialogCancel><AlertDialogAction onClick={handleDeleteChat}>{t.delete}</AlertDialogAction></AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
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
      </div>
    </div>
  );
};

export default Index;