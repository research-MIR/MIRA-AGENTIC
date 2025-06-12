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

const TourController = ({ children }: { children: ReactNode }) => {
  const { setIsOpen, setSteps, setCurrentStep, currentStep, isOpen } = useTour();
  const { t } = useLanguage();
  const { supabase, session } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [hasCompletedTour, setHasCompletedTour] = useState<boolean | null>(null);
  const [isTourPending, setIsTourPending] = useState(false);

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

  const startTour = useCallback(() => {
    console.log('[Tour] startTour called. Current path:', location.pathname);
    if (location.pathname.startsWith('/chat')) {
      console.log('[Tour] Already on chat page, opening tour directly.');
      setCurrentStep(0);
      setIsOpen(true);
    } else {
      console.log('[Tour] Not on chat page, navigating and setting pending flag.');
      navigate('/chat');
      setIsTourPending(true);
    }
  }, [navigate, location.pathname, setCurrentStep, setIsOpen]);

  useEffect(() => {
    console.log('[Tour] Pending check effect ran. isTourPending:', isTourPending, 'Path:', location.pathname);
    if (isTourPending && location.pathname.startsWith('/chat')) {
        console.log('[Tour] Conditions met, opening tour after navigation.');
        setSteps(steps);
        setCurrentStep(0);
        setIsOpen(true);
        setIsTourPending(false);
    }
  }, [location.pathname, isTourPending, setCurrentStep, setIsOpen, setSteps, steps]);

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
    console.log('[Tour] Navigation effect ran. isOpen:', isOpen, 'currentStep:', currentStep);
    if (!isOpen) return;

    const stepActions: Record<number, () => void> = {
      6: () => navigate('/generator'),
      9: () => navigate('/gallery'),
      11: () => navigate('/chat'),
    };

    const action = stepActions[currentStep];
    if (action) {
      console.log(`[Tour] Step ${currentStep} has a navigation action. Executing...`);
      action();
    }
  }, [currentStep, isOpen, navigate]);

  const markTourAsComplete = async () => {
    if (hasCompletedTour) return;
    const { error } = await supabase.rpc('set_onboarding_tour_complete');
    if (error) console.error("Error saving tour state:", error);
    else setHasCompletedTour(true);
  };

  return (
    <OnboardingTourContext.Provider value={{ startTour }}>
      <ReactourProvider 
        steps={steps} 
        defaultOpen={false}
        afterOpen={() => document.body.style.overflow = 'hidden'}
        beforeClose={() => {
          document.body.style.overflow = 'auto';
          markTourAsComplete();
        }}
        disableInteraction={true}
      >
        {children}
      </ReactourProvider>
    </OnboardingTourContext.Provider>
  );
};

export const OnboardingTourProvider = ({ children }: { children: ReactNode }) => {
  return <TourController>{children}</TourController>;
};