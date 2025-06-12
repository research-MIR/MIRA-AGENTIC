import { createContext, useContext, useState, ReactNode, useCallback } from 'react';

interface OnboardingTourContextType {
  isTourOpen: boolean;
  startTour: () => void;
  closeTour: () => void;
}

const OnboardingTourContext = createContext<OnboardingTourContextType | undefined>(undefined);

export const useOnboardingTour = () => {
  const context = useContext(OnboardingTourContext);
  if (!context) {
    throw new Error('useOnboardingTour must be used within an OnboardingTourProvider');
  }
  return context;
};

export const OnboardingTourProvider = ({ children }: { children: ReactNode }) => {
  const [isTourOpen, setIsTourOpen] = useState(false);

  const startTour = useCallback(() => {
    setIsTourOpen(true);
  }, []);

  const closeTour = useCallback(() => {
    setIsTourOpen(false);
  }, []);

  const value = { isTourOpen, startTour, closeTour };

  return (
    <OnboardingTourContext.Provider value={value}>
      {children}
    </OnboardingTourContext.Provider>
  );
};