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
import DevProtectedRoute from "./components/Auth/DevProtectedRoute";
import VirtualTryOn from "./pages/VirtualTryOn";
import Refine from "./pages/Refine";
import Editor from "./pages/Editor";
import Projects from "./pages/Projects";
import ProjectDetail from "./pages/ProjectDetail";
import Settings from "./pages/Settings";
import { useSession } from "./components/Auth/SessionContextProvider.tsx";
import { useLanguage } from "./context/LanguageContext.tsx";
import { useOnboardingTour } from "./context/OnboardingTourContext.tsx";
import { TourProvider as ReactourProvider, StepType } from '@reactour/tour';

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
            <Route path="/refine" element={<Refine />} />
            <Route path="/editor" element={<Editor />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/projects/:projectId" element={<ProjectDetail />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/virtual-try-on" element={<VirtualTryOn />} />
            
            <Route element={<DevProtectedRoute />}>
              <Route path="/developer" element={<Developer />} />
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </ReactourProvider>
  );
};

export default App;