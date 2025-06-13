import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./globals.css";
import { BrowserRouter } from "react-router-dom";
import { SessionContextProvider } from "./components/Auth/SessionContextProvider.tsx";
import { ThemeProvider } from "./components/ThemeProvider.tsx";
import { LanguageProvider } from "./context/LanguageContext.tsx";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ImagePreviewProvider } from "./context/ImagePreviewContext.tsx";
import { ImagePreviewModal } from "./components/ImagePreviewModal.tsx";
import { TooltipProvider } from "./components/ui/tooltip.tsx";
import { Toaster } from "./components/ui/toaster.tsx";
import { Toaster as Sonner } from "./components/ui/sonner.tsx";
import { OnboardingTourProvider } from "./context/OnboardingTourContext.tsx";

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <SessionContextProvider>
        <LanguageProvider>
          <QueryClientProvider client={queryClient}>
            <OnboardingTourProvider>
              <ImagePreviewProvider modal={(data, onClose) => <ImagePreviewModal data={data} onClose={onClose} />}>
                <TooltipProvider>
                  <Toaster />
                  <Sonner position="top-right" />
                  <App />
                </TooltipProvider>
              </ImagePreviewProvider>
            </OnboardingTourProvider>
          </QueryClientProvider>
        </LanguageProvider>
      </SessionContextProvider>
    </ThemeProvider>
  </BrowserRouter>
);