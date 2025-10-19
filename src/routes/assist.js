import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { postAssistReply, getAssistStream } from '../controllers/assistController.js';

export const assistRouter = express.Router();
assistRouter.post('/assist/reply', requireAuth, postAssistReply);
assistRouter.get('/assist/stream', requireAuth, getAssistStream);

