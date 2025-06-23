import { Button } from "@/components/ui/button";
import { useLanguage } from "@/context/LanguageContext";
import { useNavigate } from "react-router-dom";
import { PlusCircle } from "lucide-react";

export const TurnLimitReachedPrompt = () => {
  const { t } = useLanguage();
  const navigate = useNavigate();

  return (
    <div className="p-4 text-center text-sm text-muted-foreground bg-muted/50 border-t">
      <p className="font-semibold mb-1">{t('turnLimitReachedTitle')}</p>
      <p className="mb-3">{t('turnLimitReachedDescription')}</p>
      <Button onClick={() => navigate("/chat")}>
        <PlusCircle className="mr-2 h-4 w-4" />
        {t('newChat')}
      </Button>
    </div>
  );
};