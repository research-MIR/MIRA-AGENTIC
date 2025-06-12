import { useLanguage } from "@/context/LanguageContext";
import { Button } from "@/components/ui/button";

export const LanguageSwitcher = () => {
  const { language, setLanguage } = useLanguage();

  const toggleLanguage = () => {
    setLanguage(language === 'it' ? 'en' : 'it');
  };

  return (
    <Button variant="outline" size="sm" onClick={toggleLanguage} className="w-[50px]">
      {language.toUpperCase()}
    </Button>
  );
};