import { Message } from '../models/Message.js';
import { Decision } from '../models/Decision.js';

function parseDate(s, def) {
  const d = s ? new Date(s) : null;
  return isNaN(d?.getTime?.()) ? def : d;
}

export async function listThreads(req, res) {
  try {
    const { search = '', from = '', to = '', page = '1', limit = '20', sort = 'lastAt', dir = 'desc' } = req.query || {};
    const pg = Math.max(parseInt(page, 10) || 1, 1);
    const lim = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 200);

    const match = {};
    const fromDate = parseDate(from, null);
    const toDate = parseDate(to, null);
    if (fromDate || toDate) {
      match.createdAt = {};
      if (fromDate) match.createdAt.$gte = fromDate;
      if (toDate) match.createdAt.$lte = toDate;
    }
    if (search && String(search).trim()) {
      match.$text = { $search: String(search).trim() };
    }

    // Build sorting for grouped fields
    const sortMap = {
      threadId: '_id',
      firstAt: 'firstAt',
      lastAt: 'lastAt',
      messageCount: 'count',
    };
    const sortField = sortMap[String(sort)] || 'lastAt';
    const sortDir = String(dir).toLowerCase() === 'asc' ? 1 : -1;

    const pipeline = [
      { $match: match },
      // Compute first/last using min/max so order of input doesn't matter
      { $group: { _id: '$threadId', firstAt: { $min: '$createdAt' }, lastAt: { $max: '$createdAt' }, count: { $sum: 1 } } },
      { $sort: { [sortField]: sortDir, lastAt: -1 } },
      { $skip: (pg - 1) * lim },
      { $limit: lim }
    ];
    const data = await Message.aggregate(pipeline);
    res.json({ page: pg, limit: lim, threads: data.map(t => ({ threadId: t._id, firstAt: t.firstAt, lastAt: t.lastAt, messageCount: t.count })) });
  } catch (e) {
    res.status(500).json({ error: 'list_threads_failed', detail: String(e) });
  }
}

export async function getThreadMessages(req, res) {
  try {
    const { threadId } = req.params;
    if (!threadId) return res.status(400).json({ error: 'threadId_required' });
    const msgs = await Message.find({ threadId }).sort({ createdAt: 1 }).lean();
    const decisions = await Decision.find({ threadId }).sort({ createdAt: 1 }).lean();
    const timeline = [
      ...msgs.map(m => ({ type: 'message', createdAt: m.createdAt, role: m.role, content: m.content })),
      ...decisions.map(d => ({ type: 'decision', createdAt: d.createdAt, decision: d.decision }))
    ].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    res.json({ threadId, messages: msgs, decisions, timeline });
  } catch (e) {
    res.status(500).json({ error: 'get_thread_failed', detail: String(e) });
  }
}

export async function listDecisions(req, res) {
  try {
    const { from = '', to = '', candidate_id = '', abstain = '', page = '1', limit = '20' } = req.query || {};
    const pg = Math.max(parseInt(page, 10) || 1, 1);
    const lim = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 200);
    const q = {};
    const fromDate = parseDate(from, null);
    const toDate = parseDate(to, null);
    if (fromDate || toDate) {
      q.createdAt = {};
      if (fromDate) q.createdAt.$gte = fromDate;
      if (toDate) q.createdAt.$lte = toDate;
    }
    if (candidate_id) q['decision.candidate_id'] = candidate_id;
    if (abstain === 'true' || abstain === 'false') q['decision.abstain'] = (abstain === 'true');
    const data = await Decision.find(q).sort({ createdAt: -1 }).skip((pg - 1) * lim).limit(lim).lean();
    res.json({ page: pg, limit: lim, decisions: data });
  } catch (e) {
    res.status(500).json({ error: 'list_decisions_failed', detail: String(e) });
  }
}

export async function exportMessagesNDJSON(req, res) {
  try {
    const { from = '', to = '', threadId = '' } = req.query || {};
    const q = {};
    const fromDate = parseDate(from, null);
    const toDate = parseDate(to, null);
    if (fromDate || toDate) {
      q.createdAt = {};
      if (fromDate) q.createdAt.$gte = fromDate;
      if (toDate) q.createdAt.$lte = toDate;
    }
    if (threadId) q.threadId = threadId;
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Transfer-Encoding', 'chunked');
    const cursor = Message.find(q).sort({ createdAt: 1 }).cursor();
    for await (const doc of cursor) {
      res.write(JSON.stringify(doc) + '\n');
    }
    res.end();
  } catch (e) {
    res.status(500).json({ error: 'export_messages_failed', detail: String(e) });
  }
}

export async function exportDecisionsNDJSON(req, res) {
  try {
    const { from = '', to = '', threadId = '' } = req.query || {};
    const q = {};
    const fromDate = parseDate(from, null);
    const toDate = parseDate(to, null);
    if (fromDate || toDate) {
      q.createdAt = {};
      if (fromDate) q.createdAt.$gte = fromDate;
      if (toDate) q.createdAt.$lte = toDate;
    }
    if (threadId) q.threadId = threadId;
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Transfer-Encoding', 'chunked');
    const cursor = Decision.find(q).sort({ createdAt: 1 }).cursor();
    for await (const doc of cursor) {
      res.write(JSON.stringify(doc) + '\n');
    }
    res.end();
  } catch (e) {
    res.status(500).json({ error: 'export_decisions_failed', detail: String(e) });
  }
}

export async function stats(req, res) {
  try {
    const { from = '', to = '' } = req.query || {};
    const fromDate = parseDate(from, new Date(Date.now() - 7*24*3600*1000));
    const toDate = parseDate(to, new Date());
    const threadAgg = await Message.aggregate([
      { $match: { createdAt: { $gte: fromDate, $lte: toDate } } },
      { $group: { _id: '$threadId', firstAt: { $min: '$createdAt' } } },
      { $count: 'total' }
    ]);
    const started = threadAgg[0]?.total || 0;
    const decAll = await Decision.countDocuments({ createdAt: { $gte: fromDate, $lte: toDate } });
    const decRouted = await Decision.countDocuments({ createdAt: { $gte: fromDate, $lte: toDate }, 'decision.abstain': false });
    const decAbstain = await Decision.countDocuments({ createdAt: { $gte: fromDate, $lte: toDate }, 'decision.abstain': true });
    res.json({ from: fromDate, to: toDate, started, routed: decRouted, not_routed: decAbstain, decisions: decAll });
  } catch (e) {
    res.status(500).json({ error: 'stats_failed', detail: String(e) });
  }
}
