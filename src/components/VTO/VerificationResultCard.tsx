import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, AlertTriangle, HelpCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface VerificationResult {
  is_match: boolean;
  confidence_score: number;
  mismatch_reason: string | null;
  fix_suggestion: string | null;
}

interface Props {
  verificationResult: VerificationResult;
}

export const VerificationResultCard = ({ verificationResult }: Props) => {
  const { is_match, confidence_score, mismatch_reason, fix_suggestion } = verificationResult;
  const confidencePercent = (confidence_score * 100).toFixed(0);

  return (
    <Card className={is_match ? "bg-green-500/10 border-green-500/50" : "bg-yellow-500/10 border-yellow-500/50"}>
      <CardHeader className="p-3">
        <CardTitle className="text-base font-semibold flex items-center justify-between">
          <div className="flex items-center gap-2">
            {is_match ? <CheckCircle className="h-5 w-5 text-green-600" /> : <AlertTriangle className="h-5 w-5 text-yellow-600" />}
            <span>QA Verdict: {is_match ? "Match" : "Mismatch"}</span>
          </div>
          <Badge variant={is_match ? "default" : "secondary"} className={is_match ? "bg-green-600" : "bg-yellow-600"}>
            Confidence: {confidencePercent}%
          </Badge>
        </CardTitle>
      </CardHeader>
      {!is_match && (mismatch_reason || fix_suggestion) && (
        <CardContent className="p-3 pt-0 space-y-2 text-sm">
          {mismatch_reason && (
            <div>
              <h4 className="font-semibold">Reason:</h4>
              <p className="text-muted-foreground">{mismatch_reason}</p>
            </div>
          )}
          {fix_suggestion && (
            <div>
              <h4 className="font-semibold">Suggestion:</h4>
              <p className="text-muted-foreground">{fix_suggestion}</p>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
};