// ... inside the serve function, within the try...catch block and after the 'inpaint' mode check ...

        const inpaintPayload: any = {
          mask_image_id: maskImageId,
          prompt: prompt || "photorealistic",
          denoise: denoise || 0.99,
          resolution: resolution || 'standard',
          mask_expansion_percent: mask_expansion_percent || 3,
          num_images: num_images || 1,
        };

        let referenceImageId: string | null = null;
        if (reference_image_url) {
          const referenceBlob = await downloadFromSupabase(supabase, reference_image_url);
          referenceImageId = await uploadToBitStudio(referenceBlob, 'inpaint-reference', 'reference.png');
          inpaintPayload.reference_image_id = referenceImageId;
        }

        const inpaintUrl = `${BITSTUDIO_API_BASE}/images/${sourceImageId}/inpaint`;
        const inpaintResponse = await fetch(inpaintUrl, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${BITSTUDIO_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(inpaintPayload)
        });
// ... rest of the function