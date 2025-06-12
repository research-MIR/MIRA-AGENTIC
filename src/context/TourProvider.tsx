import { createContext, useContext, useState, ReactNode, useCallback, useEffect } from 'react';
import { TourProvider as ReactourProvider, useTour, StepType } from '@reactour/tour';
import { useLanguage } from './LanguageContext';
import { useSession } from '@/components/Auth/SessionContextProvider';
import { useNavigate, useLocation } from 'react-router-dom';

interface OnboardingTourContextType {
  startTour: () => void;
}

const OnboardingTourContext = createContext<OnboardingTourContextType | undefined>(undefined);

export const useOnboardingTour = () => {
  const context = useContext(OnboardingTourContext);
  if (!context) {
    throw new Error('useOnboardingTour must be used within an OnboardingTourProvider');
  }
  return context;
};

const TourLogicController = ({ children }: { children: ReactNode }) => {
  const { setIsOpen, setCurrentStep, currentStep, isOpen } = useTour();
  const { supabase, session } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [hasCompletedTour, setHasCompletedTour] = useState<boolean | null>(null);
  const [isTourPending, setIsTourPending] = useState(false);

  const startTour = useCallback(() => {
    navigate('/chat');
    setIsTourPending(true);
  }, [navigate]);

  useEffect(() => {
    if (isTourPending && location.pathname === '/chat') {
      setCurrentStep(0);
      setIsOpen(true);
      setIsTourPending(false);
    }
  }, [location.pathname, isTourPending, setCurrentStep, setIsOpen]);

  useEffect(() => {
    const checkTourStatus = async () => {
      if (!session?.user) return;
      const { data, error } = await supabase
        .from('profiles')
        .select('has_completed_onboarding_tour')
        .eq('id', session.user.id)
        .single();
      
      if (error) {
        console.error("Error fetching tour status:", error);
        setHasCompletedTour(true);
        return;
      }
      const completed = data?.has_completed_onboarding_tour ?? false;
      setHasCompletedTour(completed);
      if (!completed) {
        startTour();
      }
    };
    checkTourStatus();
  }, [session, supabase, startTour]);

  useEffect(() => {
    if (!isOpen) return;
    const stepActions: Record<number, () => void> = {
      6: () => navigate('/generator'),
      9: () => navigate('/gallery'),
      11: () => navigate('/chat'),
    };
    const action = stepActions[currentStep];
    if (action) {
      action();
    }
  }, [currentStep, isOpen, navigate]);

  const markTourAsComplete = async () => {
    if (hasCompletedTour) return;
    const { error } = await supabase.rpc('set_onboarding_tour_complete');
    if (error) console.error("Error saving tour state:", error);
    else setHasCompletedTour(true);
  };

  useEffect(() => {
    if (!isOpen) {
        markTourAsComplete();
    }
  }, [isOpen]);

  return (
    <OnboardingTourContext.Provider value={{ startTour }}>
      {children}
    </OnboardingTourContext.Provider>
  );
};

export const OnboardingTourProvider = ({ children }: { children: ReactNode }) => {
  const { t } = useLanguage();

  const steps: StepType[] = [
    { selector: '#model-selector', content: t.onboardingModelDescription },
    { selector: '#designer-mode-switch', content: t.onboardingDesignerDescription },
    { selector: '#pipeline-mode-select', content: t.onboardingPipelineDescription },
    { selector: '#prompt-input-area', content: t.onboardingPromptDescription },
    { selector: '#file-upload-button', content: t.onboardingUploadDescription },
    { selector: '#new-chat-button', content: t.onboardingNewChatDescription },
    { selector: '#generator-nav-link', content: "Let's check out the direct generator. Click here to continue." },
    { selector: '#generator-prompt-card', content: "In the direct generator, the Prompt is what you want to see, and the Negative Prompt is what you want to avoid." },
    { selector: '#generator-settings-card', content: "Here you have direct control over the model, aspect ratio, and other technical details." },
    { selector: '#gallery-nav-link', content: "All your creations are saved in the Gallery. Click here to continue." },
    { selector: '#gallery-tabs', content: "You can view all your images or filter them by how they were created." },
    { selector: '#chat-nav-link', content: "Tour complete! You're ready to create. Click here to go back to the chat." },
  ];

  return (
    <ReactourProvider 
      steps={steps} 
      defaultOpen={false}
      afterOpen={() => document.body.style.overflow = 'hidden'}
      beforeClose={() => {
        document.body.style.overflow = 'auto';
      }}
      disableInteraction={true}
    >
      <TourLogicController>
        {children}
      </TourLogicController>
    </ReactourProvider>
  );
};