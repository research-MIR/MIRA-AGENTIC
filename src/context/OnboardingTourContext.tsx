import { createContext, useContext, useState, ReactNode, useCallback } from 'react';

interface OnboardingTourContextType {
  tourRequestCount: number;
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

export const OnboardingTourProvider = ({ children }: { children: ReactNode }) => {
  const [tourRequestCount, setTourRequestCount] = useState(0);

  const startTour = useCallback(() => {
    console.log("[TourContext] startTour called.");
    setTourRequestCount(count => count + 1);
  }, []);

  const value = { tourRequestCount, startTour };

  return (
    <OnboardingTourContext.Provider value={value}>
      {children}
    </OnboardingTourContext.Provider>
  );
};