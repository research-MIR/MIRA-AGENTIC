import { AnalyzedGarment, Pose } from '@/types/vto';

/**
 * Determines if a given garment is compatible with a given model pose.
 * @param garment The analyzed garment object.
 * @param pose The pose object with its analysis data.
 * @returns An object with a 'compatible' boolean and a 'reason' string for logging.
 */
export const isPoseCompatible = (garment: AnalyzedGarment, pose: Pose): { compatible: boolean; reason: string } => {
  const logPrefix = `[isPoseCompatible] Garment fit: ${garment.analysis?.type_of_fit} | Pose focus: ${pose.analysis?.shoot_focus} | Pose garment coverage: ${pose.analysis?.garment.coverage} | Pose is base: ${pose.analysis?.garment.is_identical_to_base_garment} ->`;

  if (!garment.analysis || !pose.analysis) {
    console.log(`${logPrefix} INCOMPATIBLE: Missing analysis data for garment or pose.`);
    return { compatible: false, reason: "Missing analysis data for garment or pose." };
  }

  const garmentFit = garment.analysis.type_of_fit;
  const shootFocus = pose.analysis.shoot_focus;
  const poseGarment = pose.analysis.garment;

  // Rule 1: Primary Framing Check
  if (garmentFit === 'upper body' && !['upper_body', 'full_body'].includes(shootFocus)) {
    console.log(`${logPrefix} INCOMPATIBLE: Upper body garment cannot be placed on a lower body shot.`);
    return { compatible: false, reason: `Cannot place an upper body garment on a ${shootFocus} shot.` };
  }
  if (garmentFit === 'lower body' && !['lower_body', 'full_body'].includes(shootFocus)) {
    console.log(`${logPrefix} INCOMPATIBLE: Lower body garment cannot be placed on an upper body shot.`);
    return { compatible: false, reason: `Cannot place a lower body garment on an ${shootFocus} shot.` };
  }
  if (garmentFit === 'full body' && shootFocus !== 'full_body') {
    console.log(`${logPrefix} INCOMPATIBLE: Full body garment requires a full body shot.`);
    return { compatible: false, reason: `Cannot place a full body garment on a ${shootFocus} shot.` };
  }

  // Rule 2: Garment Conflict & Context Check
  if (garmentFit === 'upper body') {
    // Valid if the pose shows base underwear OR just pants. Invalid if it shows a different fashion top.
    const isValid = poseGarment.is_identical_to_base_garment === true || poseGarment.coverage === 'lower_body';
    if (!isValid) {
      console.log(`${logPrefix} INCOMPATIBLE: Cannot place an upper body garment on a model already wearing a different top.`);
      return { compatible: false, reason: "Cannot place a top on a model already wearing a different top." };
    }
  }

  if (garmentFit === 'lower body') {
    // Valid ONLY if the pose shows a REAL upper body garment. Invalid if topless OR only base bra.
    const isValid = poseGarment.coverage === 'upper_body' && poseGarment.is_identical_to_base_garment === false;
    if (!isValid) {
      console.log(`${logPrefix} INCOMPATIBLE: Cannot add pants to a model who is not wearing a top.`);
      return { compatible: false, reason: "Cannot add pants to a model who is not wearing a top." };
    }
  }

  if (garmentFit === 'full body') {
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