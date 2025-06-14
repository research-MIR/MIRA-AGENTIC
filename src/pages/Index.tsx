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

/**
 * This is the core translation layer between the raw, machine-readable agent history
 * from the database and the human-readable array of Message components displayed in the UI.
 * It iterates through the agent's turn-by-turn history and decides which UI component
 * should be rendered for each step.
 *
 * The most complex part is the `creativeProcessBuffer`. This is a temporary holding area
 * used to group related agent actions (e.g., prompt generation, image generation, critique)
 * into a single, cohesive UI card (`CreativeProcessResponse`). The buffer is "flushed"
 * (i.e., its contents are processed and added to the message list) whenever an unrelated
 * message type is encountered, or at the very end of parsing. This ensures that the
 * multi-step creative process is displayed as a single, logical unit.
 */
const parseHistoryToMessages = (history: any[]): Message[] => {
    const messages: Message[] = [];
    if (!history) return messages;

    // A temporary buffer to group related steps of the creative process.
    let creativeProcessBuffer: any[] = [];

    // This function takes the buffered creative steps, packages them into a single
    // `creativeProcessResponse` object, and adds it to the main messages array.
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
            // Clear the buffer for the next set of operations.
            creativeProcessBuffer = [];
        }
    };

    for (let i = 0; i < history.length; i++) {
        const turn = history[i];

        // Handle simple user messages or simple text responses from the model.
        if (turn.role === 'user' || (turn.role === 'model' && turn.parts[0]?.text)) {
            // Before processing a new user/bot message, flush any existing creative process.
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

        // Handle complex responses from the agent's tool calls.
        if (turn.role === 'function') {
            const response = turn.parts[0]?.functionResponse?.response;
            const callName = history[i - 1]?.parts[0]?.functionCall?.name;

            if (!response || !callName) continue;

            // The 'finish_task' tool is the final step. It might contain a simple text
            // response or signal the end of a creative process.
            if (callName === 'finish_task') {
                flushCreativeProcessBuffer(); // Always flush before finishing.
                if (response.text) {
                    messages.push({ from: 'bot', text: response.text });
                }
                // We intentionally do NOT handle `response.isCreativeProcess` here.
                // The `flushCreativeProcessBuffer` call above has already taken care of
                // rendering the completed creative process from the buffer. This prevents
                // a duplicate, malformed card from being rendered.
            } else if (callName === 'dispatch_to_artisan_engine') {
                flushCreativeProcessBuffer();
                creativeProcessBuffer.push({ artisan_result: response });
            } else if (callName === 'generate_image' || callName === 'generate_image_with_reference') {
                if (creativeProcessBuffer.length > 0) {
                    const currentIteration = creativeProcessBuffer[creativeProcessBuffer.length - 1];
                    // Differentiate between the first generation and a subsequent refinement in the same iteration.
                    if (!currentIteration.initial_generation_result) {
                        currentIteration.initial_generation_result = { toolName: callName, response };
                    } else {
                        currentIteration.refined_generation_result = { toolName: callName, response };
                    }
                } else {
                    // If there's no buffer, it was a standalone generation.
                    flushCreativeProcessBuffer();
                    messages.push({ from: 'bot', imageGenerationResponse: response });
                }
            } else if (callName === 'critique_images') {
                if (creativeProcessBuffer.length > 0) {
                    creativeProcessBuffer[creativeProcessBuffer.length - 1].critique_result = response;
                }
            } else {
                // Handle other structured responses that are not part of the main creative loop.
                flushCreativeProcessBuffer();
                if (response.isImageChoiceProposal) {
                    const choiceMessage: Message = { from: 'bot', imageChoiceProposal: response };
                    // Look ahead to see if the user's choice is the next message.
                    // If so, we can pre-select it in the UI and skip rendering the user's choice message.
                    const nextTurn = history[i + 1];
                    if (nextTurn && nextTurn.role === 'user' && nextTurn.parts[0]?.text?.startsWith("I choose image number")) {
                        const match = nextTurn.parts[0].text.match(/I choose image number (\d+)/);
                        if (match && match[1]) {
                            choiceMessage.imageChoiceSelectedIndex = parseInt(match[1], 10) - 1;
                            i++; // Increment the loop counter to skip the user's choice turn.
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
    
    // After the loop, flush any remaining items in the buffer.
    flushCreativeProcessBuffer();
    
    return messages;
};


const Index = () => {
  const { supabase, session } = useSession();
  const { jobId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { t, language } = useLanguage();
  const queryClient = useQueryClient();
  
  // --- STATE MANAGEMENT ---
  // The main array of messages to be displayed in the chat UI.
  const [messages, setMessages] = useState<Message[]>([]);
  // The title of the current chat, displayed in the header.
  const [chatTitle, setChatTitle] = useState<string>(t.newChat);
  // The current text in the user's input textarea.
  const [input, setInput] = useState("");
  // True if the agent is actively working on a job (`processing` or `awaiting_refinement`). Disables most UI interactions.
  const [isJobRunning, setIsJobRunning] = useState(false);
  // A short-lived state, true only while the API call to start/continue a job is in flight. Prevents double-sends.
  const [isSending, setIsSending] = useState(false);
  // An array of files the user has uploaded but not yet sent with a message.
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  // True if the user is dragging a file over the window, used to show the dropzone overlay.
  const [isDragging, setIsDragging] = useState(false);
  // State for the control panel settings.
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [isDesignerMode, setIsDesignerMode] = useState(false);
  const [ratioMode, setRatioMode] = useState<'auto' | string>('auto');
  const [numImagesMode, setNumImagesMode] = useState<'auto' | number>('auto');
  // A ref to the end of the message list, used to auto-scroll.
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // Auto-scroll whenever new messages are added.
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // The main function for sending a message or continuing a conversation.
  const handleSendMessage = useCallback(async (messageText?: string) => {
    const textToSend = messageText || input;
    // A "silent" message is one that shouldn't be displayed in the chat, like an image choice.
    const isSilent = textToSend.startsWith("I choose image number");

    if ((!textToSend.trim() && uploadedFiles.length === 0) || isJobRunning || isSending) {
      return;
    }
    
    const filesToProcess = [...uploadedFiles];

    // Optimistically update the UI with the user's message immediately.
    if (!isSilent) {
      const optimisticMessage: Message = {
        from: 'user',
        text: textToSend,
        imageUrls: filesToProcess.map(f => f.previewUrl)
      };
      setMessages(prev => [...prev, optimisticMessage]);
    }

    // Clear inputs and set sending state.
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
        
        // If there's a jobId, we're continuing an existing chat. Otherwise, we're starting a new one.
        if (jobId) {
            await supabase.functions.invoke("MIRA-AGENT-continue-job", { body: payload });
        } else {
            const { data, error } = await supabase.functions.invoke("MIRA-AGENT-master-worker", { body: payload });
            if (error) throw error;
            const newJobId = data.reply.jobId;

            // Construct an initial job object to pre-populate the cache.
            // This prevents the UI from flashing a blank screen while the first real fetch occurs.
            const userPartsForCache = [{ text: textToSend }];
            // Note: We can't easily add image data here without re-reading files.
            // The text history is the most important part to prevent the UI from feeling broken.
            // The real image data will be filled in by the first fetch/realtime update.
            const initialJobData = {
                id: newJobId,
                status: 'processing',
                original_prompt: textToSend,
                context: {
                    history: [{ role: 'user', parts: userPartsForCache }],
                    isDesignerMode,
                    selectedModelId,
                    language,
                    ratioMode,
                    numImagesMode,
                    source: 'agent'
                },
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                final_result: null,
                error_message: null,
                user_id: session?.user.id,
            };

            // Use the query client to set the initial data for the new job's query key.
            queryClient.setQueryData(['chatJob', newJobId], initialJobData);
            
            // Navigate to the new chat URL. Because the cache is pre-populated, the UI will render instantly.
            navigate(`/chat/${newJobId}`);
        }
    } catch (error: any) {
      showError("Error communicating with Mira: " + error.message);
      setIsSending(false); // Reset sending state on error
    }
  }, [input, uploadedFiles, isJobRunning, isSending, jobId, session, isDesignerMode, selectedModelId, language, ratioMode, numImagesMode, supabase, navigate, queryClient]);

  // Central function to update the entire component's state based on the job data from the database.
  const processJobData = useCallback((jobData: any) => {
    if (!jobData) return;
    
    const newIsJobRunning = jobData.status === 'processing' || jobData.status === 'awaiting_refinement';
    if (!newIsJobRunning) {
        setIsSending(false);
    }
    setIsJobRunning(newIsJobRunning);

    // Sync UI controls with the job's context.
    setChatTitle(jobData.original_prompt || "Untitled Chat");
    if (jobData.context?.isDesignerMode !== undefined) setIsDesignerMode(jobData.context.isDesignerMode);
    if (jobData.context?.selectedModelId) setSelectedModelId(jobData.context.selectedModelId);
    if (jobData.context?.ratioMode) setRatioMode(jobData.context.ratioMode);
    if (jobData.context?.numImagesMode) setNumImagesMode(jobData.context.numImagesMode);

    // Re-parse the history to render the message list.
    let conversationMessages = parseHistoryToMessages(jobData.context?.history);
    
    // Append a final status message based on the job's current state.
    if (jobData.status === 'processing') {
        conversationMessages.push({ from: 'bot', jobInProgress: { jobId: jobData.id, message: 'Thinking...' } });
    } else if (jobData.status === 'awaiting_refinement') {
        conversationMessages.push({ from: 'bot', jobInProgress: { jobId: jobData.id, message: 'Refining image in the background...' } });
    } else if (jobData.status === 'failed') {
        conversationMessages.push({ from: 'bot', text: jobData.error_message });
    } else if (jobData.status === 'awaiting_feedback') {
        // Render the specific card that requires user feedback.
        if (jobData.final_result?.isImageChoiceProposal) {
            conversationMessages.push({ from: 'bot', imageChoiceProposal: jobData.final_result });
        } else if (jobData.final_result?.isRefinementProposal) {
            conversationMessages.push({ from: 'bot', refinementProposal: jobData.final_result });
        } else if (jobData.final_result?.text) {
            conversationMessages.push({ from: 'bot', text: jobData.final_result.text });
        }
    } else if (jobData.status === 'complete' && jobData.final_result) {
        const result = jobData.final_result;
        if (result.isCreativeProcess) {
            conversationMessages.push({ from: 'bot', creativeProcessResponse: result });
        } else if (result.isImageGeneration) {
            conversationMessages.push({ from: 'bot', imageGenerationResponse: result });
        } else if (result.isBrandAnalysis) {
            conversationMessages.push({ from: 'bot', brandAnalysisResponse: result });
        } else if (result.text) {
            const lastMessage = conversationMessages[conversationMessages.length - 1];
            if (!lastMessage || lastMessage.from !== 'bot' || lastMessage.text !== result.text) {
                conversationMessages.push({ from: 'bot', text: result.text });
            }
        }
    }
    setMessages(conversationMessages);
  }, []);

  // Fetches the initial data for a chat when the page loads with a `jobId`.
  const fetchChatJob = async (jobId: string | undefined) => {
    if (!jobId || !session?.user) return null;
    const { data, error } = await supabase.from("mira-agent-jobs").select("*").eq("id", jobId).eq("user_id", session.user.id).single();
    if (error) {
        // If the job doesn't exist or the user doesn't have access, redirect to a new chat.
        if (error.code === 'PGRST116') {
            navigate('/chat');
            return null;
        }
        throw new Error("Could not load chat history.");
    }
    return data;
  };

  // React Query hook to manage fetching and caching of the chat job data.
  const { data: jobData, error } = useQuery({
    queryKey: ['chatJob', jobId],
    queryFn: () => fetchChatJob(jobId),
    enabled: !!jobId,
    // Use initialData if passed via navigation state. This is the key to the seamless new chat experience.
    initialData: () => location.state?.initialJobData,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  // This effect syncs the component's state with the fetched data from React Query.
  useEffect(() => {
    if (jobId && jobData) {
      processJobData(jobData);
    } else if (!jobId) {
      // If there's no jobId, reset the chat to a clean "new chat" state.
      setMessages([{ from: "bot", text: "Ciao! Come posso aiutarti oggi?" }]);
      setChatTitle(t.newChat);
      setInput("");
      setUploadedFiles([]);
      setIsJobRunning(false);
      setIsSending(false);
    }
  }, [jobId, jobData, processJobData, t.newChat]);

  // This effect manages the Supabase Realtime subscription.
  useEffect(() => {
    if (!jobId) return;

    const channel = supabase
      .channel(`job-updates-${jobId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'mira-agent-jobs', filter: `id=eq.${jobId}` },
        (payload) => {
          console.log('[Realtime] Job update received. Invalidating query cache to refetch.');
          // Invalidate the query to force a refetch from the database.
          // This is more robust than setting data directly from the payload.
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

    // The cleanup function returned by useEffect.
    return () => {
      supabase.removeChannel(channel);
    };
  }, [jobId, supabase, queryClient]);

  // Handle errors from the initial data fetch.
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

    const toastId = showLoading(`Uploading ${validFiles.length} file(s)...`);
    try {
      const uploadPromises = validFiles.map(file => {
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
      showSuccess(`${newFiles.length} file(s) uploaded successfully!`);
      return newFiles;
    } catch (error: any) {
      dismissToast(toastId);
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
      // Invalidate the job history query to update the sidebar.
      await queryClient.invalidateQueries({ queryKey: ["jobHistory"] });
      navigate("/chat");
    } catch (error: any) {
      dismissToast(toastId);
      showError(`${t.errorDeletingChat}: ${error.message}`);
    }
  }, [jobId, supabase, navigate, queryClient, t]);

  // Callback passed to the RefinementProposalCard to handle the result of a refinement.
  const handleRefinementComplete = useCallback((newImageUrl: string) => {
    setMessages(prev => {
      // Remove the old proposal card and add a new one with the refined image.
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