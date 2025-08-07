import { v4 as uuidv4 } from './utils';

export async function handleR2Upload(audioKey, env, ctx) {
  console.log(`Processing new audio file: ${audioKey}`);
  
  // Generate job ID
  const jobId = uuidv4();
  
  try {
    // Get file metadata from R2
    const audioObject = await env.AUDIO_BUCKET.head(audioKey);
    
    if (!audioObject) {
      throw new Error(`Audio file not found: ${audioKey}`);
    }
    
    const fileSize = audioObject.size;
    const metadata = audioObject.customMetadata || {};
    
    // Create job record
    await env.DB.prepare(`
      INSERT INTO transcription_jobs (id, audio_key, status, file_size)
      VALUES (?, ?, 'pending', ?)
    `).bind(jobId, audioKey, fileSize).run();
    
    // Queue the transcription job
    await env.TRANSCRIPTION_QUEUE.send({
      jobId,
      audioKey,
      fileSize,
      metadata,
      timestamp: new Date().toISOString()
    });
    
    console.log(`Transcription job ${jobId} queued for ${audioKey}`);
    
    return {
      success: true,
      jobId,
      audioKey,
      status: 'queued'
    };
    
  } catch (error) {
    console.error(`Error handling R2 upload for ${audioKey}:`, error);
    
    // Update job with error
    await env.DB.prepare(`
      UPDATE transcription_jobs 
      SET status = 'failed', error_message = ?
      WHERE id = ?
    `).bind(error.message, jobId).run();
    
    return {
      success: false,
      jobId,
      error: error.message
    };
  }
}