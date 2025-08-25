import { AnalyzedGarment, VtoModel } from '@/types/vto';

/**
 * Determines if a given garment is compatible with a given model based on gender and target body part.
 * @param garment The analyzed garment object.
 * @param model The model object with its top-level attributes.
 * @param isStrict A boolean to enable or disable strict filtering rules.
 * @returns An object with a 'compatible' boolean and a 'reason' string for logging.
 */
export const isPoseCompatible = (garment: AnalyzedGarment | null, model: VtoModel, isStrict: boolean): { compatible: boolean; reason: string } => {
  if (!isStrict || !garment || !garment.analysis) {
    return { compatible: true, reason: "Strict filtering disabled or no garment selected." };
  }

  const logPrefix = `[isPoseCompatible] Garment fit: ${garment.analysis.type_of_fit} | Model target: ${model.target_body_part} | Garment gender: ${garment.analysis.intended_gender} | Model gender: ${model.gender} ->`;

  // Rule 1: Gender Check
  const garmentGender = garment.analysis.intended_gender;
  const modelGender = model.gender;

  if (garmentGender !== 'unisex' && garmentGender !== modelGender) {
    console.log(`${logPrefix} INCOMPATIBLE: Gender mismatch.`);
    return { compatible: false, reason: `Gender mismatch: Garment is '${garmentGender}', Model is '${modelGender}'.` };
  }

  // Rule 2: Body Part Check
  const garmentFit = garment.analysis.type_of_fit.replace(/ /g, '_'); // Normalize to snake_case
  const modelTarget = model.target_body_part;

  if (garmentFit !== modelTarget) {
    console.log(`${logPrefix} INCOMPATIBLE: Body part mismatch.`);
    return { compatible: false, reason: `Body part mismatch: Garment is for '${garmentFit}', Model is for '${modelTarget}'.` };
  }

  console.log(`${logPrefix} COMPATIBLE.`);
  return { compatible: true, reason: "Compatible" };
};

export const logPackJobStatusSummary = (packName: string, packId: string, jobs: any[]) => {
  if (!jobs || jobs.length === 0) {
    console.log(`[VTO Pack Analysis] No jobs found for pack "${packName}" (${packId}).`);
    return;
  }

  const successfulJobs: any[] = [];
  const restartableJobs: any[] = [];

  jobs.forEach(job => {
    const isSuccessful = (job.status === 'complete' || job.status === 'done') && job.final_image_url;
    if (isSuccessful) {
      successfulJobs.push(job);
    } else {
      restartableJobs.push(job);
    }
  });

  console.groupCollapsed(`[VTO Pack Analysis] Report for "${packName}" (ID: ${packId})`);

  console.table({
    'Total Jobs': jobs.length,
    '✅ Successful': successfulJobs.length,
    '🔄 To Be Restarted': restartableJobs.length,
  });

  if (successfulJobs.length > 0) {
    console.groupCollapsed(`✅ Skipped Jobs (Already Successful) [${successfulJobs.length}]`);
    successfulJobs.forEach(job => {
      console.log(`- Job ${job.id}: Skipped because status is '${job.status}' and a final image exists.`);
    });
    console.groupEnd();
  }

  if (restartableJobs.length > 0) {
    console.group(`🔄 Jobs To Be Restarted [${restartableJobs.length}]`);
    restartableJobs.forEach(job => {
      const timeSinceUpdate = job.updated_at ? `for ${new Date(job.updated_at).toLocaleTimeString()}` : 'at an unknown time';
      let reason = '';
      if (job.status === 'failed' || job.status === 'permanently_failed') {
        reason = `its status is '${job.status}'.`;
      } else if ((job.status === 'complete' || job.status === 'done') && !job.final_image_url) {
        reason = `its status is '${job.status}' but it is missing a final image URL.`;
      } else {
        reason = `it appears to be stuck in the '${job.status}' state ${timeSinceUpdate}.`;
      }
      console.log(`- Job ${job.id}: To be restarted because ${reason}`);
    });
    console.groupEnd();
  }

  console.groupEnd();
};