import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import Gallery from "./pages/Gallery";
import Generator from "./pages/Generator";
import Login from "./pages/Login";
import Layout from "./components/Layout";
import ProtectedRoute from "./components/Auth/ProtectedRoute";
import { ImagePreviewProvider } from "./context/ImagePreviewContext";
import { ImagePreviewModal } from "./components/ImagePreviewModal";
import { OnboardingTourProvider } from "@/context/OnboardingTourContext";
import { LanguageProvider } from "./context/LanguageContext";
import VirtualTryOn from "./pages/VirtualTryOn";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <LanguageProvider>
      <ImagePreviewProvider modal={(data, onClose) => <ImagePreviewModal data={data} onClose={onClose} />}>
        <TooltipProvider>
          <Toaster />
          <Sonner position="top-right" />
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route element={<ProtectedRoute />}>
                <Route element={
                  <OnboardingTourProvider>
                    <Layout />
                  </OnboardingTourProvider>
                }>
                  <Route path="/" element={<Navigate to="/chat" replace />} />
                  <Route path="/chat" element={<Index />} />
                  <Route path="/chat/:jobId" element={<Index />} />
                  <Route path="/gallery" element={<Gallery />} />
                  <Route path="/generator" element={<Generator />} />
                  <Route path="/virtual-try-on" element={<VirtualTryOn />} />
                </Route>
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </ImagePreviewProvider>
    </LanguageProvider>
  </QueryClientProvider>
);

export default App;