import { useState, useEffect } from "react";
import { useLanguage } from "@/context/LanguageContext";
import { SettingsPanel } from "@/components/GenerateModels/SettingsPanel";
import { ResultsDisplay } from "@/components/GenerateModels/ResultsDisplay";
import { useGeneratorStore } from "@/store/generatorStore";
import { showError, showLoading, dismissToast } from "@/utils/toast";
import { Model } from "@/hooks/useChatManager";
import { useSession } from "@/components/Auth/SessionContextProvider";

const GenerateModels = () => {
  const { t } = useLanguage();
  const { models, fetchModels } = useGeneratorStore();
  const { supabase, session } = useSession();

  const [modelDescription, setModelDescription] = useState("");
  const [setDescription, setSetDescription] = useState("");
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [autoApprove, setAutoApprove] = useState(true);
  
  const [isLoading, setIsLoading] = useState(false);
  const [generatedImages, setGeneratedImages] = useState<{id: string, url: string}[]>([]);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  useEffect(() => {
    if (models.length > 0 && !selectedModelId) {
      const defaultModel = models.find(m => m.is_default) || models[0];
      if (defaultModel) {
        setSelectedModelId(defaultModel.model_id_string);
      }
    }
  }, [models, selectedModelId]);

  const handleGenerate = async () => {
    if (!modelDescription.trim() || !selectedModelId || !session?.user) {
      showError("Please provide a model description and select a base model.");
      return;
    }

    setIsLoading(true);
    setGeneratedImages([]);
    setSelectedImageId(null);
    const toastId = showLoading(t('generating'));

    try {
      const { data, error } = await supabase.functions.invoke('MIRA-AGENT-orchestrator-generate-model', {
        body: {
          model_description: modelDescription,
          set_description: setDescription,
          selected_model_id: selectedModelId,
          user_id: session.user.id,
          auto_approve: autoApprove
        }
      });

      if (error) throw error;
      
      dismissToast(toastId);

      setGeneratedImages(data.images);
      if (autoApprove && data.images.length > 0) {
        setSelectedImageId(data.images[0].id);
      }

    } catch (err: any) {
      dismissToast(toastId);
      showError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectImage = (id: string) => {
    setSelectedImageId(id);
    // Here we would trigger the next step (pose generation)
    showError("Pose generation is not implemented yet.");
  };

  return (
    <div className="p-4 md:p-8 h-screen overflow-y-auto">
      <header className="pb-4 mb-8 border-b">
        <h1 className="text-3xl font-bold">{t('generateModelsTitle')}</h1>
        <p className="text-muted-foreground">{t('generateModelsDescription')}</p>
      </header>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1">
          <SettingsPanel
            modelDescription={modelDescription}
            setModelDescription={setModelDescription}
            setDescription={setDescription}
            setSetDescription={setSetDescription}
            models={models as Model[]}
            selectedModelId={selectedModelId}
            setSelectedModelId={setSelectedModelId}
            autoApprove={autoApprove}
            setAutoApprove={setAutoApprove}
            onGenerate={handleGenerate}
            isLoading={isLoading}
          />
        </div>
        <div className="lg:col-span-2">
          <ResultsDisplay
            images={generatedImages}
            isLoading={isLoading}
            autoApprove={autoApprove}
            selectedImageId={selectedImageId}
            onSelectImage={handleSelectImage}
          />
        </div>
      </div>
    </div>
  );
};

export default GenerateModels;