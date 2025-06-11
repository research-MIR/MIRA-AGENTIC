import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Bot } from "lucide-react";

interface ArtisanResponseData {
  isArtisanResponse: boolean;
  version: number;
  analysis: { [key: string]: string };
  prompt: string;
  rationale: string;
}

interface Props {
  data: ArtisanResponseData;
}

export const ArtisanEngineResponse = ({ data }: Props) => {
  return (
    <Card className="max-w-lg w-full bg-secondary/50">
      <CardContent className="p-0">
        <Accordion type="single" collapsible className="w-full">
          <AccordionItem value="item-1" className="border-none">
            <AccordionTrigger className="p-4 hover:no-underline flex justify-between items-center">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-primary rounded-full text-primary-foreground">
                  <Bot size={20} />
                </div>
                <div className="text-left">
                  <p className="font-semibold">Executed Artisan Prompter</p>
                  <p className="text-sm text-muted-foreground">
                    Generated Prompt V{data.version}. Click to view details.
                  </p>
                </div>
              </div>
            </AccordionTrigger>
            <AccordionContent className="p-4 pt-0">
              <div className="max-h-72 overflow-y-auto pr-3 space-y-2">
                <Card>
                  <CardHeader className="p-3">
                    <CardTitle className="text-base font-semibold">Analysis</CardTitle>
                  </CardHeader>
                  <CardContent className="p-3 pt-0">
                    <ul className="space-y-1 text-sm">
                      {Object.entries(data.analysis).map(([key, value]) => (
                        <li key={key}>
                          <strong className="font-medium">{key}:</strong> {value}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="p-3">
                    <CardTitle className="text-base font-semibold">Prompt V{data.version}</CardTitle>
                  </CardHeader>
                  <CardContent className="p-3 pt-0">
                    <p className="text-sm whitespace-pre-wrap font-mono bg-background p-2 rounded-md">{data.prompt}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="p-3">
                    <CardTitle className="text-base font-semibold">Rationale</CardTitle>
                  </CardHeader>
                  <CardContent className="p-3 pt-0">
                    <p className="text-sm">{data.rationale}</p>
                  </CardContent>
                </Card>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>
    </Card>
  );
};