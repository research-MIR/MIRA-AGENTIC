import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { showError, showSuccess, showLoading, dismissToast } from "@/utils/toast";
import { FileDropzone } from "@/components/FileDropzone";
import { RealtimeChannel } from "@supabase/supabase-js";
import { useParams, useNavigate } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ControlPanel } from "@/components/Chat/ControlPanel";
import { PromptInput } from "@/components/Chat/PromptInput";
import { MessageList, Message } from "@/components/Chat/MessageList";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import { PlusCircle, Trash2 } from "lucide-react";
import { RefinementProposalCard } from "@/components/RefinementProposalCard";

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

const parseHistoryToMessages = (history: any[]): Message[] => {
    const messages: Message[] = [];
    if (!history) return messages;

    let creativeProcessBuffer: any[] = [];

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
                    iterations: [...creativeProcessBuffer],
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
                if (name === 'dispatch_to_refinement_agent' && response.isImageGeneration) {
                    flushCreativeProcessBuffer();
                    messages.push({ from: 'bot', imageGenerationResponse: response });
                    continue;
                }

                if (name === 'dispatch_to_artisan_engine') {
                    if (creativeProcessBuffer.length > 0) flushCreativeProcessBuffer();
                    creativeProcessBuffer.push({ artisan_result: response });
                } else if (['generate_image', 'generate_image_with_reference'].includes(name)) {
                    if (creativeProcessBuffer.length === 0) {
                        if (response.isImageGeneration) {
                            flushCreativeProcessBuffer();
                            messages.push({ from: 'bot', imageGenerationResponse: response });
                            continue;
                        }
                    }
                    const lastIteration = creativeProcessBuffer[creativeProcessBuffer.length - 1];
                    if (lastIteration) {
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
    
    flushCreativeProcessBuffer();
    
    return messages;
};

const Index = () => {
  const { supabase, session } = useSession();
  const { jobId } = useParams();
  const navigate = useNavigate();
  const { language, t } = useLanguage();
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

  const processJobData = useCallback((jobData: any) => {
    if (!jobData) return;
    setIsJobRunning(jobData.status === 'processing' || jobData.status === 'awaiting_refinement');
    setChatTitle(jobData.original_prompt || "Untitled Chat");
    if (jobData.context?.isDesignerMode !== undefined) setIsDesignerMode(jobData.context.isDesignerMode);
    if (jobData.context?.selectedModelId) setSelectedModelId(jobData.context.selectedModelId);
    if (jobData.context?.ratioMode) setRatioMode(jobData.context.ratioMode);
    if (jobData.context?.numImagesMode) setNumImagesMode(jobData.context.numImagesMode);

    let conversationMessages = parseHistoryToMessages(jobData.context?.history);
    
    if (jobData.status === 'processing') {
        conversationMessages.push({ from: 'bot', jobInProgress: { jobId: jobData.id, message: 'Thinking...' } });
    } else if (jobData.status === 'awaiting_refinement') {
        conversationMessages.push({ from: 'bot', jobInProgress: { jobId: jobData.id, message: 'Refining image in the background...' } });
    } else if (jobData.status === 'failed') {
        conversationMessages.push({ from: 'bot', text: jobData.error_message });
    } else if (jobData.status === 'awaiting_feedback' && jobData.final_result?.isRefinementProposal) {
        conversationMessages.push({ from: 'bot', refinementProposal: jobData.final_result });
    } else if (jobData.status === 'complete' && jobData.final_result?.text) {
        const lastMessage = conversationMessages[conversationMessages.length - 1];
        if (!lastMessage || lastMessage.from !== 'bot' || lastMessage.text !== jobData.final_result.text) {
            conversationMessages.push({ from: 'bot', text: jobData.final_result.text });
        }
    }
    setMessages(conversationMessages);
  }, []);

  const fetchChatJob = async (jobId: string | undefined) => {
    if (!jobId || !session?.user) return null;
    const { data, error } = await supabase.from("mira-agent-jobs").select("*").eq("id", jobId).eq("user_id", session.user.id).single();
    if (error) throw new Error("Could not load chat history.");
    return data;
  };

  const { data: jobData, error } = useQuery({
    queryKey: ['chatJob', jobId],
    queryFn: () => fetchChatJob(jobId),
    enabled: !!jobId,
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
      .on('postgres_changes', { 
          event: 'UPDATE', 
          schema: 'public', 
          table: 'mira-agent-jobs', 
          filter: `id=eq.${jobId}` 
      }, () => {
          queryClient.invalidateQueries({ queryKey: ['chatJob', jobId] });
      })
      .subscribe();

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
      setUploadedFiles(prev => [...prev, ...newFiles]);
      dismissToast(toastId);
      showSuccess(`${files.length} file(s) uploaded successfully!`);
      return newFiles;
    } catch (error: any) {
      dismissToast(toastId);
      showError("Upload failed: " + error.message);
      return [];
    }
  }, [session, supabase]);

  const handleSendMessage = useCallback(async () => {
    if ((!input.trim() && uploadedFiles.length === 0) || isJobRunning || isSending) {
      return;
    }
    let currentInput = input;
    if (!currentInput.trim() && uploadedFiles.length > 0) currentInput = "Please analyze the attached file(s).";
    
    const filesToProcess = [...uploadedFiles];
    setInput("");
    setUploadedFiles([]);
    setIsSending(true);

    try {
        const payload = { 
            jobId, 
            prompt: currentInput, 
            storagePaths: filesToProcess.map(f => f.path), 
            userId: session?.user.id, 
            isDesignerMode, 
            selectedModelId, 
            language, 
            ratioMode, 
            numImagesMode 
        };
        if (!payload.userId) throw new Error("User session not found.");
        
        if (jobId) {
            await supabase.functions.invoke("MIRA-AGENT-continue-job", { body: payload });
        } else {
            const { data, error } = await supabase.functions.invoke("MIRA-AGENT-master-worker", { body: payload });
            if (error) throw error;
            navigate(`/chat/${data.reply.jobId}`);
        }
    } catch (error: any) {
      showError("Error communicating with Mira: " + error.message);
    } finally {
      setIsSending(false);
    }
  }, [input, uploadedFiles, isJobRunning, isSending, jobId, session, isDesignerMode, selectedModelId, language, ratioMode, numImagesMode, supabase, navigate]);

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
      const newMessages = prev.filter(m => !m.refinementProposal); // Remove old proposal
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
            <MessageList messages={messages} jobId={jobId} onRefinementComplete={handleRefinementComplete} />
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
          onSendMessage={handleSendMessage}
        />
      </div>
    </div>
  );
};

export default Index;