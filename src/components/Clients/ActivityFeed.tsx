import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Bot, CheckCircle, UploadCloud } from "lucide-react";

const activities = [
  { icon: <Bot className="h-4 w-4" />, text: "Nuovo modello 3D generato per Air Max 270", time: "22/01/2024, 11:30" },
  { icon: <CheckCircle className="h-4 w-4 text-green-500" />, text: "Elaborazione completata per Collezione Primavera 2024", time: "22/01/2024, 10:15" },
  { icon: <UploadCloud className="h-4 w-4" />, text: "Caricati 5 nuovi prodotti nel progetto Linea Sportiva", time: "21/01/2024, 17:45" },
];

export const ActivityFeed = () => {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Attività Recente</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-4">
          {activities.map((activity, index) => (
            <li key={index} className="flex items-start gap-3">
              <div className="p-2 bg-muted rounded-full mt-1">
                {activity.icon}
              </div>
              <div>
                <p className="text-sm">{activity.text}</p>
                <p className="text-xs text-muted-foreground">{activity.time}</p>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
};