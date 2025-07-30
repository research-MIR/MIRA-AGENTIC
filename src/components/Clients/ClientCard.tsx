import { Card, CardContent } from "@/components/ui/card";
import { Link } from "react-router-dom";
import { ArrowRight, Users } from "lucide-react";

interface Client {
  client_id: string;
  client_name: string;
  project_count: number;
}

interface ClientCardProps {
  client: Client;
}

export const ClientCard = ({ client }: ClientCardProps) => {
  return (
    <Link to={`/clients/${client.client_id}`}>
      <Card className="hover:border-primary hover:bg-primary/5 transition-all duration-200 h-full">
        <CardContent className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-muted rounded-lg">
              <Users className="h-6 w-6 text-muted-foreground" />
            </div>
            <div>
              <p className="font-semibold">{client.client_name}</p>
              <p className="text-sm text-muted-foreground">{client.project_count} active projects</p>
            </div>
          </div>
          <ArrowRight className="h-5 w-5 text-muted-foreground" />
        </CardContent>
      </Card>
    </Link>
  );
};