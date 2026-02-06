// Minimal test worker to verify cron functionality
export default {
  async scheduled(event, env, ctx) {
    console.log('[TEST CRON] Triggered at:', new Date().toISOString());
    console.log('[TEST CRON] Cron pattern:', event.cron);
    console.log('[TEST CRON] SUCCESS - Cron is working!');
  },

  async fetch(request, env) {
    return new Response('Test cron worker - check logs for cron execution', {
      headers: { 'Content-Type': 'text/plain' }
    });
  }
};
