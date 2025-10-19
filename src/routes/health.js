import express from 'express';
import { health } from '../controllers/healthController.js';

export const healthRouter = express.Router();
healthRouter.get('/health', health);

