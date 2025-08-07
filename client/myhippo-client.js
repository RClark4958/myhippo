/**
 * MyHippo Transcription Client
 * Simple client library for interacting with the transcription API
 */

export class MyHippoClient {
  constructor(workerUrl, options = {}) {
    this.baseUrl = workerUrl.replace(/\/$/, '');
    this.apiKey = options.apiKey; // Optional API key for future auth
    this.timeout = options.timeout || 30000;
  }

  async request(path, options = {}) {
    const url = `${this.baseUrl}${path}`;
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(error.error || `HTTP ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error('Request timeout');
      }
      throw error;
    }
  }

  /**
   * Check API health
   */
  async health() {
    const response = await fetch(`${this.baseUrl}/api/health`);
    return response.ok;
  }

  /**
   * Get transcription job status
   */
  async getStatus(jobId) {
    return this.request(`/api/status/${jobId}`);
  }

  /**
   * Get transcription result
   */
  async getResult(jobId) {
    return this.request(`/api/result/${jobId}`);
  }

  /**
   * Trigger manual transcription
   */
  async transcribe(audioKey) {
    return this.request('/api/transcribe', {
      method: 'POST',
      body: JSON.stringify({ audioKey })
    });
  }

  /**
   * Get today's statistics
   */
  async getTodayStats() {
    return this.request('/api/stats/today');
  }

  /**
   * Get recent jobs
   */
  async getRecentJobs(limit = 50) {
    return this.request(`/api/jobs/recent?limit=${limit}`);
  }

  /**
   * Wait for transcription to complete
   */
  async waitForTranscription(jobId, options = {}) {
    const maxAttempts = options.maxAttempts || 60;
    const interval = options.interval || 5000;

    for (let i = 0; i < maxAttempts; i++) {
      const status = await this.getStatus(jobId);
      
      if (status.status === 'completed') {
        return await this.getResult(jobId);
      }
      
      if (status.status === 'failed') {
        throw new Error(status.error_message || 'Transcription failed');
      }
      
      await new Promise(resolve => setTimeout(resolve, interval));
    }
    
    throw new Error('Transcription timeout');
  }

  /**
   * Transcribe and wait for result
   */
  async transcribeAndWait(audioKey, options = {}) {
    const { jobId } = await this.transcribe(audioKey);
    return this.waitForTranscription(jobId, options);
  }
}

// Example usage:
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MyHippoClient };
}

/*
// Usage example:
const client = new MyHippoClient('https://your-worker.workers.dev');

// Check health
const isHealthy = await client.health();

// Transcribe a file
const job = await client.transcribe('audio/2024/01/15/recording.mp3');
console.log('Job ID:', job.jobId);

// Wait for completion and get result
const result = await client.waitForTranscription(job.jobId);
console.log('Transcript:', result.transcript);

// Or do it all in one call
const result = await client.transcribeAndWait('audio/2024/01/15/recording.mp3');

// Get statistics
const stats = await client.getTodayStats();
console.log(`Today: ${stats.fileCount} files, $${stats.totalCost}`);
*/