import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Shirt, AlertTriangle, Info } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { SecureImageDisplay } from "@/components/VTO/SecureImageDisplay";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { showSuccess } from "@/utils/toast";

interface Garment {
  id: string;
  name: string;
  storage_path: string;
  attributes: {
    intended_gender: 'male' | 'female' | 'unisex';
    type_of_fit: 'upper body' | 'lower body' | 'full body' | 'upper_body' | 'lower_body' | 'full_body';
    primary_color: string;
    style_tags?: string[];
  } | null;
}

const Wardrobe = () => {
  const { supabase, session } = useSession();
  const { t } = useLanguage();

  const { data: garments, isLoading, error } = useQuery<Garment[]>({
    queryKey: ["garments", session?.user?.id],
    queryFn: async () => {
      if (!session?.user) return [];
      const { data, error } = await supabase
        .from("mira-agent-garments")
        .select("*")
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!session?.user,
  });

  const handleInfoClick = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    navigator.clipboard.writeText(id);
    showSuccess("Garment ID copied to clipboard!");
  };

  return (
    <div className="p-4 md:p-8 h-screen overflow-y-auto">
      <header className="pb-4 mb-8 border-b">
        <h1 className="text-3xl font-bold">{t('wardrobe')}</h1>
        <p className="text-muted-foreground">{t('wardrobeDescription')}</p>
      </header>

      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {[...Array(12)].map((_, i) => <Skeleton key={i} className="aspect-square w-full" />)}
        </div>
      ) : error ? (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      ) : garments && garments.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {garments.map(garment => (
            <Card key={garment.id} className="overflow-hidden group relative">
              <CardContent className="p-0">
                <div className="aspect-square bg-muted">
                  <SecureImageDisplay imageUrl={garment.storage_path} alt={garment.name} />
                </div>
                <div className="p-2 text-xs space-y-1 border-t">
                  <p className="font-semibold truncate">{garment.name}</p>
                  {garment.attributes && (
                    <div className="flex flex-wrap gap-1">
                      <Badge variant="outline" className="capitalize">{garment.attributes.intended_gender}</Badge>
                      <Badge variant="secondary" className="capitalize">{garment.attributes.type_of_fit.replace(/_/g, ' ')}</Badge>
                    </div>
                  )}
                </div>
              </CardContent>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="absolute bottom-1 left-1 h-6 w-6 z-10 bg-black/50 hover:bg-black/70 text-white hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => handleInfoClick(e, garment.id)}
                    >
                      <Info className="h-3 w-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" align="start" onClick={(e) => e.stopPropagation()}>
                    <p className="text-xs">Click to copy Garment ID</p>
                    <p className="text-xs font-mono max-w-xs break-all">{garment.id}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </Card>
          ))}
        </div>
      ) : (
        <div className="text-center py-16">
          <Shirt className="mx-auto h-16 w-16 text-muted-foreground" />
          <h2 className="mt-4 text-xl font-semibold">{t('noGarmentsTitle')}</h2>
          <p className="mt-2 text-muted-foreground">{t('noGarmentsDescription')}</p>
        </div>
      )}
    </div>
  );
};

export default Wardrobe;