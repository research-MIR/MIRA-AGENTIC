import { Shirt } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";

const VirtualTryOn = () => {
  const { t } = useLanguage();

  return (
    <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground p-8">
      <Shirt className="h-16 w-16 mb-4" />
      <h1 className="text-2xl font-bold text-foreground">{t.virtualTryOn}</h1>
      <p className="mt-2">{t.comingSoon}</p>
    </div>
  );
};

export default VirtualTryOn;