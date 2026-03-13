import type { Context } from 'hono';
import type { PylonWebhookPayload, LegacyPylonWebhookPayload, PylonIssueData, PylonMCPIssue } from './types';
import type { PylonIssue } from '../types';
import { verifyWebhookSignature, parseSignatureHeader } from './verify';
import { issueStore } from '../store/issues';
import { triageIssue } from '../agent';
import { mcpClient } from '../mcp/client';

// Strip HTML tags from string
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').trim();
}

// Build the correct Pylon URL format
function buildPylonLink(issueId: string): string {
  return `https://app.usepylon.com/support/issues/views/${issueId}`;
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
    pylonLink: buildPylonLink(mcpIssue.id),
    issueNumber: mcpIssue.number,
    state: mcpIssue.state,
    metadata: {
      assignee: mcpIssue.assignee,
      team: mcpIssue.team,
      customFields: mcpIssue.custom_fields,
      externalIssues: mcpIssue.external_issues,
    },
  };
}

// Convert new webhook payload to our internal format (before MCP enrichment)
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

export async function handlePylonWebhook(c: Context): Promise<Response> {
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

  let issue: PylonIssue;
  let eventType: string;

  // Handle new payload format
  if (isNewPayloadFormat(payload)) {
    eventType = payload.event_type;

    // Only process new-issue events
    if (eventType !== 'new-issue') {
      console.log(`Ignoring event type: ${eventType}`);
      return c.json({ received: true, processed: false });
    }

    // Start with basic info from webhook
    issue = convertNewPayloadToInternal(payload);

    // Check for duplicate
    if (issueStore.hasIssue(issue.id)) {
      console.log(`Duplicate issue ignored: ${issue.id}`);
      return c.json({ received: true, processed: false, reason: 'duplicate' });
    }

    console.log(`Webhook received for issue: ${issue.id} - "${issue.title}"`);

    // Add to store as pending immediately
    issueStore.addPendingIssue(issue);

    // Fetch full issue details via MCP (async, don't block response)
    enrichAndTriageIssue(issue.id);

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

    if (issueStore.hasIssue(issue.id)) {
      console.log(`Duplicate issue ignored: ${issue.id}`);
      return c.json({ received: true, processed: false, reason: 'duplicate' });
    }

    issueStore.addPendingIssue(issue);
    console.log(`Issue received: ${issue.id} - "${issue.title}"`);

    triageIssueAsync(issue.id);

    return c.json({ received: true, processed: true, issueId: issue.id });
  }

  return c.json({ error: 'Unrecognized payload format' }, 400);
}

// Enrich issue via MCP then triage
async function enrichAndTriageIssue(issueId: string): Promise<void> {
  try {
    issueStore.markTriaging(issueId);

    // Fetch full issue details from Pylon via MCP
    console.log(`Fetching issue details from Pylon MCP: ${issueId}`);
    const mcpResult = await mcpClient.getIssue(issueId);

    let enrichedIssue: PylonIssue;

    if (!mcpResult.isError && mcpResult.content) {
      // Convert MCP response to our format
      enrichedIssue = convertMCPIssueToInternal(mcpResult.content);
      console.log(`Issue enriched from MCP: ${issueId} - Link: ${enrichedIssue.pylonLink}`);
    } else {
      // Fall back to original webhook data
      console.warn(`MCP fetch failed for ${issueId}: ${mcpResult.errorMessage}`);
      const existingIssue = issueStore.getIssue(issueId);
      if (!existingIssue) {
        console.error(`Issue not found: ${issueId}`);
        return;
      }
      enrichedIssue = existingIssue.originalIssue;
    }

    // Run triage
    const result = await triageIssue(enrichedIssue);

    issueStore.updateTriagedIssue(issueId, {
      priority: result.priority,
      priorityConfidence: result.confidence,
      summary: result.summary,
      investigationOutline: result.investigationOutline,
    });

    // Update the original issue with enriched data
    const storedIssue = issueStore.getIssue(issueId);
    if (storedIssue) {
      storedIssue.originalIssue = enrichedIssue;
    }

    console.log(`Issue triaged: ${issueId} - Priority: ${result.priority} (${Math.round(result.confidence * 100)}%)`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Triage failed for ${issueId}:`, errorMessage);
    issueStore.markFailed(issueId, errorMessage);
  }
}

// Legacy async triage (without MCP enrichment)
async function triageIssueAsync(issueId: string): Promise<void> {
  try {
    issueStore.markTriaging(issueId);
    const issue = issueStore.getIssue(issueId);

    if (!issue) {
      console.error(`Issue not found for triage: ${issueId}`);
      return;
    }

    const result = await triageIssue(issue.originalIssue);

    issueStore.updateTriagedIssue(issueId, {
      priority: result.priority,
      priorityConfidence: result.confidence,
      summary: result.summary,
      investigationOutline: result.investigationOutline,
    });

    console.log(`Issue triaged: ${issueId} - Priority: ${result.priority} (${Math.round(result.confidence * 100)}%)`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Triage failed for ${issueId}:`, errorMessage);
    issueStore.markFailed(issueId, errorMessage);
  }
}

// Process retry queue (called periodically)
export async function processRetryQueue(): Promise<void> {
  const retryable = issueStore.getRetryableIssues();

  for (const item of retryable) {
    console.log(`Retrying triage for ${item.issue.id} (attempt ${item.retryCount + 1})`);
    issueStore.removeFromRetryQueue(item.issue.id);
    enrichAndTriageIssue(item.issue.id);
  }
}
