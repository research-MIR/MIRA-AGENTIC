// deno run --allow-env --allow-net --allow-read
// MIRA‑AGENT‑worker‑vto‑pack‑item (2025‑07‑18)

import { serve }            from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient }     from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { Image as ISImage } from "https://deno.land/x/imagescript@1.2.15/mod.ts";
import {
  decodeBase64,
  encodeBase64
} from "https://deno.land/std@0.224.0/encoding/base64.ts";

/* ────────────────────────────── Config ────────────────────────────── */

const SUPABASE_URL             = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY= Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TEMP_UPLOAD_BUCKET       = "mira-agent-user-uploads";
const GENERATED_IMAGES_BUCKET  = "mira-generations";

const CORS = {
  "Access-Control-Allow-Origin" : "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/* ────────────────────── Generic/Utility helpers ───────────────────── */

function parseStorageURL(raw: string) {
  const u = new URL(raw);
  const seg = u.pathname.split("/");
  const i   = seg.indexOf("object");
  if (i === -1 || i + 2 >= seg.length)
    throw new Error(`Bad Supabase storage URL: ${raw}`);
  return { bucket: seg[i + 2], path: decodeURIComponent(seg.slice(i + 3).join("/")) };
}

async function downloadFile(sb: SupabaseClient, publicURL: string) {
  const { bucket, path   } = parseStorageURL(publicURL);
  const { data, error   } = await sb.storage.from(bucket).download(path);
  if (error) throw new Error(`Download failed [${bucket}/${path}]: ${error.message}`);
  return data!;
}

async function uploadTempPNG(sb: SupabaseClient, uid: string, fname: string, buf: Uint8Array) {
  const key = `tmp/${uid}/${Date.now()}-${fname}`;
  const { error } = await sb.storage.from(TEMP_UPLOAD_BUCKET).upload(key, buf, {
    contentType: "image/png",
    upsert: true,
  });
  if (error) throw new Error(`Temp upload failed (${key}): ${error.message}`);
  
  const { data } = await sb.storage.from(TEMP_UPLOAD_BUCKET).createSignedUrl(key, 3600);
  if (!data || !data.signedUrl) throw new Error("Failed to get public URL for temporary file.");
  
  return data.signedUrl as string;
}

const blobToB64 = async (blob: Blob): Promise<string> => encodeBase64(await blob.arrayBuffer());

/* ────────────────────────── HTTP entrypoint ───────────────────────── */

serve(async req => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  let supabase: SupabaseClient, pair_job_id: string;
  try {
    ({ pair_job_id } = await req.json());
    if (!pair_job_id) throw new Error("pair_job_id is required");
    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  } catch (e) {
    return json({ error: e.message }, 400);
  }

  const tag = `[VTO-Pack-Worker][${pair_job_id}]`;

  try {
    /* fetch job row ---------------------------------------------------------------- */
    const { data: job, error } = await supabase
      .from("mira-agent-bitstudio-jobs")
      .select("*")
      .eq("id", pair_job_id)
      .single();
    if (error) throw error;

    const step = job.metadata?.google_vto_step ?? "start";
    console.log(`${tag} step=${step}`);

    switch (step) {
      case "start":
        await stepStart           (supabase, job, tag); break;
      case "generate_step_1":
        await stepGenerate        (supabase, job, 15, "generate_step_2", tag); break;
      case "generate_step_2":
        await stepGenerate        (supabase, job, 30, "generate_step_3", tag); break;
      case "generate_step_3":
        await stepGenerate        (supabase, job, 55, "quality_check"  , tag); break;
      case "quality_check":
        await stepQualityCheck    (supabase, job, tag); break;
      case "compositing":
        await stepCompositing     (supabase, job, tag); break;
      default:
        throw new Error(`Unknown step '${step}'`);
    }

    return json({ success: true, processed: step });
  } catch (err) {
    console.error(`${tag} FATAL ERROR`, err);
    try {
      await supabase.from("mira-agent-bitstudio-jobs")
        .update({ status: "failed", error_message: err.message })
        .eq("id", pair_job_id);
    } catch {}
    return json({ error: err.message }, 500);
  }
});

/* ──────────────────────── Step‑handler helpers ────────────────────── */

async function stepStart(sb: SupabaseClient, job: any, tag: string) {
  console.log(`${tag} ➜ bounding‑box`);
  const { data: bb, error } = await sb.functions.invoke(
    "MIRA-AGENT-orchestrator-bbox", { body: { image_url: job.source_person_image_url } }
  );
  if (error) throw error;
  const [top, left, bottom, right] = bb.person ?? [];
  if (![top,left,bottom,right].every((n: any) => typeof n === "number"))
    throw new Error("Bad bbox");

  /* crop person ------------------------------------------------------------------- */
  const pBlob        = await downloadFile(sb, job.source_person_image_url);
  const pImg         = await ISImage.decode(await pBlob.arrayBuffer());
  const abs          = {
    x: Math.floor(left   / 1000 * pImg.width ),
    y: Math.floor(top    / 1000 * pImg.height),
    w: Math.ceil( (right - left ) / 1000 * pImg.width  ),
    h: Math.ceil( (bottom- top  ) / 1000 * pImg.height )
  };
  const cropped      = pImg.clone().crop(abs.x, abs.y, abs.w, abs.h);
  const croppedBuf   = await cropped.encode(0);
  const croppedURL   = await uploadTempPNG(sb, job.user_id, "cropped.png", croppedBuf);

  /* persist + recurse ------------------------------------------------------------- */
  await sb.from("mira-agent-bitstudio-jobs").update({
    status  : "processing",
    metadata: { ...job.metadata, bbox: abs, cropped_person_url: croppedURL,
                google_vto_step: "generate_step_1" }
  }).eq("id", job.id);

  await sb.functions.invoke("MIRA-AGENT-worker-vto-pack-item", {
    body: { pair_job_id: job.id }
  });
}

async function stepGenerate(sb: SupabaseClient, job: any, sampleStep: number, nextStep: string, tag: string) {
  console.log(`${tag} ➜ diffusion s=${sampleStep}`);
  const [pBlob, gBlob] = await Promise.all([
    downloadFile(sb, job.metadata.cropped_person_url),
    downloadFile(sb, job.source_garment_image_url),
  ]);

  const { data, error } = await sb.functions.invoke(
    "MIRA-AGENT-tool-virtual-try-on",
    { body: {
        person_image_base64  : await blobToB64(pBlob),
        garment_image_base64 : await blobToB64(gBlob),
        sample_count: 1, sample_step: sampleStep }
    }
  );
  if (error) throw error;
  if (!data.generatedImages?.length) throw new Error("VTO returned no images");

  const variations = [...(job.metadata.generated_variations ?? []), data.generatedImages[0]];
  await sb.from("mira-agent-bitstudio-jobs").update({
    metadata: { ...job.metadata, generated_variations: variations,
                google_vto_step: nextStep }
  }).eq("id", job.id);

  await sb.functions.invoke("MIRA-AGENT-worker-vto-pack-item", {
    body: { pair_job_id: job.id }
  });
}

async function stepQualityCheck(sb: SupabaseClient, job: any, tag: string) {
  console.log(`${tag} ➜ QA`);
  const v = job.metadata.generated_variations;
  if (v?.length < 3) throw new Error("Need ≥3 variations for QA");

  const [pBlob, gBlob] = await Promise.all([
    downloadFile(sb, job.source_person_image_url),
    downloadFile(sb, job.source_garment_image_url),
  ]);

  const { data, error } = await sb.functions.invoke(
    "MIRA-AGENT-tool-vto-quality-checker",
    { body: {
        original_person_image_base64   : await blobToB64(pBlob),
        reference_garment_image_base64 : await blobToB64(gBlob),
        generated_images_base64        : v.map((x: any) => x.base64Image)
    }}
  );
  if (error) throw error;

  await sb.from("mira-agent-bitstudio-jobs").update({
    metadata: { ...job.metadata,
                qa_best_index: data.best_image_index,
                qa_reasoning : data.reasoning,
                google_vto_step: "compositing" }
  }).eq("id", job.id);

  await sb.functions.invoke("MIRA-AGENT-worker-vto-pack-item", {
    body: { pair_job_id: job.id }
  });
}

async function stepCompositing(sb: SupabaseClient, job: any, tag: string) {
  console.log(`${tag} ➜ compositing`);
  const { bbox, generated_variations, qa_best_index } = job.metadata;
  if (qa_best_index == null) throw new Error("best index missing");

  /* decode images ----------------------------------------------------------------- */
  const patchBuf   = decodeBase64(generated_variations[qa_best_index].base64Image);
  let   patch      = await ISImage.decode(patchBuf);
  const personBlob = await downloadFile(sb, job.source_person_image_url);
  const personImg  = await ISImage.decode(await personBlob.arrayBuffer());

  /* pre‑crop & resize ------------------------------------------------------------- */
  const CROP = 4;
  patch = patch.crop(CROP, CROP,
                     patch.width  - CROP * 2,
                     patch.height - CROP * 2);
  patch = patch.resize(bbox.width - CROP * 2, bbox.height - CROP * 2);

  /* feather mask without per‑pixel loops ----------------------------------------- */
  const FEATHER = 20;
  const mask    = new ISImage(patch.width, patch.height);
  mask.fill(ISImage.rgbaToColor(255,255,255,255));
  mask.gaussianBlur(FEATHER);                  // produces soft alpha edges
  patch.mask(mask, true);

  /* paste ------------------------------------------------------------------------- */
  const final      = personImg.clone();
  final.composite(patch, bbox.x + CROP, bbox.y + CROP);

  const buf   = await final.encode(0);
  const path  = `${job.user_id}/vto-packs/${Date.now()}_final.png`;
  const { error: upErr } = await sb.storage
    .from(GENERATED_IMAGES_BUCKET)
    .upload(path, buf, { contentType: "image/png", upsert: true });
  if (upErr) throw upErr;

  const { data: urlData } =
    sb.storage.from(GENERATED_IMAGES_BUCKET).getPublicUrl(path);
  
  if (!urlData || !urlData.publicUrl) throw new Error("Failed to get public URL after upload");

  await sb.from("mira-agent-bitstudio-jobs").update({
    status: "complete",
    final_image_url: urlData.publicUrl,
    metadata: { ...job.metadata, google_vto_step: "done" }
  }).eq("id", job.id);

  console.log(`${tag} ✔ finished: ${urlData.publicUrl}`);
}

/* ────────────────────────────── small util ───────────────────────── */

function json(obj: any, status=200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { ...CORS, "Content-Type": "application/json" }
  });
}