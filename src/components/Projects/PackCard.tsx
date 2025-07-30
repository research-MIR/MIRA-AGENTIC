import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Package, Trash2, ImageIcon, Shirt, Users } from "lucide-react";
import { Link } from "react-router-dom";

interface Pack {
  pack_id: string;
  pack_name: string;
  pack_description: string | null;
  total_jobs?: number;
  unique_garment_count?: number;
  created_at: string;
  total_models?: number;
  upscaled_poses?: number;
  total_poses?: number;
}

interface PackCardProps {
  pack: Pack;
  packType: 'model' | 'garment' | 'vto';
  onRemove: (packId: string) => void;
}

export const PackCard = ({ pack, packType, onRemove }: PackCardProps) => {
  const getLinkPath = () => {
    switch (packType) {
      case 'model': return `/model-packs/${pack.pack_id}`;
      case 'garment': return `/wardrobe-packs/${pack.pack_id}`;
      case 'vto': return `/vto-reports/${pack.pack_id}`;
      default: return '#';
    }
  };

  return (
    <Card className="group relative">
      <Link to={getLinkPath()}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Package className="h-5 w-5 text-primary" />
            <span className="truncate">{pack.pack_name || `Pack from ${new Date(pack.created_at).toLocaleDateString()}`}</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground line-clamp-2 h-10">
            {pack.pack_description || "No description."}
          </p>
          {packType === 'vto' && (
            <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground border-t pt-2">
              <div className="flex items-center gap-1">
                <ImageIcon className="h-3 w-3" />
                <span>{pack.total_jobs} images</span>
              </div>
              <div className="flex items-center gap-1">
                <Shirt className="h-3 w-3" />
                <span>{pack.unique_garment_count} garments</span>
              </div>
            </div>
          )}
          {packType === 'model' && (
            <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground border-t pt-2">
              <div className="flex items-center gap-1">
                <Users className="h-3 w-3" />
                <span>{pack.total_models} models</span>
              </div>
              <div className="flex items-center gap-1">
                <ImageIcon className="h-3 w-3" />
                <span>{pack.upscaled_poses} / {pack.total_poses} upscaled</span>
              </div>
            </div>
          )}
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