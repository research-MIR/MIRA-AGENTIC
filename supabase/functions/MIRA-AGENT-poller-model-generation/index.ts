import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const COMFYUI_API_URL = Deno.env.get('COMFYUI_API_URL');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Helper function to update job status and details
async function updateJobStatus(supabase: SupabaseClient, jobId: string, status: string, details: object = {}) {
  const { error } = await supabase
    .from('mira-agent-model-generation-jobs')
    .update({ status, ...details, updated_at: new Date().toISOString() })
    .eq('id', jobId);
  if (error) throw new Error(`Failed to update job ${jobId} to status ${status}: ${error.message}`);
}

// State: generating_poses
async function handleGeneratingPosesState(supabase: SupabaseClient, job: any) {
  console.log(`[Poller][${job.id}] State: generating_poses. Invoking pose generator tool.`);
  await updateJobStatus(supabase, job.id, 'generating_poses', { status_message: 'Initializing pose generation workflow.' });

  const { data, error } = await supabase.functions.invoke('MIRA-AGENT-tool-comfyui-pose-generator', {
    body: {
      base_model_url: job.base_model_image_url,
      pose_prompt: job.model_description, // The main prompt is used for the first pose
      pose_image_url: null, // No pose image for the initial generation
    },
  });

  if (error) {
    await updateJobStatus(supabase, job.id, 'failed', { status_message: `Pose generation tool failed: ${error.message}` });
    throw new Error(`Pose generation tool invocation failed for job ${job.id}: ${error.message}`);
  }

  const comfyui_prompt_id = data.comfyui_prompt_id;
  if (!comfyui_prompt_id) {
    await updateJobStatus(supabase, job.id, 'failed', { status_message: 'Pose generator did not return a ComfyUI prompt ID.' });
    throw new Error(`Pose generator did not return a prompt ID for job ${job.id}`);
  }

  const initialPose = {
    pose_prompt: job.model_description,
    comfyui_prompt_id,
    status: 'processing',
    final_url: null,
    is_upscaled: false,
  };

  await updateJobStatus(supabase, job.id, 'polling_poses', {
    status_message: `Pose generation started. Polling ComfyUI with prompt ID: ${comfyui_prompt_id}`,
    final_posed_images: [initialPose],
  });

  console.log(`[Poller][${job.id}] Transitioned to polling_poses.`);
  return { status: 'polling_poses', message: 'Pose generation initiated.' };
}

// State: polling_poses
async function handlePollingPosesState(supabase: SupabaseClient, job: any) {
  console.log(`[Poller][${job.id}] State: polling_poses. Checking status of ${job.final_posed_images.length} poses.`);
  let allPosesComplete = true;
  let hasFailures = false;
  const updatedPoses = [...job.final_posed_images];

  for (let i = 0; i < updatedPoses.length; i++) {
    const pose = updatedPoses[i];
    if (pose.status === 'processing' && pose.comfyui_prompt_id) {
      allPosesComplete = false;
      try {
        const historyUrl = `${COMFYUI_API_URL}/history/${pose.comfyui_prompt_id}`;
        const res = await fetch(historyUrl);
        if (!res.ok) {
            console.error(`[Poller][${job.id}] ComfyUI history endpoint returned error ${res.status} for prompt ${pose.comfyui_prompt_id}`);
            continue; // Skip this pose for now, will retry on next poll
        }
        const history = await res.json();
        
        if (history[pose.comfyui_prompt_id] && history[pose.comfyui_prompt_id].outputs) {
          const outputs = history[pose.comfyui_prompt_id].outputs;
          const imageOutputNode = Object.values(outputs).find((o: any) => o.images);
          
          if (imageOutputNode) {
            const image = (imageOutputNode as any).images[0];
            const imageUrl = `${COMFYUI_API_URL}/view?filename=${image.filename}&subfolder=${image.subfolder}&type=${image.type}`;
            
            console.log(`[Poller][${job.id}] Pose for prompt "${pose.pose_prompt}" is complete. URL: ${imageUrl}`);
            pose.status = 'analyzing';
            pose.final_url = imageUrl;

            // Immediately trigger analysis
            supabase.functions.invoke('MIRA-AGENT-analyzer-pose-image', {
                body: {
                    job_id: job.id,
                    image_url: imageUrl,
                    base_model_image_url: job.base_model_image_url,
                    pose_prompt: pose.pose_prompt
                }
            }).catch(err => console.error(`[Poller][${job.id}] Failed to invoke pose analyzer for ${imageUrl}: ${err.message}`));

          } else {
             // Job might be done but no image output found, indicates an error in the ComfyUI workflow
             console.error(`[Poller][${job.id}] ComfyUI job ${pose.comfyui_prompt_id} finished but no image output was found.`);
             pose.status = 'failed';
             hasFailures = true;
          }
        }
        // If history exists but not for our prompt ID, it's still running. Do nothing.
      } catch (error) {
        console.error(`[Poller][${job.id}] Error polling ComfyUI for prompt ${pose.comfyui_prompt_id}:`, error);
        // Don't fail the pose immediately, allow for retries
      }
    } else if (pose.status === 'failed') {
        hasFailures = true;
    }
  }

  // Update the job with the new pose statuses
  await updateJobStatus(supabase, job.id, 'polling_poses', { final_posed_images: updatedPoses });

  // Check if all poses have finished (either completed and analyzed, or failed)
  const allPosesFinished = updatedPoses.every(p => p.status === 'complete' || p.status === 'failed');

  if (allPosesFinished) {
    const finalStatus = hasFailures ? 'complete_with_failures' : 'complete';
    await updateJobStatus(supabase, job.id, finalStatus, { status_message: 'All pose generation and analysis tasks are finished.' });
    console.log(`[Poller][${job.id}] All poses finished. Final job status: ${finalStatus}.`);
    return { status: finalStatus, message: 'All poses are complete.' };
  }

  return { status: 'polling_poses', message: 'Polling poses...' };
}

// Main server function
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { job_id } = await req.json();
    if (!job_id) {
      return new Response(JSON.stringify({ error: 'job_id is required' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    
    const { data: job, error: fetchError } = await supabase
      .from('mira-agent-model-generation-jobs')
      .select('*')
      .eq('id', job_id)
      .single();

    if (fetchError) {
        // Differentiate between a not-found error and a real database error
        if (fetchError.code === 'PGRST116') { // PostgREST code for "exact one row not found"
             return new Response(JSON.stringify({ error: `Job with ID ${job_id} not found.` }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 404,
            });
        }
        throw fetchError; // Throw other database errors
    }
    
    if (!job) {
        // This is a critical safeguard. If the job is not found, we stop immediately.
        return new Response(JSON.stringify({ error: `Job with ID ${job_id} not found.` }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 404,
        });
    }

    let result;
    switch (job.status) {
      case 'generating_poses':
        result = await handleGeneratingPosesState(supabase, job);
        break;
      case 'polling_poses':
        result = await handlePollingPosesState(supabase, job);
        break;
      // Other statuses are considered terminal for this poller
      case 'pending':
      case 'complete':
      case 'complete_with_failures':
      case 'failed':
        result = { status: job.status, message: `Job is in a terminal state: ${job.status}. No action taken.` };
        break;
      default:
        throw new Error(`[Poller][${job.id}] Unhandled job status: ${job.status}`);
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error('[Poller] Unhandled error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});