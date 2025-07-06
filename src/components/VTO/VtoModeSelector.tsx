import { Card, CardContent } from "@/components/ui/card";
import { Shirt, Users, Link2, Shuffle } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";

interface VtoModeSelectorProps {
  onSelectMode: (mode: 'one-to-many' | 'precise-pairs' | 'random-pairs') => void;
}

export const VtoModeSelector = ({ onSelectMode }: VtoModeSelectorProps) => {
  const { t } = useLanguage();

  return (
    <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6">
      <Card
        className="hover:border-primary hover:bg-primary/5 transition-all cursor-pointer"
        onClick={() => onSelectMode('one-to-many')}
      >
        <CardContent className="p-6 text-center">
          <div className="flex items-center justify-center gap-2 mb-4">
            <Shirt className="h-10 w-10 text-primary" />
            <Users className="h-10 w-10 text-primary" />
          </div>
          <h3 className="text-lg font-semibold">{t('oneGarmentManyModels')}</h3>
          <p className="text-sm text-muted-foreground mt-1">{t('oneGarmentManyModelsDesc')}</p>
        </CardContent>
      </Card>
      <Card
        className="hover:border-primary hover:bg-primary/5 transition-all cursor-pointer"
        onClick={() => onSelectMode('precise-pairs')}
      >
        <CardContent className="p-6 text-center">
          <Link2 className="h-10 w-10 text-primary mx-auto mb-4" />
          <h3 className="text-lg font-semibold">{t('precisePairs')}</h3>
          <p className="text-sm text-muted-foreground mt-1">{t('precisePairsDesc')}</p>
        </CardContent>
      </Card>
      <Card
        className="hover:border-primary hover:bg-primary/5 transition-all cursor-pointer"
        onClick={() => onSelectMode('random-pairs')}
      >
        <CardContent className="p-6 text-center">
          <Shuffle className="h-10 w-10 text-primary mx-auto mb-4" />
          <h3 className="text-lg font-semibold">{t('randomPairs')}</h3>
          <p className="text-sm text-muted-foreground mt-1">{t('randomPairsDesc')}</p>
        </CardContent>
      </Card>
    </div>
  );
};