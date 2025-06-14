import { z } from 'zod';

// Schema for a single image result
export const ImageResultSchema = z.object({
  publicUrl: z.string().url(),
  storagePath: z.string(),
  description: z.string().optional(),
});

// Schema for the response from the Image Generation tool
export const ImageGenerationResponseSchema = z.object({
  isImageGeneration: z.literal(true),
  images: z.array(ImageResultSchema),
  follow_up_message: z.string().optional(),
});

// Schema for the Artisan Engine's analysis and prompt generation
export const ArtisanEngineResponseSchema = z.object({
  isArtisanResponse: z.literal(true),
  version: z.number(),
  analysis: z.record(z.string()),
  prompt: z.string(),
  rationale: z.string(),
  follow_up_message: z.string().optional(),
});

// Schemas for the Brand Analyzer tool
const SiteAnalysisSchema = z.object({
    dominant_colors: z.array(z.string()).optional(),
    image_analysis: z.array(z.object({
        image_description: z.string(),
        lighting_style: z.string(),
        photography_style: z.string(),
        composition_and_setup: z.string(),
    })).optional(),
    synthesis: z.string().optional(),
    error: z.string().optional(),
    reason: z.string().optional(),
});

export const BrandAnalyzerResponseSchema = z.object({
  isBrandAnalysis: z.literal(true),
  brand_name: z.string(),
  website_analysis: z.object({ url: z.string(), analysis: SiteAnalysisSchema }).optional(),
  social_media_analysis: z.object({ url: z.string(), analysis: SiteAnalysisSchema }).optional(),
  combined_synthesis: z.string(),
  follow_up_message: z.string().optional(),
});

// Schema for the multi-step creative process response
export const CreativeProcessResponseSchema = z.object({
    isCreativeProcess: z.literal(true),
    iterations: z.array(z.any()), // Keeping this flexible for now
    final_generation_result: z.any(), // And this
    follow_up_message: z.string().optional(),
});

// Schema for when the agent proposes a refinement
export const RefinementProposalSchema = z.object({
    summary: z.string(),
    options: z.array(z.object({
        url: z.string().url(),
        jobId: z.string().uuid(),
    })),
});

// Schema for when the agent asks the user to choose an image
export const ImageChoiceProposalSchema = z.object({
    summary: z.string(),
    images: z.array(ImageResultSchema),
});