export const config = {
  PORT: process.env.PORT || 8080,
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://localhost:27017/chatdb',
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_ASSISTANT_ID: process.env.OPENAI_ASSISTANT_ID,
  AUTH_TOKEN: process.env.AUTH_TOKEN || null,
  ASSIST_POLL_MS: Number(process.env.ASSIST_POLL_MS || 200),
  ASSIST_POLL_TIMEOUT_MS: Number(process.env.ASSIST_POLL_TIMEOUT_MS || 15000),
  // Defaults for /assist/reply behavior (make it transparent for Salesforce)
  REPLY_FAST_DEFAULT: String(process.env.REPLY_FAST_DEFAULT ?? 'true').toLowerCase() === 'true',
  REPLY_FLAT_DEFAULT: String(process.env.REPLY_FLAT_DEFAULT ?? 'true').toLowerCase() === 'true'
};

export function assertRequiredEnv() {
  if (!config.OPENAI_API_KEY) {
    throw new Error('Faltou OPENAI_API_KEY no .env');
  }
}
