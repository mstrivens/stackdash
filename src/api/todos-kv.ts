import { Hono } from 'hono';
import { d1IssueStore } from '../store/d1-issues';
import { generateTodoFromIssue } from '../agent';
import type { GenerateTodoRequest, GenerateTodoResponse } from '../types';

export function createTodosRoutes() {
  const todos = new Hono();

  // POST /api/todos/generate - Generate a to-do from an issue
  todos.post('/generate', async (c) => {
    let body: GenerateTodoRequest;

    try {
      body = await c.req.json<GenerateTodoRequest>();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    if (!body.issueId) {
      return c.json({ error: 'issueId is required' }, 400);
    }

    const issue = await d1IssueStore.getIssue(body.issueId);
    if (!issue) {
      return c.json({ error: 'Issue not found' }, 404);
    }

    if (issue.status !== 'triaged') {
      return c.json({ error: 'Issue has not been triaged yet' }, 400);
    }

    try {
      const todo = await generateTodoFromIssue(issue.originalIssue, {
        priority: issue.priority,
        confidence: issue.priorityConfidence,
        summary: issue.summary,
        investigationOutline: issue.investigationOutline,
      });

      const response: GenerateTodoResponse = { todo };
      return c.json(response, 201);
    } catch (error) {
      console.error('Failed to generate todo:', error);
      return c.json(
        { error: 'Failed to generate to-do', message: error instanceof Error ? error.message : 'Unknown error' },
        500
      );
    }
  });

  return todos;
}
