import { ReactNode } from "react";
import { SessionContextProvider } from "@/components/Auth/SessionContextProvider";
import { ThemeProvider } from "@/components/ThemeProvider";
import { LanguageProvider } from "@/context/LanguageContext";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ImagePreviewProvider, useImagePreview } from "@/context/ImagePreviewContext";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { OnboardingTourProvider } from "@/context/OnboardingTourContext";
import { ImagePreviewModal } from "./ImagePreviewModal";

const queryClient = new QueryClient();

const GlobalModals = () => {
  const { previewData, hideImage } = useImagePreview();
  return <ImagePreviewModal data={previewData} onClose={hideImage} />;
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <LanguageProvider>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <SessionContextProvider>
          <QueryClientProvider client={queryClient}>
            <ImagePreviewProvider>
              <OnboardingTourProvider>
                <TooltipProvider>
                  <Toaster />
                  <Sonner position="bottom-right" />
                  {children}
                  <GlobalModals />
                </TooltipProvider>
              </OnboardingTourProvider>
            </ImagePreviewProvider>
          </QueryClientProvider>
        </SessionContextProvider>
      </ThemeProvider>
    </LanguageProvider>
  );
}