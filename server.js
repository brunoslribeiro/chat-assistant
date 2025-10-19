import 'dotenv/config';
import express from 'express';
import { connectMongo } from './src/db/mongoose.js';
import { config, assertRequiredEnv } from './src/config/env.js';
import { healthRouter } from './src/routes/health.js';
import { assistRouter } from './src/routes/assist.js';

assertRequiredEnv();

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static('public'));

// Routes
app.use('/', healthRouter);
app.use('/', assistRouter);

// Start server
await connectMongo(config.MONGODB_URI);
app.listen(config.PORT, () => {
  console.log(`Chat Router Service on :${config.PORT}`);
});

