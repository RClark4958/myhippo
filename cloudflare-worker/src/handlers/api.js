export async function getTranscriptionStatus(request, env) {
  const { jobId } = request.params;
  
  const job = await env.DB.prepare(`
    SELECT 
      id, audio_key, status, created_at, started_at, 
      completed_at, error_message, file_size, duration_seconds,
      word_count, cost_cents
    FROM transcription_jobs
    WHERE id = ?
  `).bind(jobId).first();
  
  if (!job) {
    return new Response(JSON.stringify({ error: 'Job not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // Add cost in dollars
  if (job.cost_cents) {
    job.cost_dollars = (job.cost_cents / 100).toFixed(2);
  }
  
  return new Response(JSON.stringify(job), {
    headers: { 'Content-Type': 'application/json' }
  });
}

export async function getTranscriptionResult(request, env) {
  const { jobId } = request.params;
  
  // First check if job exists and is completed
  const job = await env.DB.prepare(`
    SELECT status FROM transcription_jobs WHERE id = ?
  `).bind(jobId).first();
  
  if (!job) {
    return new Response(JSON.stringify({ error: 'Job not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  if (job.status !== 'completed') {
    return new Response(JSON.stringify({ 
      error: 'Transcription not ready',
      status: job.status 
    }), {
      status: 202,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // Get transcription metadata to find the file
  const metadata = await env.DB.prepare(`
    SELECT transcription_key FROM transcription_metadata WHERE job_id = ?
  `).bind(jobId).first();
  
  if (!metadata) {
    return new Response(JSON.stringify({ error: 'Transcription metadata not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // Get transcription from R2
  const transcriptionObject = await env.TRANSCRIPTION_BUCKET.get(metadata.transcription_key);
  
  if (!transcriptionObject) {
    return new Response(JSON.stringify({ error: 'Transcription file not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // Parse and return transcription
  const transcription = await transcriptionObject.json();
  
  // Format the response
  const response = {
    jobId: transcription.jobId,
    audioKey: transcription.audioKey,
    transcript: transcription.transcriptionResult.results.channels[0].alternatives[0].transcript,
    words: transcription.transcriptionResult.results.channels[0].alternatives[0].words,
    metadata: transcription.metadata,
    processingTime: transcription.processingTime,
    timestamp: transcription.timestamp
  };
  
  // Add speaker labels if diarization was enabled
  if (transcription.transcriptionResult.results.speaker_labels) {
    response.speakers = transcription.transcriptionResult.results.speaker_labels;
  }
  
  return new Response(JSON.stringify(response), {
    headers: { 'Content-Type': 'application/json' }
  });
}