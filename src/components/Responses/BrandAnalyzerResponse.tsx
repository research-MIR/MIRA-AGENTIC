import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Bot, Search, Image as ImageIcon, Palette, PenTool, Instagram, AlertTriangle } from "lucide-react";

interface ImageAnalysis {
  image_description: string;
  lighting_style: string;
  photography_style: string;
  composition_and_setup: string;
}

interface SiteAnalysis {
    dominant_colors: string[];
    image_analysis: ImageAnalysis[];
    synthesis: string;
    error?: string;
    reason?: string;
}

interface BrandAnalysisData {
  isBrandAnalysis: boolean;
  brand_name: string;
  website_analysis?: {
    url: string;
    analysis: SiteAnalysis;
  };
  social_media_analysis?: {
    url: string;
    analysis: SiteAnalysis;
  };
  combined_synthesis: string;
}

interface Props {
  data: BrandAnalysisData;
}

const AnalysisSection = ({ title, url, analysis }: { title: string, url: string, analysis: SiteAnalysis | null }) => {
    if (!analysis) {
        return null;
    }

    if (analysis.error) {
        return (
            <Card>
                <CardHeader className="p-3">
                    <CardTitle className="text-base font-semibold">{title}</CardTitle>
                     <a href={url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline break-all -mt-1">
                        {url}
                    </a>
                </CardHeader>
                <CardContent className="p-3 pt-0">
                    <div className="flex items-start gap-3 text-destructive">
                        <AlertTriangle className="h-5 w-5 mt-1" />
                        <div>
                            <p className="font-semibold">{analysis.error}</p>
                            <p className="text-sm opacity-90">{analysis.reason}</p>
                        </div>
                    </div>
                </CardContent>
            </Card>
        )
    }

    return (
    <Card>
        <CardHeader className="p-3">
            <CardTitle className="text-base font-semibold">{title}</CardTitle>
            <a href={url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline break-all -mt-1">
                {url}
            </a>
        </CardHeader>
        <CardContent className="p-3 pt-0">
            <Accordion type="multiple" className="w-full space-y-2">
                {analysis.image_analysis && Array.isArray(analysis.image_analysis) && analysis.image_analysis.map((image, index) => (
                <Card key={index} className="bg-background/50">
                    <AccordionItem value={`image-${index}`} className="border-none">
                    <AccordionTrigger className="p-3 hover:no-underline">
                        <div className="flex items-center gap-2">
                        <ImageIcon className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-semibold">Image Analysis #{index + 1}</span>
                        </div>
                    </AccordionTrigger>
                    <AccordionContent className="p-3 pt-0 space-y-3">
                        <p className="text-sm italic">"{image.image_description}"</p>
                        <div className="text-sm space-y-2">
                        <p><strong className="font-medium">Lighting:</strong> {image.lighting_style}</p>
                        <p><strong className="font-medium">Photography:</strong> {image.photography_style}</p>
                        <p><strong className="font-medium">Composition:</strong> {image.composition_and_setup}</p>
                        </div>
                    </AccordionContent>
                    </AccordionItem>
                </Card>
                ))}
            </Accordion>
            {analysis.dominant_colors && analysis.dominant_colors.length > 0 && (
                <div className="mt-4">
                    <h4 className="text-sm font-semibold mb-2">Dominant Colors</h4>
                    <div className="flex flex-wrap gap-2">
                        {analysis.dominant_colors.map((color) => (
                        <div key={color} className="flex items-center gap-2 text-xs p-1 bg-background rounded">
                            <div className="h-4 w-4 rounded-full border" style={{ backgroundColor: color }} />
                            <span>{color}</span>
                        </div>
                        ))}
                    </div>
                </div>
            )}
             <div className="mt-4">
                <h4 className="text-sm font-semibold mb-1">Section Synthesis</h4>
                <p className="text-sm">{analysis.synthesis}</p>
            </div>
        </CardContent>
    </Card>
    )
};

export const BrandAnalyzerResponse = ({ data }: Props) => {
  return (
    <Card className="max-w-2xl w-full bg-secondary/50">
      <CardContent className="p-0">
        <Accordion type="single" collapsible className="w-full">
          <AccordionItem value="item-1" className="border-none">
            <AccordionTrigger className="p-4 hover:no-underline">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-primary rounded-full text-primary-foreground">
                  <Bot size={20} />
                </div>
                <div className="text-left">
                  <p className="font-semibold">Executed Brand Analyzer</p>
                  <p className="text-sm text-muted-foreground">
                    Comprehensive analysis complete for {data.brand_name}.
                  </p>
                </div>
              </div>
            </AccordionTrigger>
            <AccordionContent className="p-4 pt-0">
              <div className="space-y-4">
                {data.website_analysis && <AnalysisSection title="Website Analysis" url={data.website_analysis.url} analysis={data.website_analysis.analysis} />}
                {data.social_media_analysis && <AnalysisSection title="Social Media Analysis" url={data.social_media_analysis.url} analysis={data.social_media_analysis.analysis} />}
                
                <Card>
                  <CardHeader className="p-3 flex flex-row items-center justify-between">
                    <CardTitle className="text-base font-semibold">Final Synthesis</CardTitle>
                    <PenTool className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent className="p-3 pt-0">
                    <p className="text-sm">{data.combined_synthesis}</p>
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