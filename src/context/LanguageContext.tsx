import { createContext, useContext, useState, ReactNode, useCallback } from 'react';
import { commonTranslations } from '@/lib/translations/common';
import { chatTranslations } from '@/lib/translations/chat';
import { projectsTranslations } from '@/lib/translations/projects';
import { generatorTranslations } from '@/lib/translations/generator';
import { galleryTranslations } from '@/lib/translations/gallery';
import { refineTranslations } from '@/lib/translations/refine';
import { vtoTranslations } from '@/lib/translations/vto';
import { editorTranslations } from '@/lib/translations/editor';
import { errorTranslations } from '@/lib/translations/errors';
import { onboardingTranslations } from '@/lib/translations/onboarding';

// Aggregate translations directly in this file
const modules = [
  commonTranslations,
  chatTranslations,
  projectsTranslations,
  generatorTranslations,
  galleryTranslations,
  refineTranslations,
  vtoTranslations,
  editorTranslations,
  errorTranslations,
  onboardingTranslations,
];

const translations = modules.reduce((acc, module) => {
  for (const lang in module) {
    if (acc[lang]) {
      Object.assign(acc[lang], module[lang]);
    } else {
      acc[lang] = module[lang];
    }
  }
  return acc;
}, {} as Record<string, Record<string, string>>);


type Language = 'it' | 'en';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string, replacements?: Record<string, string | number>) => string;
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

  const t = useCallback((key: string, replacements?: Record<string, string | number>): string => {
    const translationSet = translations[language] as Record<string, string>;
    let translation = translationSet[key] || key;

    if (replacements) {
      Object.keys(replacements).forEach(rKey => {
        const regex = new RegExp(`\\{${rKey}\\}`, 'g');
        translation = translation.replace(regex, String(replacements[rKey]));
      });
    }

    return translation;
  }, [language]);

  const value = { language, setLanguage: handleSetLanguage, t };

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
};