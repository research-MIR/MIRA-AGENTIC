import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./globals.css";
import { BrowserRouter } from "react-router-dom";
import { Providers } from "./components/Providers.tsx";
import { LanguageProvider } from "@/context/LanguageContext";

createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <LanguageProvider>
      <Providers>
        <App />
      </Providers>
    </LanguageProvider>
  </BrowserRouter>
);