import dashboardHTML from '../dashboard.html';

export function getDashboard() {
  return new Response(dashboardHTML, {
    headers: {
      'Content-Type': 'text/html',
      'Cache-Control': 'no-cache'
    }
  });
}

export async function getTodayStats(request, env) {
  const today = new Date().toISOString().split('T')[0];
  
  try {
    // Get today's job statistics
    const stats = await env.DB.prepare(`
      SELECT 
        COUNT(*) as total_jobs,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_jobs,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_jobs,
        SUM(duration_seconds) / 60 as total_minutes,
        SUM(cost_cents) as total_cost_cents,
        SUM(word_count) as total_words
      FROM transcription_jobs
      WHERE DATE(created_at) = ?
    `).bind(today).first();
    
    const fileCount = stats?.total_jobs || 0;
    const completedJobs = stats?.completed_jobs || 0;
    const failedJobs = stats?.failed_jobs || 0;
    const totalMinutes = stats?.total_minutes || 0;
    const totalCost = (stats?.total_cost_cents || 0) / 100;
    const totalWords = stats?.total_words || 0;
    
    // Calculate success rate
    const successRate = fileCount > 0 ? (completedJobs / fileCount) * 100 : 0;
    
    return new Response(JSON.stringify({
      date: today,
      fileCount,
      completedJobs,
      failedJobs,
      totalMinutes: parseFloat(totalMinutes.toFixed(2)),
      totalCost: parseFloat(totalCost.toFixed(2)),
      totalWords,
      successRate: parseFloat(successRate.toFixed(1))
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('Error fetching today stats:', error);
    return new Response(JSON.stringify({ error: 'Failed to fetch statistics' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function getRecentJobs(request, env) {
  try {
    const limit = parseInt(request.url.searchParams?.get('limit') || '50');
    
    const jobs = await env.DB.prepare(`
      SELECT 
        id, audio_key, status, created_at, started_at,
        completed_at, error_message, file_size, duration_seconds,
        word_count, cost_cents
      FROM transcription_jobs
      ORDER BY created_at DESC
      LIMIT ?
    `).bind(limit).all();
    
    return new Response(JSON.stringify(jobs.results || []), {
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('Error fetching recent jobs:', error);
    return new Response(JSON.stringify({ error: 'Failed to fetch jobs' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}