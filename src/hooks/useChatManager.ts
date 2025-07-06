import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from '@/components/Auth/SessionContextProvider';
import { showError, showSuccess, showLoading, dismissToast } from '@/utils/toast';
import { RealtimeChannel } from '@supabase/supabase-js';
import { Message } from '@/components/Chat/MessageList';
import { useLanguage } from '@/context/LanguageContext';
import { UploadedFile } from './useFileUpload';
import { translateErrorMessage } from '@/lib/errors';

const MAX_TURNS = 120;

export interface Model {
  id: string;
  model_id_string: string;
  provider: string;
  is_default: boolean;
  supports_img2img: boolean;
}

const parseHistoryToMessages = (jobData: any, t: (key: string) => string): Message[] => {
    const history = jobData?.context?.history;
    const messages: Message[] = [];
    if (!history) return messages;

    for (let i = 0; i < history.length; i++) {
        const turn = history[i];
        const historyIndex = i;

        if (turn.role === 'user') {
            const message: Message = { from: 'user', imageUrls: [] };
            const textPart = turn.parts.find((p: any) => p.text);

            // Check if it's a system note and skip it
            if (textPart && textPart.text.startsWith("System note:")) {
                continue;
            }

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
            const functionResponse = turn.parts[0]?.functionResponse;
            if (!functionResponse || !functionResponse.name || !functionResponse.response) continue;

            const callName = functionResponse.name;
            const response = functionResponse.response;

            const botMessage: Message = { from: 'bot', historyIndex };

            switch (callName) {
                case 'dispatch_to_artisan_engine': botMessage.artisanResponse = response; break;
                case 'generate_image': case 'generate_image_with_reference': botMessage.imageGenerationResponse = response; break;
                case 'dispatch_to_brand_analyzer': botMessage.brandAnalysisResponse = response; break;
                case 'provide_text_response': 
                    if (response.isCreativeProcess) botMessage.creativeProcessResponse = response;
                    else if (response.isImageGeneration) botMessage.imageGenerationResponse = response;
                    else if (response.isBrandAnalysis) botMessage.brandAnalysisResponse = response;
                    else if (response.isImageChoiceProposal) botMessage.imageChoiceProposal = response;
                    else if (response.isRefinementProposal) botMessage.refinementProposal = response;
                    else if (response.text) botMessage.text = t(response.text);
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
                case 'critique_images': continue;
                case 'finish_task': continue;
                default: continue;
            }
            messages.push(botMessage);
        }
    }
    return messages;
};

export const useChatManager = () => {
    const { supabase, session } = useSession();
    const { jobId } = useParams();
    const navigate = useNavigate();
    const location = useLocation();
    const { t, language } = useLanguage();
    const queryClient = useQueryClient();
    const channelRef = useRef<RealtimeChannel | null>(null);

    const [messages, setMessages] = useState<Message[]>([]);
    const [chatTitle, setChatTitle] = useState<string>(t('newChat'));
    const [isJobRunning, setIsJobRunning] = useState(false);
    const [isSending, setIsSending] = useState(false);
    const [isOwner, setIsOwner] = useState(true);
    const [isTurnLimitReached, setIsTurnLimitReached] = useState(false);
    const [models, setModels] = useState<Model[]>([]);
    const [jobSettings, setJobSettings] = useState({
        isDesignerMode: false,
        selectedModelId: null as string | null,
        ratioMode: 'auto' as 'auto' | string,
        numImagesMode: 'auto' as 'auto' | number,
    });

    useEffect(() => {
        const fetchModels = async () => {
          try {
            const { data, error } = await supabase
              .from("mira-agent-models")
              .select("id, model_id_string, provider, is_default, supports_img2img")
              .eq("model_type", "image")
              .not('provider', 'eq', 'OpenAI');
    
            if (error) throw error;
    
            if (data) {
              setModels(data);
              const defaultModel = data.find(m => m.is_default);
              if (defaultModel && !jobSettings.selectedModelId) {
                setJobSettings(s => ({ ...s, selectedModelId: defaultModel.model_id_string }));
              }
            }
          } catch (error: any) {
            showError("Failed to load image models: " + error.message);
          }
        };
    
        fetchModels();
    }, [supabase, jobSettings.selectedModelId]);

    const fetchChatJob = useCallback(async (jobId: string | undefined) => {
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
    }, [supabase, session, navigate]);

    const { data: jobData, error, isLoading } = useQuery({
        queryKey: ['chatJob', jobId],
        queryFn: () => fetchChatJob(jobId),
        enabled: !!jobId,
        initialData: () => location.state?.initialJobData,
        refetchOnWindowFocus: false,
        retry: 1,
    });

    const processJobData = useCallback((data: any) => {
        if (!data) return;
        setIsOwner(data.user_id === session?.user?.id);
        setChatTitle(data.original_prompt || "Untitled Chat");
        setJobSettings({
            isDesignerMode: data.context?.isDesignerMode ?? false,
            selectedModelId: data.context?.selectedModelId ?? null,
            ratioMode: data.context?.ratioMode ?? 'auto',
            numImagesMode: data.context?.numImagesMode ?? 'auto',
        });

        const historyLength = data.context?.history?.length || 0;
        const isFinalStatus = ['complete', 'awaiting_feedback', 'failed'].includes(data.status);
        setIsTurnLimitReached(historyLength >= MAX_TURNS && isFinalStatus);

        let conversationMessages = parseHistoryToMessages(data, t);
        const isRunning = data.status === 'processing' || data.status === 'awaiting_refinement';
        setIsJobRunning(isRunning);
        if (!isRunning) setIsSending(false);

        if (isRunning) {
            const message = data.status === 'processing' ? 'Thinking...' : 'Refining image...';
            conversationMessages.push({ from: 'bot', jobInProgress: { jobId: data.id, message } });
        } else if (data.status === 'failed') {
            const friendlyError = translateErrorMessage(data.error_message, t);
            conversationMessages.push({ from: 'bot', error: { message: friendlyError, jobId: data.id } });
        }
        setMessages(conversationMessages);
    }, [session?.user?.id, t]);

    useEffect(() => {
        if (jobId && jobData) {
            processJobData(jobData);
        } else if (!jobId) {
            setMessages([{ from: "bot", text: t('greeting') }]);
            setChatTitle(t('newChat'));
            setIsJobRunning(false);
            setIsSending(false);
            setIsOwner(true);
            setIsTurnLimitReached(false);
        }
    }, [jobId, jobData, processJobData, t]);

    useEffect(() => {
        if (channelRef.current) {
            supabase.removeChannel(channelRef.current);
            channelRef.current = null;
        }
        if (!jobId) return;

        const channel = supabase.channel(`job-updates-${jobId}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'mira-agent-jobs' },
                (payload) => {
                    if (payload.new.id === jobId) {
                        queryClient.invalidateQueries({ queryKey: ['chatJob', jobId] });
                    }
                }
            ).subscribe();
        channelRef.current = channel;

        return () => {
            if (channelRef.current) {
                supabase.removeChannel(channelRef.current);
            }
        };
    }, [jobId, supabase, queryClient]);

    useEffect(() => {
        if (error) {
            showError(translateErrorMessage(error.message, t));
            navigate("/chat");
        }
    }, [error, navigate, t]);

    const sendMessage = useCallback(async (text: string, files: UploadedFile[], isSilent: boolean) => {
        if (!isSilent) {
            const optimisticMessage: Message = {
                from: 'user',
                text: text,
                imageUrls: files.map(f => f.previewUrl)
            };
            setMessages(prev => [...prev, optimisticMessage]);
        }
        setIsSending(true);
        try {
            const uploadPromises = files.map(file => file.upload(supabase, 'mira-agent-user-uploads'));
            const uploadedFileResults = await Promise.all(uploadPromises);
            const storagePaths = uploadedFileResults.map(result => result.path);

            const payload = { 
                jobId, 
                prompt: text, 
                storagePaths,
                userId: session?.user.id, 
                ...jobSettings,
                language, 
                isSilent
            };
            if (!payload.userId) throw new Error("User session not found.");
            
            if (jobId) {
                await supabase.functions.invoke("MIRA-AGENT-continue-job", { body: payload });
            } else {
                const { data, error } = await supabase.functions.invoke("MIRA-AGENT-create-job", { body: payload });
                if (error) throw error;
                const newJob = data.newJob;
                if (!newJob || !newJob.id) throw new Error("Failed to create a new job.");
                queryClient.setQueryData(['chatJob', newJob.id], newJob);
                navigate(`/chat/${newJob.id}`);
            }
        } catch (err: any) {
            showError(translateErrorMessage(err.message, t));
            setIsSending(false);
            if (!isSilent) {
                setMessages(prev => prev.slice(0, -1));
            }
        }
    }, [jobId, session, jobSettings, language, supabase, navigate, queryClient, t]);

    const deleteChat = useCallback(async () => {
        if (!jobId) return;
        const toastId = showLoading("Deleting chat...");
        try {
            const { error } = await supabase.rpc('delete_mira_agent_job', { p_job_id: jobId });
            if (error) throw error;
            dismissToast(toastId);
            showSuccess(t('chatDeleted'));
            await queryClient.invalidateQueries({ queryKey: ["jobHistory"] });
            navigate("/chat");
        } catch (err: any) {
            dismissToast(toastId);
            showError(`${t('errorDeletingChat')}: ${translateErrorMessage(err.message, t)}`);
        }
    }, [jobId, supabase, navigate, queryClient, t]);

    const branchChat = useCallback(async (historyIndex: number) => {
        if (!jobId || !session?.user) return;
        const toastId = showLoading("Creating new branch...");
        try {
            const { data, error } = await supabase.functions.invoke('MIRA-AGENT-branch-job', {
                body: { source_job_id: jobId, history_index: historyIndex, invoker_user_id: session.user.id }
            });
            if (error) throw error;
            dismissToast(toastId);
            showSuccess("Branched chat created.");
            await queryClient.invalidateQueries({ queryKey: ["jobHistory"] });
            navigate(`/chat/${data.newJobId}`);
        } catch (err: any) {
            dismissToast(toastId);
            showError(`Failed to branch chat: ${translateErrorMessage(err.message, t)}`);
        }
    }, [jobId, session, supabase, navigate, queryClient, t]);

    return {
        jobId,
        jobData,
        messages,
        chatTitle,
        isJobRunning,
        isSending,
        isOwner,
        isTurnLimitReached,
        jobSettings,
        setJobSettings,
        sendMessage,
        deleteChat,
        branchChat,
        isLoading,
        models,
    };
};