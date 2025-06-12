import { createContext, useContext, useState, ReactNode, useCallback } from 'react';
import { TourProvider, useTour } from '@reactour/tour';
import { useLanguage } from './LanguageContext';

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

const TourWrapper = ({ children }: { children: ReactNode }) => {
  const { setIsOpen } = useTour();
  const { t } = useLanguage();

  const steps = [
    { selector: '#model-selector', title: t.onboardingModelTitle, content: t.onboardingModelDescription },
    { selector: '#designer-mode-switch', title: t.onboardingDesignerTitle, content: t.onboardingDesignerDescription },
    { selector: '#pipeline-mode-radiogroup', title: t.onboardingPipelineTitle, content: t.onboardingPipelineDescription },
    { selector: '#prompt-input-area', title: t.onboardingPromptTitle, content: t.onboardingPromptDescription },
    { selector: '#file-upload-button', title: t.onboardingUploadTitle, content: t.onboardingUploadDescription },
    { selector: '#new-chat-button', title: t.onboardingNewChatTitle, content: t.onboardingNewChatDescription },
  ];

  const startTour = useCallback(() => {
    setIsOpen(true);
  }, [setIsOpen]);

  return (
    <OnboardingTourContext.Provider value={{ startTour }}>
      <TourProvider steps={steps} defaultOpen={false}>
        {children}
      </TourProvider>
    </OnboardingTourContext.Provider>
  );
};

export const OnboardingTourProvider = ({ children }: { children: ReactNode }) => {
  return <TourWrapper>{children}</TourWrapper>;
};