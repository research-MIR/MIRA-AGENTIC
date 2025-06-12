import { useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import Gallery from "./pages/Gallery";
import Generator from "./pages/Generator";
import Developer from "./pages/Developer";
import Login from "./pages/Login";
import Layout from "./components/Layout";
import ProtectedRoute from "./components/Auth/ProtectedRoute";
import { ImagePreviewProvider } from "./context/ImagePreviewContext";
import { ImagePreviewModal } from "./components/ImagePreviewModal";
import { useLanguage } from "./context/LanguageContext";
import VirtualTryOn from "./pages/VirtualTryOn";
import { OnboardingTourProvider, useOnboardingTour } from "./context/OnboardingTourContext";
import { TourProvider as ReactourProvider, StepType } from '@reactour/tour';
import { useSession } from "./components/Auth/SessionContextProvider";

const queryClient = new QueryClient();

const AppContent = () => {
  const { isTourOpen, isTourPending, openTour, closeTour, startTour } = useOnboardingTour();
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
    { selector: '#model-selector', content: t.onboardingModelDescription },
    { selector: '#designer-mode-switch', content: t.onboardingDesignerDescription },
    { selector: '#pipeline-mode-select', content: t.onboardingPipelineDescription },
    { selector: '#prompt-input-area', content: t.onboardingPromptDescription },
    { selector: '#file-upload-button', content: t.onboardingUploadDescription },
    { selector: '#new-chat-button', content: t.onboardingNewChatDescription },
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
            <Route path="/developer" element={<Developer />} />
            <Route path="/virtual-try-on" element={<VirtualTryOn />} />
          </Route>
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </ReactourProvider>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ImagePreviewProvider modal={(data, onClose) => <ImagePreviewModal data={data} onClose={onClose} />}>
      <TooltipProvider>
        <Toaster />
        <Sonner position="top-right" />
        <BrowserRouter>
          <OnboardingTourProvider>
            <AppContent />
          </OnboardingTourProvider>
        </BrowserRouter>
      </TooltipProvider>
    </ImagePreviewProvider>
  </QueryClientProvider>
);

export default App;