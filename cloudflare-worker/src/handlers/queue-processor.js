export async function processTranscriptionQueue(batch, env, ctx) {
  console.log(`Processing batch of ${batch.messages.length} transcription jobs`);
  
  for (const message of batch.messages) {
    try {
      await processTranscriptionJob(message.body, env, ctx);
      message.ack();
    } catch (error) {
      console.error(`Error processing job:`, error);
      message.retry();
    }
  }
}

async function processTranscriptionJob(job, env, ctx) {
  const { jobId, audioKey, fileSize, metadata } = job;
  
  try {
    // Update job status
    await env.DB.prepare(`
      UPDATE transcription_jobs 
      SET status = 'processing', started_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(jobId).run();
    
    // Get audio file from R2
    const audioObject = await env.AUDIO_BUCKET.get(audioKey);
    if (!audioObject) {
      throw new Error(`Audio file not found: ${audioKey}`);
    }
    
    // Prepare Deepgram request
    const deepgramUrl = new URL(env.DEEPGRAM_API_URL);
    deepgramUrl.searchParams.set('model', env.TRANSCRIPTION_MODEL);
    deepgramUrl.searchParams.set('language', env.LANGUAGE);
    
    if (env.ENABLE_DIARIZATION === 'true') {
      deepgramUrl.searchParams.set('diarize', 'true');
    }
    
    deepgramUrl.searchParams.set('punctuate', 'true');
    deepgramUrl.searchParams.set('paragraphs', 'true');
    deepgramUrl.searchParams.set('utterances', 'true');
    deepgramUrl.searchParams.set('smart_format', 'true');
    
    // Send to Deepgram
    const startTime = Date.now();
    const response = await fetch(deepgramUrl.toString(), {
      method: 'POST',
      headers: {
        'Authorization': `Token ${env.DEEPGRAM_API_KEY}`,
        'Content-Type': audioObject.httpMetadata.contentType || 'audio/mpeg'
      },
      body: audioObject.body
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Deepgram API error: ${response.status} - ${error}`);
    }
    
    const transcriptionResult = await response.json();
    const processingTime = Date.now() - startTime;
    
    // Extract metadata from result
    const metadata = extractTranscriptionMetadata(transcriptionResult);
    
    // Calculate cost (Deepgram pricing: $0.0043 per minute for Nova)
    const durationMinutes = metadata.duration / 60;
    const costCents = Math.ceil(durationMinutes * 0.43); // $0.0043 = 0.43 cents
    
    // Generate transcription key
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const transcriptionKey = `transcriptions/${year}/${month}/${day}/${jobId}.json`;
    
    // Save transcription to R2
    await env.TRANSCRIPTION_BUCKET.put(transcriptionKey, JSON.stringify({
      jobId,
      audioKey,
      transcriptionResult,
      metadata,
      processingTime,
      timestamp: new Date().toISOString()
    }), {
      httpMetadata: {
        contentType: 'application/json'
      },
      customMetadata: {
        'job-id': jobId,
        'audio-key': audioKey,
        'duration-seconds': metadata.duration.toString(),
        'word-count': metadata.wordCount.toString()
      }
    });
    
    // Update job record
    await env.DB.prepare(`
      UPDATE transcription_jobs 
      SET 
        status = 'completed',
        completed_at = CURRENT_TIMESTAMP,
        duration_seconds = ?,
        word_count = ?,
        deepgram_request_id = ?,
        cost_cents = ?
      WHERE id = ?
    `).bind(
      metadata.duration,
      metadata.wordCount,
      transcriptionResult.metadata?.request_id || null,
      costCents,
      jobId
    ).run();
    
    // Save transcription metadata
    await env.DB.prepare(`
      INSERT INTO transcription_metadata (
        id, job_id, transcription_key, speakers_detected, 
        confidence_score, language_detected
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      uuidv4(),
      jobId,
      transcriptionKey,
      metadata.speakersDetected,
      metadata.confidence,
      metadata.language
    ).run();
    
    console.log(`Transcription completed for job ${jobId}: ${metadata.wordCount} words, ${metadata.duration}s, cost: $${(costCents/100).toFixed(2)}`);
    
  } catch (error) {
    console.error(`Error processing transcription job ${jobId}:`, error);
    
    // Update job with error
    await env.DB.prepare(`
      UPDATE transcription_jobs 
      SET 
        status = 'failed',
        completed_at = CURRENT_TIMESTAMP,
        error_message = ?
      WHERE id = ?
    `).bind(error.message, jobId).run();
    
    throw error;
  }
}

function extractTranscriptionMetadata(result) {
  const channel = result.results?.channels?.[0];
  const alternatives = channel?.alternatives?.[0];
  
  return {
    duration: result.metadata?.duration || 0,
    wordCount: alternatives?.words?.length || 0,
    confidence: result.metadata?.confidence || alternatives?.confidence || 0,
    speakersDetected: result.results?.speaker_labels?.speakers || 0,
    language: result.results?.channels?.[0]?.detected_language || env.LANGUAGE
  };
}

function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}