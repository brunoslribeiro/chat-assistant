import 'dotenv/config';
import express from 'express';
import path from 'path';
import { connectMongo } from './src/db/mongoose.js';
import { config, assertRequiredEnv } from './src/config/env.js';
import { healthRouter } from './src/routes/health.js';
import { assistRouter } from './src/routes/assist.js';
import { authRouter } from './src/routes/auth.js';
import { attachUser, requireUser } from './src/middleware/requireUser.js';
import { adminRouter } from './src/routes/admin.js';

assertRequiredEnv();

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(attachUser);

// Root now points to Admin. Redirect unauthenticated users to login with next=/admin/
app.get(['/', '/index.html'], (req, res) => {
  if (!req.user || !req.user.id) {
    return res.redirect('/login.html?next=%2Fadmin%2F');
  }
  return res.redirect('/admin/');
});

// Guard admin subtree: any /admin/* requires authentication (redirects to login)
app.use('/admin', (req, res, next) => {
  if (!req.user || !req.user.id) {
    const nextUrl = encodeURIComponent(req.originalUrl || '/admin/');
    return res.redirect(`/login.html?next=${nextUrl}`);
  }
  next();
});

// Guard admin HTML pages (serve only when authenticated)
app.get(['/admin', '/admin/'], (req, res) => {
  res.sendFile(path.resolve('public/admin/index.html'));
});

app.get(['/admin/index.html', '/admin/thread.html', '/admin/dashboard.html'], (req, res) => {
  res.sendFile(path.resolve(`public${req.path}`));
});

// Explicit Chat route (serves the chat index for authenticated users)
app.get(['/chat', '/chat/index.html'], (req, res) => {
  if (!req.user || !req.user.id) {
    const next = encodeURIComponent('/chat');
    return res.redirect(`/login.html?next=${next}`);
  }
  res.sendFile(path.resolve('public/index.html'));
});

// Serve static for other assets (css/js)
app.use(express.static('public', { index: false }));

// Routes
app.use('/', healthRouter);
app.use('/', assistRouter);
app.use('/', authRouter);
app.use('/', adminRouter);

// Start server
await connectMongo(config.MONGODB_URI);
app.listen(config.PORT, () => {
  console.log(`Chat Router Service on :${config.PORT}`);
});
