import { createContext, useContext, useState, ReactNode, useCallback } from 'react';
import { translations } from '@/lib/i18n';

type Language = 'it' | 'en';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};

export const LanguageProvider = ({ children }: { children: ReactNode }) => {
  const [language, setLanguage] = useState<Language>('it');

  const handleSetLanguage = useCallback((lang: Language) => {
    setLanguage(lang);
  }, []);

  const t = useCallback((key: string): string => {
    const translationSet = translations[language] as Record<string, string>;
    return translationSet[key] || key;
  }, [language]);

  const value = { language, setLanguage: handleSetLanguage, t };

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
};