import { useEffect } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import Gallery from "./pages/Gallery";
import Generator from "./pages/Generator";
import Developer from "./pages/Developer";
import Login from "./pages/Login";
import Layout from "./components/Layout";
import ProtectedRoute from "./components/Auth/ProtectedRoute";
import VirtualTryOn from "./pages/VirtualTryOn";
import Upscale from "./pages/Upscale";
import Inpainting from "./pages/Inpainting";
import Editor from "./pages/Editor";
import Projects from "./pages/Projects";
import ProjectDetail from "./pages/ProjectDetail";
import Settings from "./pages/Settings";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { useLanguage } from "@/context/LanguageContext";
import { useOnboardingTour } from "@/context/OnboardingTourContext";
import { TourProvider as ReactourProvider, StepType } from '@reactour/tour';
import SegmentationTool from "./pages/Developer/Segmentation.tsx";
import ModelPacks from "./pages/ModelPacks.tsx";
import ModelPackDetail from "./pages/ModelPackDetail.tsx";
import VirtualTryOnPacks from "./pages/VirtualTryOnPacks.tsx";
import { GlobalModals } from "./components/GlobalModals.tsx";

const App = () => {
  const { isTourOpen, closeTour, isTourPending, openTour, startTour } = useOnboardingTour();
  const { t } = useLanguage();
  const { session, supabase } = useSession();
  const location = useLocation();

  useEffect(() => {
    if (session?.user) {
      supabase.from('profiles').select('has_completed_onboarding_tour').eq('id', session.user.id).single().then(({ data }) => {
        if (data && !data.has_completed_onboarding_tour) {
          startTour();
        }
      });
    }
  }, [session, supabase, startTour]);

  useEffect(() => {
    if (isTourPending && location.pathname.startsWith('/chat')) {
      openTour();
    }
  }, [isTourPending, location.pathname, openTour]);

  const steps: StepType[] = [
    { selector: '#model-selector', content: t('onboardingModelDescription') },
    { selector: '#designer-mode-switch', content: t('onboardingDesignerDescription') },
    { selector: '#pipeline-mode-select', content: t('onboardingPipelineDescription') },
    { selector: '#prompt-input-area', content: t('onboardingPromptDescription') },
    { selector: '#file-upload-button', content: t('onboardingUploadDescription') },
    { selector: '#new-chat-button', content: t('onboardingNewChatDescription') },
  ];

  const handleTourEnd = async () => {
    closeTour();
    if (session?.user) {
      await supabase.rpc('set_onboarding_tour_complete');
    }
  };

  return (
    <ReactourProvider 
      steps={steps} 
      isOpen={isTourOpen} 
      onClose={handleTourEnd}
      styles={{
        popover: (base) => ({
          ...base,
          '--reactour-accent': 'hsl(var(--primary))',
          borderRadius: 'var(--radius)',
          backgroundColor: 'hsl(var(--background))',
          color: 'hsl(var(--foreground))',
          border: '1px solid hsl(var(--border))',
        }),
        maskArea: (base) => ({ ...base, rx: 'var(--radius)' }),
        dot: (base, { current }) => ({
          ...base,
          backgroundColor: current ? 'hsl(var(--primary))' : 'hsl(var(--muted))',
        }),
      }}
    >
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<Layout />}>
            <Route path="/" element={<Navigate to="/chat" replace />} />
            <Route path="/chat" element={<Index />} />
            <Route path="/chat/:jobId" element={<Index />} />
            <Route path="/gallery" element={<Gallery />} />
            <Route path="/generator" element={<Generator />} />
            <Route path="/upscale" element={<Upscale />} />
            <Route path="/inpainting" element={<Inpainting />} />
            <Route path="/editor" element={<Editor />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/projects/:projectId" element={<ProjectDetail />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/virtual-try-on" element={<VirtualTryOn />} />
            <Route path="/virtual-try-on-packs" element={<VirtualTryOnPacks />} />
            <Route path="/developer" element={<Developer />} />
            <Route path="/developer/segmentation" element={<SegmentationTool />} />
            <Route path="/model-packs" element={<ModelPacks />} />
            <Route path="/model-packs/:packId" element={<ModelPackDetail />} />
          </Route>
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
      <GlobalModals />
    </ReactourProvider>
  );
};

export default App;