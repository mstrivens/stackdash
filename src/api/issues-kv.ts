import { Hono } from 'hono';
import { d1IssueStore } from '../store/d1-issues';
import { d1UserStore } from '../store/d1-users';
import { mcpClient } from '../mcp/client';
import type { IssuesResponse, PylonIssue } from '../types';
import type { PylonMCPIssue } from '../pylon/types';

// Strip HTML tags from string
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').trim();
}

// Build the correct Pylon URL format
function buildPylonLink(issueId: string, issueNumber?: number): string {
  const base = `https://app.usepylon.com/support/issues/views/${issueId}`;
  if (issueNumber) {
    return `${base}?issueNumber=${issueNumber}&view=fs`;
  }
  return base;
}

// Convert MCP issue to internal format
function convertMCPIssueToInternal(mcpIssue: PylonMCPIssue): PylonIssue {
  return {
    id: mcpIssue.id,
    title: mcpIssue.title,
    description: stripHtml(mcpIssue.body_html),
    customerEmail: mcpIssue.requester?.email || '',
    customerName: mcpIssue.requester?.name,
    accountId: mcpIssue.account?.id,
    accountName: mcpIssue.account?.name,
    createdAt: mcpIssue.created_at,
    source: mcpIssue.source,
    tags: mcpIssue.tags || [],
    pylonLink: buildPylonLink(mcpIssue.id, mcpIssue.number),
    issueNumber: mcpIssue.number,
    state: mcpIssue.state,
    assignee: mcpIssue.assignee ? {
      id: mcpIssue.assignee.id,
      name: mcpIssue.assignee.name,
      email: mcpIssue.assignee.email,
    } : undefined,
    metadata: {
      team: mcpIssue.team,
      customFields: mcpIssue.custom_fields,
      externalIssues: mcpIssue.external_issues,
    },
  };
}

export function createIssuesRoutes() {
  const issues = new Hono();

  // GET /api/issues - Fetch all triaged issues with stats
  issues.get('/', async (c) => {
    const allIssues = await d1IssueStore.getAllIssues();
    const stats = await d1IssueStore.getStats();

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
    const assignees = await d1IssueStore.getAssignees();
    return c.json({ assignees });
  });

  // GET /api/issues/:id - Fetch a single issue
  issues.get('/:id', async (c) => {
    const id = c.req.param('id');
    const issue = await d1IssueStore.getIssue(id);

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

    const filteredIssues = await d1IssueStore.getIssuesByPriority(priority);
    return c.json({ issues: filteredIssues, count: filteredIssues.length });
  });

  // DELETE /api/issues/:id - Delete an issue
  issues.delete('/:id', async (c) => {
    const id = c.req.param('id');
    const deleted = await d1IssueStore.deleteIssue(id);

    if (!deleted) {
      return c.json({ error: 'Issue not found' }, 404);
    }

    return c.json({ deleted: true, id });
  });

  // POST /api/issues/:id/refresh - Re-fetch and update issue from MCP
  issues.post('/:id/refresh', async (c) => {
    const id = c.req.param('id');
    const existingIssue = await d1IssueStore.getIssue(id);

    if (!existingIssue) {
      return c.json({ error: 'Issue not found' }, 404);
    }

    console.log(`Refreshing issue from MCP: ${id}`);
    const mcpResult = await mcpClient.getIssue(id);

    if (mcpResult.isError || !mcpResult.content) {
      return c.json({
        error: 'Failed to fetch issue from MCP',
        details: mcpResult.errorMessage,
      }, 500);
    }

    // Convert and enrich
    const refreshedIssue = convertMCPIssueToInternal(mcpResult.content);
    if (refreshedIssue.assignee) {
      refreshedIssue.assignee = await d1UserStore.enrichAssignee(refreshedIssue.assignee);
    }

    // Fetch account name if we have accountId but no accountName
    if (refreshedIssue.accountId && !refreshedIssue.accountName) {
      const accountResult = await mcpClient.getAccount(refreshedIssue.accountId);
      if (!accountResult.isError && accountResult.content) {
        const account = accountResult.content as { name?: string };
        if (account.name) {
          refreshedIssue.accountName = account.name;
        }
      }
    }

    // Update the issue with refreshed data
    await d1IssueStore.updateTriagedIssue(id, {
      priority: existingIssue.priority,
      priorityConfidence: existingIssue.priorityConfidence,
      summary: existingIssue.summary,
      investigationOutline: existingIssue.investigationOutline,
    }, refreshedIssue);

    const updatedIssue = await d1IssueStore.getIssue(id);

    return c.json({
      success: true,
      issue: updatedIssue,
    });
  });

  return issues;
}
