import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Shirt, AlertTriangle } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { SecureImageDisplay } from "@/components/VTO/SecureImageDisplay";
import { Badge } from "@/components/ui/badge";

interface Garment {
  id: string;
  name: string;
  storage_path: string;
  attributes: {
    intended_gender: 'male' | 'female' | 'unisex';
    type_of_fit: 'upper body' | 'lower body' | 'full body';
    primary_color: string;
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
            <Card key={garment.id} className="overflow-hidden">
              <CardContent className="p-0">
                <div className="aspect-square bg-muted">
                  <SecureImageDisplay imageUrl={garment.storage_path} alt={garment.name} />
                </div>
                <div className="p-2 text-xs space-y-1">
                  <p className="font-semibold truncate">{garment.name}</p>
                  {garment.attributes && (
                    <div className="flex flex-wrap gap-1">
                      <Badge variant="outline">{garment.attributes.intended_gender}</Badge>
                      <Badge variant="secondary">{garment.attributes.type_of_fit}</Badge>
                    </div>
                  )}
                </div>
              </CardContent>
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