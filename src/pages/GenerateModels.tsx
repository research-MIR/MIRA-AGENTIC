import { useLanguage } from "@/context/LanguageContext";

const GenerateModels = () => {
  const { t } = useLanguage();

  return (
    <div className="p-4 md:p-8 h-screen overflow-y-auto">
      <header className="pb-4 mb-8 border-b">
        <h1 className="text-3xl font-bold">{t('generateModels')}</h1>
        <p className="text-muted-foreground">This page is under construction.</p>
      </header>
      <div className="max-w-2xl">
        {/* Content will go here */}
      </div>
    </div>
  );
};

export default GenerateModels;