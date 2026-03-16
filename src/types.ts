// Priority levels for triaged issues
export type Priority = 'high' | 'medium' | 'low';

// Customer tier levels
export type CustomerTier = 'enterprise' | 'business' | 'starter' | 'free';

// Assignee information
export interface Assignee {
  id: string;
  name?: string;
  email?: string;
}

// Base Pylon issue from webhook + MCP enrichment
export interface PylonIssue {
  id: string;
  title: string;
  description: string;
  customerEmail: string;
  customerName?: string;
  customerTier?: CustomerTier;
  accountId?: string;
  accountName?: string;
  createdAt: string;
  source?: string;
  tags?: string[];
  pylonLink?: string;
  issueNumber?: number;
  state?: string;
  assignee?: Assignee;
  metadata?: Record<string, unknown>;
}

// Triaged issue after Claude processing
export interface TriagedIssue {
  id: string;
  originalIssue: PylonIssue;
  priority: Priority;
  priorityConfidence: number; // 0-1
  summary: string;
  investigationOutline: string[];
  triageTimestamp: string;
  retryCount: number;
  status: 'pending' | 'triaging' | 'triaged' | 'failed';
  errorMessage?: string;
}

// To-do item generated from an issue or created manually
// For manually created todos, issueId is set to 'manual'
export interface Todo {
  id: string;
  issueId: string; // Set to 'manual' for manually created todos
  title: string;
  description: string;
  steps: string[];
  createdAt: string;
  completedAt?: string;
  completed: boolean;
  assignee?: Assignee;
}

// Dashboard statistics
export interface DashboardStats {
  totalIssues: number;
  highPriorityCount: number;
  mediumPriorityCount: number;
  lowPriorityCount: number;
  pendingTriageCount: number;
  failedTriageCount: number;
  avgTriageTime: number;
  recentActivityCount: number;
}

// API response for issues endpoint
export interface IssuesResponse {
  issues: TriagedIssue[];
  stats: DashboardStats;
  lastUpdated: string;
}

// API request for generating todos
export interface GenerateTodoRequest {
  issueId: string;
}

// API response for generating todos
export interface GenerateTodoResponse {
  todo: Todo;
}

// Retry queue item
export interface RetryQueueItem {
  issue: PylonIssue;
  retryCount: number;
  nextRetryAt: number;
  lastError?: string;
}

// MCP tool call
export interface MCPToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

// MCP tool result
export interface MCPToolResult {
  content: unknown;
  isError?: boolean;
  errorMessage?: string;
}

// Triage result from Claude agent
export interface TriageResult {
  priority: Priority;
  confidence: number;
  summary: string;
  investigationOutline: string[];
  additionalContext?: Record<string, unknown>;
}

// Request/Response for investigation prompt generation
export interface GeneratePromptRequest {
  issueId: string;
}

export interface GeneratePromptResponse {
  prompt: string;
  issueTitle: string;
}

// Request/Response for customer response generation
export interface GenerateCustomerResponseRequest {
  issueId: string;
}

export type CustomerResponseType = 'holding' | 'request_info' | 'resolution';

export interface GenerateCustomerResponseResponse {
  responseType: CustomerResponseType;
  reasoning: string;
  message: string;
  infoNeeded?: string[];  // If responseType is 'request_info'
}
