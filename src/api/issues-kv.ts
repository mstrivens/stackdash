import { Hono } from 'hono';
import { kvIssueStore } from '../store/kv-issues';
import type { IssuesResponse } from '../types';

export function createIssuesRoutes() {
  const issues = new Hono();

  // GET /api/issues - Fetch all triaged issues with stats
  issues.get('/', async (c) => {
    const allIssues = await kvIssueStore.getAllIssues();
    const stats = await kvIssueStore.getStats();

    const response: IssuesResponse = {
      issues: allIssues,
      stats,
      lastUpdated: new Date().toISOString(),
    };

    return c.json(response);
  });

  // GET /api/issues/assignees - Get all unique assignees
  // NOTE: Must be defined before /:id to avoid matching "assignees" as an ID
  issues.get('/assignees', async (c) => {
    const assignees = await kvIssueStore.getAssignees();
    return c.json({ assignees });
  });

  // GET /api/issues/:id - Fetch a single issue
  issues.get('/:id', async (c) => {
    const id = c.req.param('id');
    const issue = await kvIssueStore.getIssue(id);

    if (!issue) {
      return c.json({ error: 'Issue not found' }, 404);
    }

    return c.json(issue);
  });

  // GET /api/issues/priority/:priority - Fetch issues by priority
  issues.get('/priority/:priority', async (c) => {
    const priority = c.req.param('priority') as 'high' | 'medium' | 'low';

    if (!['high', 'medium', 'low'].includes(priority)) {
      return c.json({ error: 'Invalid priority. Must be high, medium, or low' }, 400);
    }

    const filteredIssues = await kvIssueStore.getIssuesByPriority(priority);
    return c.json({ issues: filteredIssues, count: filteredIssues.length });
  });

  // DELETE /api/issues/:id - Delete an issue
  issues.delete('/:id', async (c) => {
    const id = c.req.param('id');
    const deleted = await kvIssueStore.deleteIssue(id);

    if (!deleted) {
      return c.json({ error: 'Issue not found' }, 404);
    }

    return c.json({ deleted: true, id });
  });

  return issues;
}
