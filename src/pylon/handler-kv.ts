import type { Context } from 'hono';
import type { PylonWebhookPayload, LegacyPylonWebhookPayload, PylonIssueData, PylonMCPIssue } from './types';
import type { PylonIssue } from '../types';
import { verifyWebhookSignature, parseSignatureHeader } from './verify';
import { d1IssueStore } from '../store/d1-issues';
import { d1UserStore } from '../store/d1-users';
import { triageIssue } from '../agent';
import { mcpClient } from '../mcp/client';

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

// Convert MCP issue to our internal format
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

// Convert new webhook payload to our internal format
function convertNewPayloadToInternal(payload: PylonWebhookPayload): PylonIssue {
  const { client_payload } = payload;
  return {
    id: client_payload.id,
    title: client_payload.title,
    description: client_payload.description || stripHtml(client_payload.summary || ''),
    customerEmail: '',
    accountName: client_payload.account,
    createdAt: new Date().toISOString(),
    pylonLink: buildPylonLink(client_payload.id),
  };
}

// Convert legacy webhook data to our internal format
function convertLegacyToInternal(data: PylonIssueData): PylonIssue {
  return {
    id: data.id,
    title: data.title,
    description: data.description,
    customerEmail: data.customer.email,
    customerName: data.customer.name,
    customerTier: data.account?.tier,
    accountId: data.account?.id,
    accountName: data.account?.name,
    createdAt: data.created_at,
    source: data.source.type,
    tags: data.tags,
    metadata: data.metadata,
  };
}

// Check if payload is new format
function isNewPayloadFormat(payload: unknown): payload is PylonWebhookPayload {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'event_type' in payload &&
    'client_payload' in payload
  );
}

// Check if payload is legacy format
function isLegacyPayloadFormat(payload: unknown): payload is LegacyPylonWebhookPayload {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'event' in payload &&
    'data' in payload
  );
}

export function createWebhookHandler() {
  return async (c: Context): Promise<Response> => {
    const rawBody = await c.req.text();

    // Get signature from headers (for legacy format)
    const signatureHeader = c.req.header('x-pylon-signature') ||
                            c.req.header('X-Pylon-Signature') || '';

    let timestamp: string | null = null;
    let signature: string | null = null;

    if (signatureHeader.includes(',')) {
      const parsed = parseSignatureHeader(signatureHeader);
      timestamp = parsed.timestamp;
      signature = parsed.signature;
    } else {
      signature = signatureHeader;
      timestamp = c.req.header('x-pylon-timestamp') ||
                  c.req.header('X-Pylon-Timestamp') ||
                  String(Math.floor(Date.now() / 1000));
    }

    // Verify webhook signature (skip if no signature provided)
    if (signature) {
      const verification = await verifyWebhookSignature(rawBody, signature, timestamp);
      if (!verification.valid) {
        console.error('Webhook verification failed:', verification.error);
        return c.json({ error: 'Unauthorized', message: verification.error }, 401);
      }
    }

    // Parse payload
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return c.json({ error: 'Invalid JSON payload' }, 400);
    }

    // Unwrap if payload is nested inside webhook_payload (Pylon wrapper format)
    const wrappedPayload = payload as { webhook_payload?: unknown };
    if (wrappedPayload.webhook_payload) {
      payload = wrappedPayload.webhook_payload;
    }

    let issue: PylonIssue;
    let eventType: string;

    // Handle new payload format
    if (isNewPayloadFormat(payload)) {
      eventType = payload.event_type;

      // Handle issue reassignment - update existing issue with new assignee
      if (eventType === 'issue-reassigned') {
        const issueId = payload.client_payload.id;
        console.log(`Issue reassigned webhook received: ${issueId}`);

        // Check if we have this issue
        const existingIssue = await d1IssueStore.getIssue(issueId);
        if (!existingIssue) {
          console.log(`Reassigned issue not found in store: ${issueId}`);
          return c.json({ received: true, processed: false, reason: 'issue_not_found' });
        }

        // Refresh issue data from MCP to get updated assignee
        await refreshIssueFromMCP(issueId);

        return c.json({ received: true, processed: true, issueId, action: 'refreshed' });
      }

      // Only process new-issue events for new issues
      if (eventType !== 'new-issue') {
        console.log(`Ignoring event type: ${eventType}`);
        return c.json({ received: true, processed: false });
      }

      // Start with basic info from webhook
      issue = convertNewPayloadToInternal(payload);

      // Check for duplicate
      if (await d1IssueStore.hasIssue(issue.id)) {
        console.log(`Duplicate issue ignored: ${issue.id}`);
        return c.json({ received: true, processed: false, reason: 'duplicate' });
      }

      console.log(`Webhook received for issue: ${issue.id} - "${issue.title}"`);

      // Add to store as pending
      await d1IssueStore.addPendingIssue(issue);

      // Enrich and triage (await to ensure it completes before response)
      await enrichAndTriageIssue(issue.id, issue);

      return c.json({ received: true, processed: true, issueId: issue.id });
    }

    // Handle legacy payload format
    if (isLegacyPayloadFormat(payload)) {
      eventType = payload.event;

      if (eventType !== 'issue.created') {
        console.log(`Ignoring event type: ${eventType}`);
        return c.json({ received: true, processed: false });
      }

      issue = convertLegacyToInternal(payload.data);

      if (await d1IssueStore.hasIssue(issue.id)) {
        console.log(`Duplicate issue ignored: ${issue.id}`);
        return c.json({ received: true, processed: false, reason: 'duplicate' });
      }

      await d1IssueStore.addPendingIssue(issue);
      console.log(`Issue received: ${issue.id} - "${issue.title}"`);

      await enrichAndTriageIssue(issue.id, issue);

      return c.json({ received: true, processed: true, issueId: issue.id });
    }

    return c.json({ error: 'Unrecognized payload format' }, 400);
  };
}

// Refresh issue data from MCP (for reassignment updates, etc.)
async function refreshIssueFromMCP(issueId: string): Promise<void> {
  try {
    console.log(`Refreshing issue from MCP: ${issueId}`);
    const mcpResult = await mcpClient.getIssue(issueId);

    if (mcpResult.isError || !mcpResult.content) {
      console.warn(`MCP fetch failed for refresh ${issueId}: ${mcpResult.errorMessage}`);
      return;
    }

    const refreshedIssue = convertMCPIssueToInternal(mcpResult.content);

    // Enrich assignee with full user data
    if (refreshedIssue.assignee) {
      refreshedIssue.assignee = await d1UserStore.enrichAssignee(refreshedIssue.assignee);
    }

    // Update the stored issue with refreshed data
    await d1IssueStore.updateOriginalIssue(issueId, refreshedIssue);
    console.log(`Issue refreshed: ${issueId} - Assignee: ${refreshedIssue.assignee?.name || 'none'}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Failed to refresh issue ${issueId}:`, errorMessage);
  }
}

// Enrich issue via MCP then triage
async function enrichAndTriageIssue(issueId: string, initialIssue: PylonIssue): Promise<void> {
  try {
    await d1IssueStore.markTriaging(issueId);

    // Fetch full issue details from Pylon via MCP
    console.log(`Fetching issue details from Pylon MCP: ${issueId}`);
    const mcpResult = await mcpClient.getIssue(issueId);

    let enrichedIssue: PylonIssue;

    if (!mcpResult.isError && mcpResult.content) {
      enrichedIssue = convertMCPIssueToInternal(mcpResult.content);

      // Enrich assignee with full user data from cache
      if (enrichedIssue.assignee) {
        enrichedIssue.assignee = await d1UserStore.enrichAssignee(enrichedIssue.assignee);
      }

      // Fetch account name if we have accountId but no accountName
      if (enrichedIssue.accountId && !enrichedIssue.accountName) {
        const accountResult = await mcpClient.getAccount(enrichedIssue.accountId);
        if (!accountResult.isError && accountResult.content) {
          const account = accountResult.content as { name?: string };
          if (account.name) {
            enrichedIssue.accountName = account.name;
          }
        }
      }

      console.log(`Issue enriched from MCP: ${issueId} - Link: ${enrichedIssue.pylonLink}`);
    } else {
      console.warn(`MCP fetch failed for ${issueId}: ${mcpResult.errorMessage}`);
      enrichedIssue = initialIssue;
    }

    // Run triage
    const result = await triageIssue(enrichedIssue);

    await d1IssueStore.updateTriagedIssue(issueId, {
      priority: result.priority,
      priorityConfidence: result.confidence,
      summary: result.summary,
      investigationOutline: result.investigationOutline,
    }, enrichedIssue);

    console.log(`Issue triaged: ${issueId} - Priority: ${result.priority} (${Math.round(result.confidence * 100)}%)`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Triage failed for ${issueId}:`, errorMessage);
    await d1IssueStore.markFailed(issueId, errorMessage);
  }
}
