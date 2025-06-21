import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Wand2, Brush, Palette } from "lucide-react";

export const VirtualTryOnPro = () => {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      <div className="lg:col-span-1 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wand2 className="h-5 w-5" />
              Advanced Prompting
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Label htmlFor="pro-prompt">Detailed Prompt</Label>
            <Textarea id="pro-prompt" placeholder="e.g., A photorealistic shot of the model wearing the garment, with dramatic side lighting..." rows={6} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Brush className="h-5 w-5" />
              Mask Editor
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Mask editing controls will appear here once an image is loaded.</p>
          </CardContent>
        </Card>
      </div>
      <div className="lg:col-span-2 space-y-6">
        <Card className="h-full">
          <CardHeader>
            <CardTitle>PRO Workbench</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-96 bg-muted rounded-md flex items-center justify-center">
              <p className="text-muted-foreground">Image preview and editing area.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};