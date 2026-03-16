import { Hono } from 'hono';
import { kvIssueStore } from '../store/kv-issues';
import { generateInvestigationPrompt, generateCustomerResponse } from '../agent';
import type {
  GeneratePromptRequest,
  GeneratePromptResponse,
  GenerateCustomerResponseRequest,
  GenerateCustomerResponseResponse,
} from '../types';

export function createGenerationRoutes() {
  const generation = new Hono();

  // POST /api/generate/prompt - Generate investigation prompt for Claude Code
  generation.post('/prompt', async (c) => {
    let body: GeneratePromptRequest;

    try {
      body = await c.req.json<GeneratePromptRequest>();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    if (!body.issueId) {
      return c.json({ error: 'issueId is required' }, 400);
    }

    const issue = await kvIssueStore.getIssue(body.issueId);
    if (!issue) {
      return c.json({ error: 'Issue not found' }, 404);
    }

    if (issue.status !== 'triaged') {
      return c.json({ error: 'Issue has not been triaged yet' }, 400);
    }

    try {
      const prompt = await generateInvestigationPrompt(body.issueId, {
        priority: issue.priority,
        confidence: issue.priorityConfidence,
        summary: issue.summary,
        investigationOutline: issue.investigationOutline,
      });

      const response: GeneratePromptResponse = {
        prompt,
        issueTitle: issue.originalIssue.title,
      };
      return c.json(response, 200);
    } catch (error) {
      console.error('Failed to generate prompt:', error);
      return c.json(
        { error: 'Failed to generate prompt', message: error instanceof Error ? error.message : 'Unknown error' },
        500
      );
    }
  });

  // POST /api/generate/response - Generate customer response
  generation.post('/response', async (c) => {
    let body: GenerateCustomerResponseRequest;

    try {
      body = await c.req.json<GenerateCustomerResponseRequest>();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    if (!body.issueId) {
      return c.json({ error: 'issueId is required' }, 400);
    }

    const issue = await kvIssueStore.getIssue(body.issueId);
    if (!issue) {
      return c.json({ error: 'Issue not found' }, 404);
    }

    if (issue.status !== 'triaged') {
      return c.json({ error: 'Issue has not been triaged yet' }, 400);
    }

    try {
      const result = await generateCustomerResponse(body.issueId, {
        priority: issue.priority,
        confidence: issue.priorityConfidence,
        summary: issue.summary,
        investigationOutline: issue.investigationOutline,
      });

      const response: GenerateCustomerResponseResponse = result;
      return c.json(response, 200);
    } catch (error) {
      console.error('Failed to generate customer response:', error);
      return c.json(
        { error: 'Failed to generate response', message: error instanceof Error ? error.message : 'Unknown error' },
        500
      );
    }
  });

  return generation;
}
