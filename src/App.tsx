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
import Clients from "./pages/Clients";
import ClientDetail from "./pages/ClientDetail";
import ProjectDetail from "./pages/ProjectDetail";
import Settings from "./pages/Settings";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { useLanguage } from "@/context/LanguageContext";
import { useOnboardingTour } from "@/context/OnboardingTourContext";
import { TourProvider as ReactourProvider, StepType } from '@reactour/tour';
import SegmentationTool from "./pages/Developer/Segmentation.tsx";
import BoundingBoxTester from "./pages/Developer/BoundingBoxTester.tsx";
import EnhancorAITester from "./pages/Developer/EnhancorAITester.tsx";
import ModelPacks from "./pages/ModelPacks.tsx";
import ModelPackDetail from "./pages/ModelPackDetail.tsx";
import VirtualTryOnPacks from "./pages/VirtualTryOnPacks.tsx";
import EditWithWords from "./pages/EditWithWords.tsx";
import Experimental from "./pages/Experimental.tsx";
import ProductRecontext from "./pages/ProductRecontext.tsx";
import Reframe from "./pages/Reframe.tsx";
import VtoReports from "./pages/VtoReports.tsx";
import VtoReportDetail from "./pages/VtoReportDetail.tsx";
import Wardrobe from "./pages/Wardrobe.tsx";
import WardrobePacks from "./pages/WardrobePacks.tsx";
import WardrobePackDetail from "./pages/WardrobePackDetail.tsx";
import FalComfyUITester from "./pages/Developer/FalComfyUITester.tsx";
import TiledUpscaleTester from "./pages/Developer/TiledUpscaleTester.tsx";

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
            <Route path="/edit-with-words" element={<EditWithWords />} />
            <Route path="/product-recontext" element={<ProductRecontext />} />
            <Route path="/reframe" element={<Reframe />} />
            <Route path="/editor" element={<Editor />} />
            <Route path="/projects" element={<Navigate to="/clients" replace />} />
            <Route path="/clients" element={<Clients />} />
            <Route path="/clients/:clientId" element={<ClientDetail />} />
            <Route path="/projects/:projectId" element={<ProjectDetail />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/virtual-try-on" element={<VirtualTryOn />} />
            <Route path="/virtual-try-on-packs" element={<VirtualTryOnPacks />} />
            <Route path="/wardrobe" element={<Wardrobe />} />
            <Route path="/wardrobe-packs" element={<WardrobePacks />} />
            <Route path="/wardrobe-packs/:packId" element={<WardrobePackDetail />} />
            <Route path="/developer" element={<Developer />} />
            <Route path="/developer/segmentation" element={<SegmentationTool />} />
            <Route path="/developer/bounding-box-tester" element={<BoundingBoxTester />} />
            <Route path="/developer/enhancor-ai-tester" element={<EnhancorAITester />} />
            <Route path="/developer/fal-comfyui-tester" element={<FalComfyUITester />} />
            <Route path="/developer/tiled-upscale-tester" element={<TiledUpscaleTester />} />
            <Route path="/model-packs" element={<ModelPacks />} />
            <Route path="/model-packs/:packId" element={<ModelPackDetail />} />
            <Route path="/experimental" element={<Experimental />} />
            <Route path="/vto-reports" element={<VtoReports />} />
            <Route path="/vto-reports/:packId" element={<VtoReportDetail />} />
          </Route>
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </ReactourProvider>
  );
};

export default App;