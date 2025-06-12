import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./globals.css";
import { SessionContextProvider } from "./components/Auth/SessionContextProvider.tsx";
import { ThemeProvider } from "./components/ThemeProvider.tsx";
import { LanguageProvider } from "./context/LanguageContext.tsx";

createRoot(document.getElementById("root")!).render(
  <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
    <SessionContextProvider>
      <LanguageProvider>
        <App />
      </LanguageProvider>
    </SessionContextProvider>
  </ThemeProvider>
);