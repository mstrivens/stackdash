import { Hono } from 'hono';
import { issueStore } from '../store/issues';
import type { IssuesResponse } from '../types';

const issues = new Hono();

// GET /api/issues - Fetch all triaged issues with stats
issues.get('/', (c) => {
  const allIssues = issueStore.getAllIssues();
  const stats = issueStore.getStats();

  const response: IssuesResponse = {
    issues: allIssues,
    stats,
    lastUpdated: new Date().toISOString(),
  };

  return c.json(response);
});

// GET /api/issues/:id - Fetch a single issue
issues.get('/:id', (c) => {
  const id = c.req.param('id');
  const issue = issueStore.getIssue(id);

  if (!issue) {
    return c.json({ error: 'Issue not found' }, 404);
  }

  return c.json(issue);
});

// GET /api/issues/priority/:priority - Fetch issues by priority
issues.get('/priority/:priority', (c) => {
  const priority = c.req.param('priority') as 'high' | 'medium' | 'low';

  if (!['high', 'medium', 'low'].includes(priority)) {
    return c.json({ error: 'Invalid priority. Must be high, medium, or low' }, 400);
  }

  const filteredIssues = issueStore.getIssuesByPriority(priority);
  return c.json({ issues: filteredIssues, count: filteredIssues.length });
});

// DELETE /api/issues/:id - Delete an issue
issues.delete('/:id', (c) => {
  const id = c.req.param('id');
  const deleted = issueStore.deleteIssue(id);

  if (!deleted) {
    return c.json({ error: 'Issue not found' }, 404);
  }

  return c.json({ deleted: true, id });
});

export { issues };
