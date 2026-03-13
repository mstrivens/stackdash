import type {
  PylonIssue,
  TriagedIssue,
  RetryQueueItem,
  DashboardStats,
  Priority,
} from '../types';

const MAX_RETRY_COUNT = 3;
const RETRY_DELAY_MS = 30000; // 30 seconds

class IssueStore {
  private issues: Map<string, TriagedIssue> = new Map();
  private retryQueue: Map<string, RetryQueueItem> = new Map();
  private triageStartTimes: Map<string, number> = new Map();
  private triageDurations: number[] = [];

  // Add a new issue from webhook
  addPendingIssue(issue: PylonIssue): TriagedIssue {
    const triaged: TriagedIssue = {
      id: issue.id,
      originalIssue: issue,
      priority: 'medium', // Default until triaged
      priorityConfidence: 0,
      summary: '',
      investigationOutline: [],
      triageTimestamp: '',
      retryCount: 0,
      status: 'pending',
    };

    this.issues.set(issue.id, triaged);
    this.triageStartTimes.set(issue.id, Date.now());
    return triaged;
  }

  // Update issue status to triaging
  markTriaging(issueId: string): void {
    const issue = this.issues.get(issueId);
    if (issue) {
      issue.status = 'triaging';
      this.issues.set(issueId, issue);
    }
  }

  // Update issue with triage results
  updateTriagedIssue(
    issueId: string,
    updates: {
      priority: Priority;
      priorityConfidence: number;
      summary: string;
      investigationOutline: string[];
    }
  ): TriagedIssue | undefined {
    const issue = this.issues.get(issueId);
    if (!issue) return undefined;

    const startTime = this.triageStartTimes.get(issueId);
    if (startTime) {
      this.triageDurations.push(Date.now() - startTime);
      this.triageStartTimes.delete(issueId);
    }

    const updated: TriagedIssue = {
      ...issue,
      ...updates,
      triageTimestamp: new Date().toISOString(),
      status: 'triaged',
    };

    this.issues.set(issueId, updated);
    this.retryQueue.delete(issueId);
    return updated;
  }

  // Mark issue as failed and add to retry queue
  markFailed(issueId: string, errorMessage: string): void {
    const issue = this.issues.get(issueId);
    if (!issue) return;

    issue.status = 'failed';
    issue.errorMessage = errorMessage;
    issue.retryCount++;
    this.issues.set(issueId, issue);

    if (issue.retryCount < MAX_RETRY_COUNT) {
      this.retryQueue.set(issueId, {
        issue: issue.originalIssue,
        retryCount: issue.retryCount,
        nextRetryAt: Date.now() + RETRY_DELAY_MS,
        lastError: errorMessage,
      });
    }
  }

  // Get issues ready for retry
  getRetryableIssues(): RetryQueueItem[] {
    const now = Date.now();
    const ready: RetryQueueItem[] = [];

    for (const [id, item] of this.retryQueue) {
      if (item.nextRetryAt <= now) {
        ready.push(item);
        // Update status back to pending for retry
        const issue = this.issues.get(id);
        if (issue) {
          issue.status = 'pending';
          this.issues.set(id, issue);
        }
      }
    }

    return ready;
  }

  // Remove from retry queue (called when retry starts)
  removeFromRetryQueue(issueId: string): void {
    this.retryQueue.delete(issueId);
  }

  // Get single issue by ID
  getIssue(issueId: string): TriagedIssue | undefined {
    return this.issues.get(issueId);
  }

  // Get all issues sorted by priority and timestamp
  getAllIssues(): TriagedIssue[] {
    const priorityOrder: Record<Priority, number> = {
      high: 0,
      medium: 1,
      low: 2,
    };

    return Array.from(this.issues.values()).sort((a, b) => {
      // Sort by status first (triaged issues before pending/failed)
      if (a.status === 'triaged' && b.status !== 'triaged') return -1;
      if (b.status === 'triaged' && a.status !== 'triaged') return 1;

      // Then by priority
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;

      // Then by creation time (newest first)
      return new Date(b.originalIssue.createdAt).getTime() -
        new Date(a.originalIssue.createdAt).getTime();
    });
  }

  // Get issues filtered by priority
  getIssuesByPriority(priority: Priority): TriagedIssue[] {
    return this.getAllIssues().filter(
      i => i.status === 'triaged' && i.priority === priority
    );
  }

  // Calculate dashboard statistics
  getStats(): DashboardStats {
    const all = this.getAllIssues();
    const triaged = all.filter(i => i.status === 'triaged');

    const avgTriageTime = this.triageDurations.length > 0
      ? this.triageDurations.reduce((a, b) => a + b, 0) / this.triageDurations.length
      : 0;

    // Count recent activity (last 5 minutes)
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    const recentActivityCount = all.filter(i => {
      const timestamp = i.triageTimestamp || i.originalIssue.createdAt;
      return new Date(timestamp).getTime() > fiveMinutesAgo;
    }).length;

    return {
      totalIssues: all.length,
      highPriorityCount: triaged.filter(i => i.priority === 'high').length,
      mediumPriorityCount: triaged.filter(i => i.priority === 'medium').length,
      lowPriorityCount: triaged.filter(i => i.priority === 'low').length,
      pendingTriageCount: all.filter(i => i.status === 'pending' || i.status === 'triaging').length,
      failedTriageCount: all.filter(i => i.status === 'failed').length,
      avgTriageTime: Math.round(avgTriageTime),
      recentActivityCount,
    };
  }

  // Check if issue exists
  hasIssue(issueId: string): boolean {
    return this.issues.has(issueId);
  }

  // Delete an issue
  deleteIssue(issueId: string): boolean {
    this.retryQueue.delete(issueId);
    this.triageStartTimes.delete(issueId);
    return this.issues.delete(issueId);
  }

  // Clear all issues (for testing)
  clear(): void {
    this.issues.clear();
    this.retryQueue.clear();
    this.triageStartTimes.clear();
    this.triageDurations = [];
  }
}

// Singleton instance
export const issueStore = new IssueStore();
