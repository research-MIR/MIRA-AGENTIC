import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Package, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";

interface Pack {
  pack_id: string;
  pack_name: string;
  pack_description: string | null;
}

interface PackCardProps {
  pack: Pack;
  packType: 'model' | 'garment';
  onRemove: (packId: string) => void;
}

export const PackCard = ({ pack, packType, onRemove }: PackCardProps) => {
  const linkPath = packType === 'model' ? `/model-packs/${pack.pack_id}` : `/wardrobe-packs/${pack.pack_id}`;

  return (
    <Card className="group relative">
      <Link to={linkPath}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Package className="h-5 w-5 text-primary" />
            <span className="truncate">{pack.pack_name}</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground line-clamp-2 h-10">
            {pack.pack_description || "No description."}
          </p>
        </CardContent>
      </Link>
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-2 right-2 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={() => onRemove(pack.pack_id)}
      >
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>
    </Card>
  );
};