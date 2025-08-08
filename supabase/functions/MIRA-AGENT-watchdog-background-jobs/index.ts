import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

const STALLED_PENDING_PAIR_JOB_THRESHOLD_SECONDS = 30;
const STALLED_SEGMENTING_THRESHOLD_SECONDS = 120;
const STALLED_AWAITING_FIX_THRESHOLD_SECONDS = 60;
const STALLED_COMPOSITING_THRESHOLD_SECONDS = 120;
const STALLED_VTO_WORKER_CATCH_ALL_THRESHOLD_SECONDS = 55;
const MAX_WATCHDOG_RETRIES = 3;
const STALLED_MASK_EXPANDED_THRESHOLD_SECONDS = 120;
const STALLED_PROCESSING_STEP_2_THRESHOLD_SECONDS = 60;

serve(async (req)=>{
  const requestId = `watchdog-bg-${Date.now()}`;
  console.log(`[Watchdog-BG][${requestId}] Invocation attempt.`);
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  try {
    const { data: lockAcquired, error: lockError } = await supabase.rpc('try_acquire_watchdog_lock');
    if (lockError) {
      console.error(`[Watchdog-BG][${requestId}] Error acquiring advisory lock:`, lockError.message);
      throw lockError;
    }
    if (!lockAcquired) {
      console.log(`[Watchdog-BG][${requestId}] Advisory lock is held by another process. Exiting gracefully.`);
      return new Response(JSON.stringify({
        message: "Lock held, skipping execution."
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        },
        status: 200
      });
    }
    console.log(`[Watchdog-BG][${requestId}] Advisory lock acquired. Proceeding with checks.`);
    const actionsTaken: string[] = [];
    
    // --- Each task is now wrapped in its own try/catch block for maximum resilience ---
    try {
      console.log(`[Watchdog-BG][${requestId}] === Task 1: Triggering Self-Sufficient BitStudio Poller ===`);
      const { error: invokeError } = await supabase.functions.invoke('MIRA-AGENT-poller-bitstudio', {
        body: {}
      });
      if (invokeError) throw invokeError;
      console.log(`[Watchdog-BG][${requestId}] Task 1: Successfully invoked self-sufficient BitStudio poller.`);
      actionsTaken.push(`Triggered self-sufficient BitStudio poller.`);
    } catch (e) {
      console.error(`[Watchdog-BG][${requestId}] Task 1 (Self-Sufficient Poller) failed:`, e.message);
    }
    try {
      console.log(`[Watchdog-BG][${requestId}] === Task 2: Triggering Batch Inpaint Worker ===`);
      const { error: invokeError } = await supabase.functions.invoke('MIRA-AGENT-worker-batch-inpaint', {
        body: {}
      });
      if (invokeError) throw invokeError;
      console.log(`[Watchdog-BG][${requestId}] Task 2: Successfully invoked batch inpaint worker.`);
      actionsTaken.push(`Triggered batch inpaint worker.`);
    } catch (e) {
      console.error(`[Watchdog-BG][${requestId}] Task 2 (Batch Inpaint) failed:`, e.message);
    }
    try {
      console.log(`[Watchdog-BG][${requestId}] === Task 3: Triggering COMPLETED Segmentation Aggregation ===`);
      const { data: readyJobs, error: rpcError } = await supabase.rpc('find_aggregation_jobs_ready_for_compositor');
      if (rpcError) {
        console.error(`[Watchdog-BG][${requestId}] Error calling find_aggregation_jobs_ready_for_compositor RPC:`, rpcError.message);
        throw rpcError;
      }
      if (readyJobs && readyJobs.length > 0) {
        console.log(`[Watchdog-BG][${requestId}] Found ${readyJobs.length} aggregation job(s) ready for compositing.`);
        const compositorPromises = readyJobs.map((job)=>{
          console.log(`[Watchdog-BG][${requestId}] Invoking compositor for job ${job.job_id}.`);
          return supabase.functions.invoke('MIRA-AGENT-compositor-segmentation', {
            body: {
              job_id: job.job_id
            }
          });
        });
        await Promise.allSettled(compositorPromises);
        actionsTaken.push(`Triggered compositor for ${readyJobs.length} completed aggregation jobs.`);
      } else {
        console.log(`[Watchdog-BG][${requestId}] No aggregation jobs ready for compositing.`);
      }
    } catch (e) {
      console.error(`[Watchdog-BG][${requestId}] Task 3 (Completed Aggregations) failed:`, e.message);
    }
    try {
      console.log(`[Watchdog-BG][${requestId}] === NEW TASK: Recovering Stalled 'pending' Pair Jobs ===`);
      const threshold = new Date(Date.now() - STALLED_PENDING_PAIR_JOB_THRESHOLD_SECONDS * 1000).toISOString();
      const { data: stalledJobs, error } = await supabase.from('mira-agent-batch-inpaint-pair-jobs').select('id').eq('status', 'pending').lt('updated_at', threshold);
      if (error) throw error;
      if (stalledJobs && stalledJobs.length > 0) {
        console.log(`[Watchdog-BG][${requestId}] Found ${stalledJobs.length} stalled 'pending' jobs. Re-triggering worker...`);
        const recoveryPromises = stalledJobs.map((job)=>supabase.functions.invoke('MIRA-AGENT-worker-batch-inpaint', {
            body: {
              pair_job_id: job.id
            }
          }));
        await Promise.allSettled(recoveryPromises);
        actionsTaken.push(`Re-triggered ${stalledJobs.length} stalled 'pending' jobs.`);
      } else {
        console.log(`[Watchdog-BG][${requestId}] No stalled 'pending' jobs found.`);
      }
    } catch (e) {
      console.error(`[Watchdog-BG][${requestId}] Task (Stalled Pending) failed:`, e.message);
    }
    try {
      console.log(`[Watchdog-BG][${requestId}] === NEW TASK: Recovering Stalled 'segmenting' Jobs ===`);
      const threshold = new Date(Date.now() - STALLED_SEGMENTING_THRESHOLD_SECONDS * 1000).toISOString();
      const { data: stalledJobs, error } = await supabase.from('mira-agent-batch-inpaint-pair-jobs').select('id').in('status', ['segmenting']).lt('updated_at', threshold);
      if (error) throw error;
      if (stalledJobs && stalledJobs.length > 0) {
        console.log(`[Watchdog-BG][${requestId}] Found ${stalledJobs.length} stalled 'segmenting' jobs. Resetting to 'pending'.`);
        const jobIds = stalledJobs.map((j)=>j.id);
        await supabase.from('mira-agent-batch-inpaint-pair-jobs').update({
          status: 'pending',
          error_message: 'Reset by watchdog due to stall in segmentation.'
        }).in('id', jobIds);
        actionsTaken.push(`Reset ${stalledJobs.length} stalled 'segmenting' jobs.`);
      } else {
        console.log(`[Watchdog-BG][${requestId}] No stalled 'segmenting' jobs found.`);
      }
    } catch (e) {
      console.error(`[Watchdog-BG][${requestId}] Task (Stalled Segmenting) failed:`, e.message);
    }
    try {
        console.log(`[Watchdog-BG][${requestId}] === NEW TASK: Recovering Stalled 'mask_expanded' Jobs ===`);
        const threshold = new Date(Date.now() - STALLED_MASK_EXPANDED_THRESHOLD_SECONDS * 1000).toISOString();
        const { data: stalledJobs, error } = await supabase.from('mira-agent-batch-inpaint-pair-jobs').select('id, user_id, metadata').eq('status', 'mask_expanded').lt('updated_at', threshold);
        if (error) throw error;
        if (stalledJobs && stalledJobs.length > 0) {
            console.log(`[Watchdog-BG][${requestId}] Found ${stalledJobs.length} stalled 'mask_expanded' jobs. Re-triggering expander...`);
            const recoveryPromises = stalledJobs.map(job => {
                const rawMaskUrl = job.metadata?.debug_assets?.raw_mask_url;
                if (!rawMaskUrl) {
                    console.error(`[Watchdog-BG][${requestId}] Cannot recover job ${job.id}, missing raw_mask_url.`);
                    return Promise.resolve();
                }
                return supabase.functions.invoke('MIRA-AGENT-expander-mask', { body: { parent_pair_job_id: job.id, raw_mask_url: rawMaskUrl, user_id: job.user_id } });
            });
            await Promise.allSettled(recoveryPromises);
            actionsTaken.push(`Re-triggered ${stalledJobs.length} stalled 'mask_expanded' jobs.`);
        } else {
            console.log(`[Watchdog-BG][${requestId}] No stalled 'mask_expanded' jobs found.`);
        }
    } catch (e) {
        console.error(`[Watchdog-BG][${requestId}] Task (Stalled Mask Expanded) failed:`, e.message);
    }
    try {
        console.log(`[Watchdog-BG][${requestId}] === NEW TASK: Recovering Stalled 'processing_step_2' Jobs ===`);
        const threshold = new Date(Date.now() - STALLED_PROCESSING_STEP_2_THRESHOLD_SECONDS * 1000).toISOString();
        const { data: stalledJobs, error } = await supabase.from('mira-agent-batch-inpaint-pair-jobs').select('id, metadata').eq('status', 'processing_step_2').lt('updated_at', threshold);
        if (error) throw error;
        if (stalledJobs && stalledJobs.length > 0) {
            console.log(`[Watchdog-BG][${requestId}] Found ${stalledJobs.length} stalled 'processing_step_2' jobs. Re-triggering worker...`);
            const recoveryPromises = stalledJobs.map(job => {
                const finalMaskUrl = job.metadata?.debug_assets?.expanded_mask_url;
                if (!finalMaskUrl) {
                    console.error(`[Watchdog-BG][${requestId}] Cannot recover job ${job.id}, missing expanded_mask_url.`);
                    return Promise.resolve();
                }
                return supabase.functions.invoke('MIRA-AGENT-worker-batch-inpaint-step2', { body: { pair_job_id: job.id, final_mask_url: finalMaskUrl } });
            });
            await Promise.allSettled(recoveryPromises);
            actionsTaken.push(`Re-triggered ${stalledJobs.length} stalled 'processing_step_2' jobs.`);
        } else {
            console.log(`[Watchdog-BG][${requestId}] No stalled 'processing_step_2' jobs found.`);
        }
    } catch (e) {
        console.error(`[Watchdog-BG][${requestId}] Task (Stalled Step 2) failed:`, e.message);
    }
    try {
      console.log(`[Watchdog-BG][${requestId}] === NEW TASK: Recovering Stalled 'awaiting_fix' Jobs ===`);
      const threshold = new Date(Date.now() - STALLED_AWAITING_FIX_THRESHOLD_SECONDS * 1000).toISOString();
      const { data: stalledJobs, error } = await supabase.from('mira-agent-bitstudio-jobs').select('id, metadata').eq('status', 'awaiting_fix').lt('updated_at', threshold);
      if (error) throw error;
      if (stalledJobs && stalledJobs.length > 0) {
        console.log(`[Watchdog-BG][${requestId}] Found ${stalledJobs.length} stalled 'awaiting_fix' jobs. Applying retry logic...`);
        const recoveryPromises = stalledJobs.map(async (job)=>{
          const retries = (job.metadata?.watchdog_retries || 0) + 1;
          if (retries > MAX_WATCHDOG_RETRIES) {
            await supabase.from('mira-agent-bitstudio-jobs').update({
              status: 'permanently_failed',
              error_message: `Job stalled in 'awaiting_fix' and failed after ${MAX_WATCHDOG_RETRIES} recovery attempts.`
            }).eq('id', job.id);
          } else {
            await supabase.from('mira-agent-bitstudio-jobs').update({
              metadata: {
                ...job.metadata,
                watchdog_retries: retries
              }
            }).eq('id', job.id);
            await supabase.functions.invoke('MIRA-AGENT-fixer-orchestrator', {
              body: {
                job_id: job.id,
                qa_report_object: job.metadata?.qa_history?.slice(-1)[0]
              }
            });
          }
        });
        await Promise.allSettled(recoveryPromises);
        actionsTaken.push(`Processed ${stalledJobs.length} stalled 'awaiting_fix' jobs.`);
      } else {
        console.log(`[Watchdog-BG][${requestId}] No stalled 'awaiting_fix' jobs found.`);
      }
    } catch (e) {
      console.error(`[Watchdog-BG][${requestId}] Task (Stalled Awaiting Fix) failed:`, e.message);
    }
    try {
      console.log(`[Watchdog-BG][${requestId}] === NEW TASK: Recovering Stalled 'compositing' Jobs ===`);
      const threshold = new Date(Date.now() - STALLED_COMPOSITING_THRESHOLD_SECONDS * 1000).toISOString();
      const { data: stalledJobs, error } = await supabase.from('mira-agent-bitstudio-jobs').select('id, metadata, final_image_url').eq('status', 'compositing').lt('updated_at', threshold);
      if (error) throw error;
      if (stalledJobs && stalledJobs.length > 0) {
        console.log(`[Watchdog-BG][${requestId}] Found ${stalledJobs.length} stalled 'compositing' jobs. Applying retry logic...`);
        const recoveryPromises = stalledJobs.map(async (job)=>{
          const retries = (job.metadata?.watchdog_retries || 0) + 1;
          if (retries > MAX_WATCHDOG_RETRIES) {
            await supabase.from('mira-agent-bitstudio-jobs').update({
              status: 'permanently_failed',
              error_message: `Job stalled in 'compositing' and failed after ${MAX_WATCHDOG_RETRIES} recovery attempts.`
            }).eq('id', job.id);
          } else {
            await supabase.from('mira-agent-bitstudio-jobs').update({
              metadata: {
                ...job.metadata,
                watchdog_retries: retries
              }
            }).eq('id', job.id);
            await supabase.functions.invoke('MIRA-AGENT-compositor-inpaint', {
              body: {
                job_id: job.id,
                final_image_url: job.final_image_url,
                job_type: 'bitstudio'
              }
            });
          }
        });
        await Promise.allSettled(recoveryPromises);
        actionsTaken.push(`Processed ${stalledJobs.length} stalled 'compositing' jobs.`);
      } else {
        console.log(`[Watchdog-BG][${requestId}] No stalled 'compositing' jobs found.`);
      }
    } catch (e) {
      console.error(`[Watchdog-BG][${requestId}] Task (Stalled Compositing) failed:`, e.message);
    }
    try {
      console.log(`[Watchdog-BG][${requestId}] === Task (Catch-All): Generic VTO Worker Catch-All ===`);
      const catchAllThreshold = new Date(Date.now() - STALLED_VTO_WORKER_CATCH_ALL_THRESHOLD_SECONDS * 1000).toISOString();
      const inProgressStatuses = [
        'processing',
        'fixing',
        'prepare_assets',
        'generate_step_1',
        'quality_check',
        'generate_step_2',
        'quality_check_2',
        'generate_step_3',
        'quality_check_3',
        'outfit_completeness_check',
        'awaiting_stylist_choice',
        'awaiting_auto_complete',
        'reframe',
        'awaiting_reframe'
      ];
      const { data: longStalledJobs, error: catchAllError } = await supabase.from('mira-agent-bitstudio-jobs').select('id, metadata').in('status', inProgressStatuses).eq('metadata->>engine', 'google').lt('updated_at', catchAllThreshold);
      if (catchAllError) throw catchAllError;
      if (longStalledJobs && longStalledJobs.length > 0) {
        console.log(`[Watchdog-BG][${requestId}] Found ${longStalledJobs.length} long-stalled job(s). Applying retry/fail logic...`);
        const recoveryPromises = longStalledJobs.map(async (job)=>{
          const retries = (job.metadata?.watchdog_retries || 0) + 1;
          if (retries > MAX_WATCHDOG_RETRIES) {
            console.error(`[Watchdog-BG][${requestId}] Job ${job.id} has exceeded max watchdog retries. Marking as permanently failed.`);
            await supabase.from('mira-agent-bitstudio-jobs').update({
              status: 'permanently_failed',
              error_message: `Job stalled and failed after ${MAX_WATCHDOG_RETRIES} watchdog recovery attempts.`
            }).eq('id', job.id);
          } else {
            console.log(`[Watchdog-BG][${requestId}] Re-triggering worker for long-stalled job ${job.id} (Attempt ${retries}/${MAX_WATCHDOG_RETRIES}).`);
            await supabase.from('mira-agent-bitstudio-jobs').update({
              metadata: {
                ...job.metadata,
                watchdog_retries: retries
              }
            }).eq('id', job.id);
            await supabase.functions.invoke('MIRA-AGENT-worker-vto-pack-item', {
              body: {
                pair_job_id: job.id
              }
            });
          }
        });
        await Promise.allSettled(recoveryPromises);
        actionsTaken.push(`Processed ${longStalledJobs.length} long-stalled VTO jobs.`);
      } else {
        console.log(`[Watchdog-BG][${requestId}] No long-stalled VTO jobs found.`);
      }
    } catch (e) {
      console.error(`[Watchdog-BG][${requestId}] Task (VTO Catch-All) failed:`, e.message);
    }
    try {
      console.log(`[Watchdog-BG][${requestId}] === Task: Starting New Google VTO Jobs ===`);
      const { data: config } = await supabase.from('mira-agent-config').select('value').eq('key', 'VTO_CONCURRENCY_LIMIT').single();
      const concurrencyLimit = config?.value?.limit || 1;
      const { count: runningJobsCount } = await supabase.from('mira-agent-bitstudio-jobs').select('id', {
        count: 'exact'
      }).in('status', [
        'processing',
        'fixing',
        'prepare_assets'
      ]).eq('metadata->>engine', 'google');
      const availableSlots = concurrencyLimit - (runningJobsCount || 0);
      if (availableSlots > 0) {
        const { data: jobsToStart, error: claimError } = await supabase.rpc('claim_next_vto_google_jobs', {
          p_limit: availableSlots
        });
        if (claimError) throw claimError;
        if (jobsToStart && jobsToStart.length > 0) {
          const workerPromises = jobsToStart.map((job)=>supabase.functions.invoke('MIRA-AGENT-worker-vto-pack-item', {
              body: {
                pair_job_id: job.job_id
              }
            }));
          await Promise.allSettled(workerPromises);
          actionsTaken.push(`Started ${jobsToStart.length} new Google VTO workers.`);
        } else {
          console.log(`[Watchdog-BG][${requestId}] No new pending Google VTO jobs to start.`);
        }
      } else {
        console.log(`[Watchdog-BG][${requestId}] No available concurrency slots for Google VTO.`);
      }
    } catch (e) {
      console.error(`[Watchdog-BG][${requestId}] Task (VTO Concurrency & Start) failed:`, e.message);
    }
    try {
      console.log(`[Watchdog-BG][${requestId}] === Task: Starting New QA Jobs ===`);
      const { data: claimedQaJobId } = await supabase.rpc('claim_next_vto_qa_job');
      if (claimedQaJobId) {
        supabase.functions.invoke('MIRA-AGENT-worker-vto-reporter', {
          body: {
            qa_job_id: claimedQaJobId
          }
        }).catch(console.error);
        actionsTaken.push(`Started new VTO QA worker for job ${claimedQaJobId}.`);
      } else {
        console.log(`[Watchdog-BG][${requestId}] No new QA jobs to start.`);
      }
    } catch (e) {
      console.error(`[Watchdog-BG][${requestId}] Task (New QA Jobs) failed:`, e.message);
    }
    try {
      console.log(`[Watchdog-BG][${requestId}] === Task: Triggering Report Chunk Workers ===`);
      const { data: pendingChunk } = await supabase.from('mira-agent-vto-report-chunks').select('id').eq('status', 'pending').limit(1).maybeSingle();
      if (pendingChunk) {
        const { error: updateError } = await supabase.from('mira-agent-vto-report-chunks').update({
          status: 'processing'
        }).eq('id', pendingChunk.id);
        if (!updateError) {
          supabase.functions.invoke('MIRA-AGENT-analyzer-vto-report-chunk-worker', {
            body: {
              chunk_id: pendingChunk.id
            }
          }).catch(console.error);
          actionsTaken.push(`Triggered VTO report chunk worker for ${pendingChunk.id}.`);
        }
      } else {
        console.log(`[Watchdog-BG][${requestId}] No pending report chunks to process.`);
      }
    } catch (e) {
      console.error(`[Watchdog-BG][${requestId}] Task (Report Chunks) failed:`, e.message);
    }
    try {
      console.log(`[Watchdog-BG][${requestId}] === Task: Triggering Final Synthesis ===`);
      const { data: readyPacks } = await supabase.rpc('find_packs_ready_for_synthesis');
      if (readyPacks && readyPacks.length > 0) {
        const synthesizerPromises = readyPacks.map((pack)=>supabase.functions.invoke('MIRA-AGENT-final-synthesizer-vto-report', {
            body: {
              pack_id: pack.pack_id
            }
          }));
        await Promise.allSettled(synthesizerPromises);
        actionsTaken.push(`Triggered final synthesis for ${readyPacks.length} VTO report packs.`);
      } else {
        console.log(`[Watchdog-BG][${requestId}] No packs ready for final synthesis.`);
      }
    } catch (e) {
      console.error(`[Watchdog-BG][${requestId}] Task (Synthesis) failed:`, e.message);
    }
    const finalMessage = actionsTaken.length > 0 ? actionsTaken.join(' ') : "No actions required. All jobs are running normally.";
    console.log(`[Watchdog-BG][${requestId}] Check complete. ${finalMessage}`);
    return new Response(JSON.stringify({
      message: finalMessage
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 200
    });
  } catch (error) {
    console.error(`[Watchdog-BG][${requestId}] Unhandled error:`, error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 500
    });
  }
});