import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Lightbulb } from "lucide-react";

export const SuggestionsCard = () => {
  return (
    <Card className="bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800/50">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Lightbulb className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
          Suggerimenti
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="list-disc list-inside text-sm space-y-1 text-yellow-800 dark:text-yellow-300">
          <li>Carica prodotti in batch per velocizzare il processo</li>
          <li>Usa immagini con sfondo neutro per risultati migliori</li>
          <li>Organizza i prodotti per collezione</li>
        </ul>
      </CardContent>
    </Card>
  );
};