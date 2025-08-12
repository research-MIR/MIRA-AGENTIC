import { AnalyzedGarment, Pose } from '@/types/vto';
import { formatDistanceToNowStrict } from 'date-fns';

/**
 * Determines if a given garment is compatible with a given model pose.
 * @param garment The analyzed garment object.
 * @param pose The pose object with its analysis data.
 * @param isStrict A boolean to enable or disable strict filtering rules.
 * @returns An object with a 'compatible' boolean and a 'reason' string for logging.
 */
export const isPoseCompatible = (garment: AnalyzedGarment, pose: Pose, isStrict: boolean): { compatible: boolean; reason: string } => {
  if (!isStrict) {
    return { compatible: true, reason: "Strict filtering disabled by user." };
  }

  const poseAnalysis = pose.analysis as any; // Use any to handle different shapes
  const poseGarmentAnalysis = poseAnalysis?.garment_analysis || poseAnalysis?.garment;
  const shootFocus = poseAnalysis?.shoot_focus;

  const logPrefix = `[isPoseCompatible] Garment fit: ${garment.analysis?.type_of_fit} | Pose focus: ${shootFocus} | Pose garment coverage: ${poseGarmentAnalysis?.coverage} | Pose is base: ${poseGarmentAnalysis?.is_identical_to_base_garment} ->`;

  if (!garment.analysis || !poseGarmentAnalysis) {
    console.log(`${logPrefix} INCOMPATIBLE: Missing analysis data for garment or pose.`);
    return { compatible: false, reason: "Missing analysis data for garment or pose." };
  }
  
  if (!shootFocus) {
    console.warn(`${logPrefix} WARNING: 'shoot_focus' is missing from pose analysis. Compatibility check will be less accurate.`);
  }

  // Normalize values to be safe against spaces vs underscores
  const garmentFit = garment.analysis.type_of_fit.replace(/ /g, '_');
  const poseGarment = {
      ...poseGarmentAnalysis,
      coverage: poseGarmentAnalysis.coverage?.replace(/ /g, '_'),
  };

  // Rule 1: Primary Framing Check (only if shootFocus is available)
  if (shootFocus) {
    const normalizedShootFocus = shootFocus.replace(/ /g, '_');
    if (garmentFit === 'upper_body' && !['upper_body', 'full_body'].includes(normalizedShootFocus)) {
      console.log(`${logPrefix} INCOMPATIBLE: Upper body garment cannot be placed on a lower body shot.`);
      return { compatible: false, reason: `Cannot place an upper body garment on a ${shootFocus} shot.` };
    }
    if (garmentFit === 'lower_body' && !['lower_body', 'full_body'].includes(normalizedShootFocus)) {
      console.log(`${logPrefix} INCOMPATIBLE: Lower body garment cannot be placed on an upper body shot.`);
      return { compatible: false, reason: `Cannot place a lower body garment on a ${shootFocus} shot.` };
    }
    if (garmentFit === 'full_body' && normalizedShootFocus !== 'full_body') {
      console.log(`${logPrefix} INCOMPATIBLE: Full body garment requires a full body shot.`);
      return { compatible: false, reason: `Cannot place a full body garment on a ${shootFocus} shot.` };
    }
    if (garmentFit === 'shoes' && normalizedShootFocus !== 'full_body') {
      console.log(`${logPrefix} INCOMPATIBLE: Shoes require a full body shot.`);
      return { compatible: false, reason: `Cannot place shoes on a ${shootFocus} shot.` };
    }
  }

  // Rule 2: Garment Conflict & Context Check
  if (garmentFit === 'upper_body') {
    // Valid if the pose shows base underwear OR just pants. Invalid if it shows a different fashion top.
    const isValid = poseGarment.is_identical_to_base_garment === true || poseGarment.coverage === 'lower_body';
    if (!isValid) {
      console.log(`${logPrefix} INCOMPATIBLE: Cannot place an upper body garment on a model already wearing a different top.`);
      return { compatible: false, reason: "Cannot place a top on a model already wearing a different top." };
    }
  }

  if (garmentFit === 'lower_body') {
    // Valid ONLY if the pose shows a REAL upper body garment. Invalid if topless OR only base bra.
    const isValid = poseGarment.coverage === 'upper_body' && poseGarment.is_identical_to_base_garment === false;
    if (!isValid) {
      console.log(`${logPrefix} INCOMPATIBLE: Cannot add pants to a model who is not wearing a top.`);
      return { compatible: false, reason: "Cannot add pants to a model who is not wearing a top." };
    }
  }

  if (garmentFit === 'full_body') {
    // Valid ONLY if the pose shows the base underwear.
    const isValid = poseGarment.is_identical_to_base_garment === true;
    if (!isValid) {
      console.log(`${logPrefix} INCOMPATIBLE: A dress can only be applied to a base model.`);
      return { compatible: false, reason: "A dress or full-body outfit can only be applied to a base model." };
    }
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
      const timeSinceUpdate = job.updated_at ? `for ${formatDistanceToNowStrict(new Date(job.updated_at))}` : 'at an unknown time';
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