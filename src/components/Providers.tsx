import { ReactNode } from "react";
import { SessionContextProvider } from "./Auth/SessionContextProvider";
import { ThemeProvider } from "./ThemeProvider";
import { LanguageProvider } from "../context/LanguageContext";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ImagePreviewProvider } from "../context/ImagePreviewContext";
import { TooltipProvider } from "./ui/tooltip";
import { Toaster } from "./ui/toaster";
import { Toaster as Sonner } from "./ui/sonner";
import { OnboardingTourProvider } from "../context/OnboardingTourContext";

const queryClient = new QueryClient();

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
                </TooltipProvider>
              </OnboardingTourProvider>
            </ImagePreviewProvider>
          </QueryClientProvider>
        </SessionContextProvider>
      </ThemeProvider>
    </LanguageProvider>
  );
}