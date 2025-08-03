import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle, UserCheck2, BadgeAlert, FileText, XCircle } from "lucide-react";

interface ReportStatsData {
  passed_perfect: number;
  passed_pose_change: number;
  passed_logo_issue: number;
  passed_detail_issue: number;
  failed_jobs: number;
}

interface ReportStatsProps {
  stats: ReportStatsData | null;
}

const StatItem = ({ icon, value, label, colorClass }: { icon: React.ReactNode, value: number, label: string, colorClass: string }) => {
  if (value === 0) return null;
  return (
    <div className={`flex items-center gap-2 ${colorClass}`}>
      {icon}
      <span className="text-lg font-bold">{value}</span>
      <span className="text-sm">{label}</span>
    </div>
  );
};

export const ReportStats = ({ stats }: ReportStatsProps) => {
  if (!stats) return null;

  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-center justify-around flex-wrap gap-x-4 gap-y-2">
          <StatItem icon={<CheckCircle className="h-5 w-5" />} value={stats.passed_perfect} label="Passed" colorClass="text-green-600" />
          <StatItem icon={<UserCheck2 className="h-5 w-5" />} value={stats.passed_pose_change} label="Passed (Pose Change)" colorClass="text-yellow-600" />
          <StatItem icon={<BadgeAlert className="h-5 w-5" />} value={stats.passed_logo_issue} label="Passed (Logo Issue)" colorClass="text-orange-500" />
          <StatItem icon={<FileText className="h-5 w-5" />} value={stats.passed_detail_issue} label="Passed (Detail Issue)" colorClass="text-orange-500" />
          <StatItem icon={<XCircle className="h-5 w-5" />} value={stats.failed_jobs} label="Failed" colorClass="text-destructive" />
        </div>
      </CardContent>
    </Card>
  );
};