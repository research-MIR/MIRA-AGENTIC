import { createContext, useContext, useState, ReactNode, useCallback } from 'react';

interface OnboardingTourContextType {
  isTourOpen: boolean;
  isTourPending: boolean;
  startTour: () => void;
  openTour: () => void;
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
  const [isTourPending, setIsTourPending] = useState(false);

  const startTour = useCallback(() => {
    setIsTourPending(true);
  }, []);

  const openTour = useCallback(() => {
    setIsTourOpen(true);
    setIsTourPending(false);
  }, []);

  const closeTour = useCallback(() => {
    setIsTourOpen(false);
    setIsTourPending(false);
  }, []);

  const value = { isTourOpen, isTourPending, startTour, openTour, closeTour };

  return (
    <OnboardingTourContext.Provider value={value}>
      {children}
    </OnboardingTourContext.Provider>
  );
};