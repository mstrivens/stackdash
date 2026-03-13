import type { CustomerTier } from '../types';

// Pylon webhook event types
export type PylonEventType =
  | 'new-issue'
  | 'issue.created'
  | 'issue.updated'
  | 'issue.resolved'
  | 'issue.escalated';

// New webhook payload format from Pylon
export interface PylonWebhookPayload {
  event_type: PylonEventType;
  client_payload: {
    id: string;
    title: string;
    summary?: string;
    description?: string;
    account?: string;
  };
}

// Legacy webhook payload format (for backwards compatibility)
export interface LegacyPylonWebhookPayload {
  event: PylonEventType;
  timestamp: string;
  data: PylonIssueData;
  signature?: string;
}

// Issue data from legacy Pylon webhook
export interface PylonIssueData {
  id: string;
  title: string;
  description: string;
  customer: PylonCustomer;
  account?: PylonAccount;
  source: PylonSource;
  status: PylonStatus;
  priority?: string;
  tags: string[];
  created_at: string;
  updated_at: string;
  metadata?: Record<string, unknown>;
}

// Customer information from Pylon
export interface PylonCustomer {
  id: string;
  email: string;
  name?: string;
  external_id?: string;
}

// Account information from Pylon
export interface PylonAccount {
  id: string;
  name: string;
  tier?: CustomerTier;
  external_id?: string;
}

// Source of the issue
export interface PylonSource {
  type: 'email' | 'chat' | 'ticket' | 'api' | 'slack' | 'other';
  channel?: string;
  conversation_id?: string;
}

// Issue status
export type PylonStatus =
  | 'new'
  | 'open'
  | 'pending'
  | 'resolved'
  | 'closed';

// Webhook verification result
export interface WebhookVerificationResult {
  valid: boolean;
  error?: string;
}

// Full Pylon issue from MCP pylon_get_issue
export interface PylonMCPIssue {
  id: string;
  number: number;
  title: string;
  link: string;
  body_html: string;
  state: string;
  account?: {
    id: string;
    name?: string;
  };
  assignee?: {
    id: string;
    name?: string;
    email?: string;
  };
  requester?: {
    id: string;
    name?: string;
    email?: string;
  };
  team?: {
    id: string;
    name?: string;
  } | null;
  tags?: string[] | null;
  custom_fields?: Record<string, { value: string }>;
  first_response_time?: string;
  resolution_time?: string;
  latest_message_time?: string;
  created_at: string;
  source?: string;
  type?: string;
  external_issues?: Array<{
    source: string;
    external_id: string;
    link: string;
  }>;
}
