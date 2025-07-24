import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Shirt, Users, Link2, Shuffle, Library } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";

type VtoMode = 'one-to-many' | 'random-pairs' | 'precise-pairs' | 'wardrobe';

interface VtoModeSelectorProps {
  onSelectMode: (mode: VtoMode) => void;
}

export const VtoModeSelector = ({ onSelectMode }: VtoModeSelectorProps) => {
  const { t } = useLanguage();

  const modes = [
    { id: 'one-to-many', title: t('oneGarmentManyModels'), description: t('oneGarmentManyModelsDesc'), icon: <Users className="h-8 w-8" /> },
    { id: 'random-pairs', title: t('randomPairs'), description: t('randomPairsInputDescription'), icon: <Shuffle className="h-8 w-8" /> },
    { id: 'precise-pairs', title: t('precisePairs'), description: t('precisePairsInputDescription'), icon: <Link2 className="h-8 w-8" /> },
    { id: 'wardrobe', title: t('myWardrobe'), description: t('wardrobeDescription'), icon: <Library className="h-8 w-8" /> },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {modes.map(mode => (
        <Card key={mode.id} className="hover:border-primary transition-colors">
          <CardHeader>
            <div className="flex items-center gap-4">
              <div className="p-3 bg-muted rounded-md">{mode.icon}</div>
              <div>
                <CardTitle>{mode.title}</CardTitle>
                <CardDescription>{mode.description}</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Button className="w-full" onClick={() => onSelectMode(mode.id as VtoMode)}>Select</Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
};