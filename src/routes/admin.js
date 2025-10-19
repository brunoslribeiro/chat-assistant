import express from 'express';
import { requireUser, requireAdmin } from '../middleware/requireUser.js';
import { listThreads, getThreadMessages, listDecisions, exportMessagesNDJSON, exportDecisionsNDJSON, stats } from '../controllers/adminController.js';
import { listUsers, createUser, resetUserPassword } from '../controllers/userAdminController.js';

export const adminRouter = express.Router();

// All admin routes require authentication; some require admin role
adminRouter.get('/admin/threads', requireUser, listThreads);
adminRouter.get('/admin/threads/:threadId/messages', requireUser, getThreadMessages);
adminRouter.get('/admin/decisions', requireUser, listDecisions);
adminRouter.get('/admin/export/messages', requireAdmin, exportMessagesNDJSON);
adminRouter.get('/admin/export/decisions', requireAdmin, exportDecisionsNDJSON);
adminRouter.get('/admin/stats', requireUser, stats);

// Users (admin only)
adminRouter.get('/admin/users', requireAdmin, listUsers);
adminRouter.post('/admin/users', requireAdmin, createUser);
adminRouter.post('/admin/users/:id/reset-password', requireAdmin, resetUserPassword);
