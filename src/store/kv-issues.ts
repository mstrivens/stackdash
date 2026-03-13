import type { PylonIssue, TriagedIssue, DashboardStats, Priority, Assignee } from '../types';

// Global KV reference (set per-request in worker)
let kvNamespace: KVNamespace | null = null;

export function setKVNamespace(kv: KVNamespace) {
  kvNamespace = kv;
}

const ISSUES_KEY = 'issues';
const STATS_KEY = 'stats';

interface StoredData {
  issues: Record<string, TriagedIssue>;
  lastUpdated: string;
}

async function getData(): Promise<StoredData> {
  if (!kvNamespace) {
    return { issues: {}, lastUpdated: new Date().toISOString() };
  }
  const data = await kvNamespace.get(ISSUES_KEY, 'json') as StoredData | null;
  return data || { issues: {}, lastUpdated: new Date().toISOString() };
}

async function saveData(data: StoredData): Promise<void> {
  if (!kvNamespace) return;
  await kvNamespace.put(ISSUES_KEY, JSON.stringify(data));
}

export const kvIssueStore = {
  async addPendingIssue(issue: PylonIssue): Promise<TriagedIssue> {
    const data = await getData();

    const triaged: TriagedIssue = {
      id: issue.id,
      originalIssue: issue,
      priority: 'medium',
      priorityConfidence: 0,
      summary: '',
      investigationOutline: [],
      triageTimestamp: '',
      retryCount: 0,
      status: 'pending',
    };

    data.issues[issue.id] = triaged;
    data.lastUpdated = new Date().toISOString();
    await saveData(data);
    return triaged;
  },

  async markTriaging(issueId: string): Promise<void> {
    const data = await getData();
    if (data.issues[issueId]) {
      data.issues[issueId].status = 'triaging';
      await saveData(data);
    }
  },

  async updateTriagedIssue(
    issueId: string,
    updates: {
      priority: Priority;
      priorityConfidence: number;
      summary: string;
      investigationOutline: string[];
    },
    enrichedIssue?: PylonIssue
  ): Promise<TriagedIssue | undefined> {
    const data = await getData();
    const issue = data.issues[issueId];
    if (!issue) return undefined;

    data.issues[issueId] = {
      ...issue,
      ...updates,
      originalIssue: enrichedIssue || issue.originalIssue,
      triageTimestamp: new Date().toISOString(),
      status: 'triaged',
    };
    data.lastUpdated = new Date().toISOString();
    await saveData(data);
    return data.issues[issueId];
  },

  async markFailed(issueId: string, errorMessage: string): Promise<void> {
    const data = await getData();
    if (data.issues[issueId]) {
      data.issues[issueId].status = 'failed';
      data.issues[issueId].errorMessage = errorMessage;
      data.issues[issueId].retryCount++;
      await saveData(data);
    }
  },

  async getIssue(issueId: string): Promise<TriagedIssue | undefined> {
    const data = await getData();
    return data.issues[issueId];
  },

  async getAllIssues(): Promise<TriagedIssue[]> {
    const data = await getData();
    const priorityOrder: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

    return Object.values(data.issues).sort((a, b) => {
      if (a.status === 'triaged' && b.status !== 'triaged') return -1;
      if (b.status === 'triaged' && a.status !== 'triaged') return 1;
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return new Date(b.originalIssue.createdAt).getTime() - new Date(a.originalIssue.createdAt).getTime();
    });
  },

  async getStats(): Promise<DashboardStats> {
    const data = await getData();
    const all = Object.values(data.issues);
    const triaged = all.filter(i => i.status === 'triaged');

    return {
      totalIssues: all.length,
      highPriorityCount: triaged.filter(i => i.priority === 'high').length,
      mediumPriorityCount: triaged.filter(i => i.priority === 'medium').length,
      lowPriorityCount: triaged.filter(i => i.priority === 'low').length,
      pendingTriageCount: all.filter(i => i.status === 'pending' || i.status === 'triaging').length,
      failedTriageCount: all.filter(i => i.status === 'failed').length,
      avgTriageTime: 0,
      recentActivityCount: all.length,
    };
  },

  async hasIssue(issueId: string): Promise<boolean> {
    const data = await getData();
    return issueId in data.issues;
  },

  async deleteIssue(issueId: string): Promise<boolean> {
    const data = await getData();
    if (issueId in data.issues) {
      delete data.issues[issueId];
      await saveData(data);
      return true;
    }
    return false;
  },

  async getIssuesByPriority(priority: Priority): Promise<TriagedIssue[]> {
    const all = await this.getAllIssues();
    return all.filter(i => i.status === 'triaged' && i.priority === priority);
  },

  async getAssignees(): Promise<Assignee[]> {
    const data = await getData();
    const assigneeMap = new Map<string, Assignee>();

    for (const issue of Object.values(data.issues)) {
      const assignee = issue.originalIssue.assignee;
      if (assignee && assignee.id) {
        assigneeMap.set(assignee.id, assignee);
      }
    }

    return Array.from(assigneeMap.values()).sort((a, b) => {
      const nameA = a.name || a.email || '';
      const nameB = b.name || b.email || '';
      return nameA.localeCompare(nameB);
    });
  },
};
