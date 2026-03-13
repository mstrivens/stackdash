// Frontend types (mirrors backend but for client-side use)

export type Priority = 'high' | 'medium' | 'low';
export type CustomerTier = 'enterprise' | 'business' | 'starter' | 'free';

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
}

export interface TriagedIssue {
  id: string;
  originalIssue: PylonIssue;
  priority: Priority;
  priorityConfidence: number;
  summary: string;
  investigationOutline: string[];
  triageTimestamp: string;
  retryCount: number;
  status: 'pending' | 'triaging' | 'triaged' | 'failed';
  errorMessage?: string;
}

export interface Todo {
  id: string;
  issueId: string;
  title: string;
  description: string;
  steps: string[];
  createdAt: string;
  completedAt?: string;
  completed: boolean;
}

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

export interface IssuesResponse {
  issues: TriagedIssue[];
  stats: DashboardStats;
  lastUpdated: string;
}
