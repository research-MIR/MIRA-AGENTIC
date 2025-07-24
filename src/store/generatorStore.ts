import { create } from 'zustand';
import { supabase } from '@/integrations/supabase/client';
import { optimizeImage, sanitizeFilename } from '@/lib/utils';

// Define the structure of a Job for type safety
interface Job {
  id: string;
  status: 'queued' | 'processing' | 'complete' | 'failed';
  context: {
    prompt: string;
    negative_prompt?: string;
    number_of_images?: number;
    seed?: number;
    model_id: string;
    size: string;
    final_prompt_used?: string;
  };
  final_result?: {
    images?: { publicUrl: string }[];
  };
}

// Add Model interface
export interface Model {
  id: string;
  model_id_string: string;
  provider: string;
  is_default: boolean;
  supports_img2img: boolean;
}

// Define the state and actions for our store
interface GeneratorState {
  // State
  prompt: string;
  negativePrompt: string;
  numImages: number;
  seed?: number;
  selectedModelId: string | null;
  aspectRatio: string;
  styleReferenceFile: File | null;
  garmentReferenceFiles: File[];
  isHelperEnabled: boolean;
  isLoading: boolean;
  finalPromptUsed: string | null;
  recentJobs: Job[];
  selectedJobId: string | null;
  isFetchingJobs: boolean;
  models: Model[];

  // Actions
  setField: <K extends keyof GeneratorState>(field: K, value: GeneratorState[K]) => void;
  reset: () => void;
  handleFileSelect: (type: 'style' | 'garment', files: FileList | null) => void;
  removeGarmentFile: (index: number) => void;
  clearStyleFile: () => void;
  fetchRecentJobs: (userId: string) => Promise<void>;
  selectJob: (job: Job) => void;
  generate: (userId: string) => Promise<{ success: boolean; message: string }>;
  fetchModels: () => Promise<void>;
}

const initialState = {
  prompt: "",
  negativePrompt: "",
  numImages: 1,
  seed: undefined,
  selectedModelId: null,
  aspectRatio: "1024x1024",
  styleReferenceFile: null,
  garmentReferenceFiles: [],
  isHelperEnabled: true,
  isLoading: false,
  finalPromptUsed: null,
  recentJobs: [],
  selectedJobId: null,
  isFetchingJobs: true,
  models: [],
};

export const useGeneratorStore = create<GeneratorState>((set, get) => ({
  ...initialState,

  setField: (field, value) => set({ [field]: value }),

  reset: () => {
    const { models, recentJobs } = get();
    set({ ...initialState, models, recentJobs, isFetchingJobs: false });
  },

  handleFileSelect: (type, files) => {
    if (!files || files.length === 0) return;
    const file = files[0];

    if (file.type.startsWith('video/') || file.type === 'image/avif') {
      // This should be handled by a toast in the component
      console.error("Unsupported file type");
      return;
    }

    if (type === 'style') {
      set({ styleReferenceFile: file });
    } else {
      set((state) => ({
        garmentReferenceFiles: [...state.garmentReferenceFiles, file],
      }));
    }
  },

  removeGarmentFile: (indexToRemove) => {
    set((state) => ({
      garmentReferenceFiles: state.garmentReferenceFiles.filter((_, index) => index !== indexToRemove),
    }));
  },

  clearStyleFile: () => set({ styleReferenceFile: null }),

  fetchRecentJobs: async (userId) => {
    set({ isFetchingJobs: true });
    try {
      const { data, error } = await supabase
        .from('mira-agent-jobs')
        .select('id, status, context, final_result')
        .eq('context->>source', 'direct_generator')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      set({ recentJobs: data as Job[] });
    } catch (error) {
      console.error("Failed to fetch recent jobs:", error);
    } finally {
      set({ isFetchingJobs: false });
    }
  },

  selectJob: (job) => {
    set({
      ...initialState, // Reset everything first
      models: get().models, // Keep the fetched models
      recentJobs: get().recentJobs, // Keep the fetched jobs
      isFetchingJobs: false, // We are not fetching
      prompt: job.context.prompt,
      negativePrompt: job.context.negative_prompt || "",
      numImages: job.context.number_of_images || 1,
      seed: job.context.seed,
      selectedModelId: job.context.model_id,
      aspectRatio: job.context.size || "1024x1024",
      finalPromptUsed: job.context.final_prompt_used || null,
      selectedJobId: job.id,
    });
  },

  fetchModels: async () => {
    try {
      const { data, error } = await supabase
        .from("mira-agent-models")
        .select("id, model_id_string, provider, is_default, supports_img2img")
        .eq("model_type", "image")
        .not('provider', 'eq', 'OpenAI');
      if (error) throw error;
      if (data) {
        const defaultModel = data.find(m => m.is_default);
        set(state => ({
          models: data,
          selectedModelId: state.selectedModelId || defaultModel?.model_id_string || null,
        }));
      }
    } catch (error) {
      console.error("Failed to fetch models:", error);
    }
  },

  generate: async (userId) => {
    const { prompt, isHelperEnabled, garmentReferenceFiles, styleReferenceFile, selectedModelId, negativePrompt, numImages, seed, aspectRatio } = get();
    if (!prompt.trim()) return { success: false, message: "Please enter a prompt." };
    if (!selectedModelId) return { success: false, message: "Please select a model." };

    set({ isLoading: true, finalPromptUsed: null });
    let promptToUse = prompt;

    try {
      if (isHelperEnabled && (garmentReferenceFiles.length > 0 || styleReferenceFile)) {
        const uploadFile = async (file: File | null) => {
          if (!file) return null;
          const optimized = await optimizeImage(file);
          const filePath = `${userId}/${Date.now()}-${sanitizeFilename(optimized.name)}`;
          const { error } = await supabase.storage.from('mira-agent-user-uploads').upload(filePath, optimized, {
            contentType: 'image/png',
            upsert: true,
          });
          if (error) throw new Error(`Upload failed: ${error.message}`);
          const { data: { publicUrl } } = supabase.storage.from('mira-agent-user-uploads').getPublicUrl(filePath);
          return publicUrl;
        };

        const garment_image_urls = (await Promise.all(garmentReferenceFiles.map(uploadFile))).filter(Boolean) as string[];
        const style_image_url = await uploadFile(styleReferenceFile);

        const { data, error } = await supabase.functions.invoke('MIRA-AGENT-tool-direct-generator-prompt-helper', {
          body: { user_prompt: prompt, garment_image_urls, style_image_url }
        });
        if (error) throw error;
        promptToUse = data.final_prompt;
        set({ finalPromptUsed: promptToUse });
      } else {
        set({ finalPromptUsed: prompt });
      }

      const { error: proxyError } = await supabase.functions.invoke('MIRA-AGENT-proxy-direct-generator', {
        body: {
          prompt: prompt,
          final_prompt_used: promptToUse,
          negative_prompt: negativePrompt,
          number_of_images: numImages,
          seed,
          model_id: selectedModelId,
          invoker_user_id: userId,
          size: aspectRatio
        }
      });
      if (proxyError) throw proxyError;

      get().reset();
      get().fetchRecentJobs(userId); // Refresh jobs list
      return { success: true, message: "Job queued! Your images will appear in the gallery shortly." };
    } catch (err: any) {
      return { success: false, message: err.message || "An unknown error occurred." };
    } finally {
      set({ isLoading: false });
    }
  },
}));