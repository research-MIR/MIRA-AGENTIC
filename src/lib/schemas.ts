import { z } from 'zod';

// Schema for a single image result
export const ImageResultSchema = z.object({
  publicUrl: z.string().url(),
  storagePath: z.string(),
  description: z.string().optional(),
});

// Schema for the SUCCESSFUL response from the Image Generation tool
export const ImageGenerationResponseSchema = z.object({
  isImageGeneration: z.literal(true),
  images: z.array(ImageResultSchema),
  follow_up_message: z.string().optional(),
}).passthrough();

// Schema for the SUCCESSFUL response from the Artisan Engine
export const ArtisanEngineResponseSchema = z.object({
  isArtisanResponse: z.literal(true),
  version: z.number(),
  analysis: z.record(z.string()),
  prompt: z.string(),
  rationale: z.string(),
  follow_up_message: z.string().optional(),
}).passthrough();

// A generic schema for when a tool call returns an error instead of a success payload.
const ToolErrorSchema = z.object({
    error: z.string()
}).passthrough();

// A generation result can be a success or an error.
const GenerationResultSchema = z.object({
    toolName: z.string(),
    response: z.union([ImageGenerationResponseSchema, ToolErrorSchema]),
}).passthrough();

// A critique result can be a success or an error.
const CritiqueSchema = z.object({
    critique_text: z.string(),
    is_good_enough: z.boolean(),
    diary_entry: z.string(),
}).passthrough();

// An iteration object within the creative process. Each field is optional and can be a success or error.
const IterationSchema = z.object({
    artisan_result: z.union([ArtisanEngineResponseSchema, ToolErrorSchema]).optional(),
    initial_generation_result: GenerationResultSchema.optional(),
    refined_generation_result: GenerationResultSchema.optional(),
    critique_result: z.union([CritiqueSchema, ToolErrorSchema]).optional(),
}).passthrough();

// The final, robust schema for the entire creative process response.
// It accepts an array of iterations and an optional final result.
export const CreativeProcessResponseSchema = z.object({
    isCreativeProcess: z.literal(true),
    iterations: z.array(IterationSchema),
    final_generation_result: GenerationResultSchema.optional(),
    follow_up_message: z.string().optional(),
}).passthrough();


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
}).passthrough();

export const BrandAnalyzerResponseSchema = z.object({
  isBrandAnalysis: z.literal(true),
  brand_name: z.string(),
  website_analysis: z.object({ url: z.string(), analysis: SiteAnalysisSchema }).optional(),
  social_media_analysis: z.object({ url: z.string(), analysis: SiteAnalysisSchema }).optional(),
  combined_synthesis: z.string(),
  follow_up_message: z.string().optional(),
}).passthrough();

// Schema for when the agent proposes a refinement
export const RefinementProposalSchema = z.object({
    summary: z.string(),
    options: z.array(z.object({
        url: z.string().url(),
        jobId: z.string().uuid(),
    })),
}).passthrough();

// Schema for when the agent asks the user to choose an image
export const ImageChoiceProposalSchema = z.object({
    summary: z.string(),
    images: z.array(ImageResultSchema),
}).passthrough();