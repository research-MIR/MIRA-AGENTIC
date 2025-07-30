import { Card, CardContent } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Users, Bot, Wand2, AlertTriangle, CheckCircle, Package } from "lucide-react";

interface PackDashboardProps {
  stats: {
    totalJobs: number;
    processingBaseModels: number;
    processingPoses: number;
    processingUpscales: number;
    failedJobsCount: number;
    totalPoses: number;
    upscaledPoses: number;
  };
}

const StatItem = ({ icon, value, label, tooltip, variant = 'default' }: { icon: React.ReactNode, value: number, label: string, tooltip: string, variant?: 'default' | 'destructive' | 'success' }) => {
  if (value === 0) return null;

  const colors = {
    default: 'text-muted-foreground',
    destructive: 'text-destructive',
    success: 'text-green-600',
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={`flex items-center gap-2 ${colors[variant]}`}>
            {icon}
            <span className="font-bold text-lg">{value}</span>
            <span className="text-sm">{label}</span>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p>{tooltip}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export const PackDashboard = ({ stats }: PackDashboardProps) => {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-center justify-around flex-wrap gap-x-6 gap-y-2">
          <StatItem icon={<Users className="h-5 w-5" />} value={stats.totalJobs} label="Models" tooltip={`${stats.totalJobs} total model generation jobs in this pack.`} />
          <StatItem icon={<Bot className="h-5 w-5 animate-spin" />} value={stats.processingBaseModels} label="Generating" tooltip={`${stats.processingBaseModels} models are currently in the base generation or approval stage.`} />
          <StatItem icon={<Package className="h-5 w-5 animate-spin" />} value={stats.processingPoses} label="Posing" tooltip={`${stats.processingPoses} models are currently generating their poses.`} />
          <StatItem icon={<Wand2 className="h-5 w-5 animate-spin" />} value={stats.processingUpscales} label="Upscaling" tooltip={`${stats.processingUpscales} models are currently having their poses upscaled.`} />
          <StatItem icon={<AlertTriangle className="h-5 w-5" />} value={stats.failedJobsCount} label="Failed" tooltip={`${stats.failedJobsCount} jobs have failed.`} variant="destructive" />
          <StatItem icon={<CheckCircle className="h-5 w-5" />} value={stats.upscaledPoses} label="Ready for VTO" tooltip={`${stats.upscaledPoses} out of ${stats.totalPoses} total poses are upscaled and ready for Virtual Try-On.`} variant="success" />
        </div>
      </CardContent>
    </Card>
  );
};