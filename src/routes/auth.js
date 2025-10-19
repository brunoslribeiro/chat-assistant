import express from 'express';
import { register, login, me, logout, changePassword } from '../controllers/authController.js';
import { attachUser, requireUser } from '../middleware/requireUser.js';

export const authRouter = express.Router();

// Attach user info for these routes
authRouter.use(attachUser);

// First user bootstrap only
authRouter.post('/auth/register', register);

authRouter.post('/auth/login', login);
authRouter.get('/auth/me', me);
authRouter.post('/auth/logout', logout);
authRouter.post('/auth/change-password', requireUser, changePassword);

