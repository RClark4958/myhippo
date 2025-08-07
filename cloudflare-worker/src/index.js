import { Router } from './router';
import { handleR2Upload } from './handlers/r2-trigger';
import { processTranscriptionQueue } from './handlers/queue-processor';
import { getTranscriptionStatus, getTranscriptionResult } from './handlers/api';
import { getDashboard, getTodayStats, getRecentJobs } from './handlers/dashboard';

export default {
  async fetch(request, env, ctx) {
    const router = new Router();
    
    // API endpoints
    router.get('/api/status/:jobId', (request) => getTranscriptionStatus(request, env));
    router.get('/api/result/:jobId', (request) => getTranscriptionResult(request, env));
    router.get('/api/health', () => new Response('OK', { status: 200 }));
    
    // Dashboard endpoints
    router.get('/', () => getDashboard());
    router.get('/dashboard', () => getDashboard());
    router.get('/api/stats/today', (request) => getTodayStats(request, env));
    router.get('/api/jobs/recent', (request) => getRecentJobs(request, env));
    
    // Manual trigger endpoint (for testing)
    router.post('/api/transcribe', async (request) => {
      const { audioKey } = await request.json();
      const result = await handleR2Upload(audioKey, env, ctx);
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' }
      });
    });
    
    return router.handle(request);
  },
  
  // R2 bucket event trigger
  async queue(batch, env, ctx) {
    await processTranscriptionQueue(batch, env, ctx);
  },
  
  // Scheduled handler for cleanup and reporting
  async scheduled(event, env, ctx) {
    const date = new Date().toISOString().split('T')[0];
    
    // Generate daily usage report
    const usage = await env.DB.prepare(`
      SELECT 
        COUNT(*) as file_count,
        SUM(duration_seconds) / 60 as total_minutes,
        SUM(cost_cents) as total_cost_cents
      FROM transcription_jobs
      WHERE DATE(created_at) = ?
    `).bind(date).first();
    
    if (usage && usage.file_count > 0) {
      await env.DB.prepare(`
        INSERT INTO daily_usage (date, audio_minutes, cost_cents, file_count)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(date) DO UPDATE SET
          audio_minutes = excluded.audio_minutes,
          cost_cents = excluded.cost_cents,
          file_count = excluded.file_count
      `).bind(
        date,
        usage.total_minutes || 0,
        usage.total_cost_cents || 0,
        usage.file_count
      ).run();
      
      console.log(`Daily usage for ${date}: ${usage.file_count} files, ${usage.total_minutes?.toFixed(2)} minutes, $${(usage.total_cost_cents / 100).toFixed(2)}`);
    }
  }
};