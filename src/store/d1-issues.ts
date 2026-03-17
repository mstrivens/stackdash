import type { PylonIssue, TriagedIssue, DashboardStats, Priority, Assignee } from '../types';

// Global D1 reference (set per-request in worker)
let db: D1Database | null = null;

export function setD1Database(database: D1Database) {
  db = database;
}

interface IssueRow {
  id: string;
  original_issue: string;
  priority: string;
  priority_confidence: number;
  summary: string;
  investigation_outline: string;
  triage_timestamp: string | null;
  retry_count: number;
  status: string;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

function rowToTriagedIssue(row: IssueRow): TriagedIssue {
  return {
    id: row.id,
    originalIssue: JSON.parse(row.original_issue),
    priority: row.priority as Priority,
    priorityConfidence: row.priority_confidence,
    summary: row.summary,
    investigationOutline: JSON.parse(row.investigation_outline),
    triageTimestamp: row.triage_timestamp || '',
    retryCount: row.retry_count,
    status: row.status as TriagedIssue['status'],
    errorMessage: row.error_message || undefined,
  };
}

export const d1IssueStore = {
  async addPendingIssue(issue: PylonIssue): Promise<TriagedIssue> {
    if (!db) throw new Error('D1 database not initialized');

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

    await db.prepare(`
      INSERT INTO issues (id, original_issue, priority, priority_confidence, summary, investigation_outline, triage_timestamp, retry_count, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      triaged.id,
      JSON.stringify(triaged.originalIssue),
      triaged.priority,
      triaged.priorityConfidence,
      triaged.summary,
      JSON.stringify(triaged.investigationOutline),
      triaged.triageTimestamp || null,
      triaged.retryCount,
      triaged.status
    ).run();

    return triaged;
  },

  async markTriaging(issueId: string): Promise<void> {
    if (!db) return;

    await db.prepare(`
      UPDATE issues SET status = ?, updated_at = datetime('now') WHERE id = ?
    `).bind('triaging', issueId).run();
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
    if (!db) return undefined;

    const existing = await this.getIssue(issueId);
    if (!existing) return undefined;

    const originalIssue = enrichedIssue || existing.originalIssue;
    const triageTimestamp = new Date().toISOString();

    await db.prepare(`
      UPDATE issues
      SET priority = ?, priority_confidence = ?, summary = ?, investigation_outline = ?,
          original_issue = ?, triage_timestamp = ?, status = ?, updated_at = datetime('now')
      WHERE id = ?
    `).bind(
      updates.priority,
      updates.priorityConfidence,
      updates.summary,
      JSON.stringify(updates.investigationOutline),
      JSON.stringify(originalIssue),
      triageTimestamp,
      'triaged',
      issueId
    ).run();

    return {
      ...existing,
      ...updates,
      originalIssue,
      triageTimestamp,
      status: 'triaged',
    };
  },

  async markFailed(issueId: string, errorMessage: string): Promise<void> {
    if (!db) return;

    await db.prepare(`
      UPDATE issues
      SET status = ?, error_message = ?, retry_count = retry_count + 1, updated_at = datetime('now')
      WHERE id = ?
    `).bind('failed', errorMessage, issueId).run();
  },

  async updateOriginalIssue(issueId: string, updatedIssue: PylonIssue): Promise<TriagedIssue | undefined> {
    if (!db) return undefined;

    const existing = await this.getIssue(issueId);
    if (!existing) return undefined;

    await db.prepare(`
      UPDATE issues SET original_issue = ?, updated_at = datetime('now') WHERE id = ?
    `).bind(JSON.stringify(updatedIssue), issueId).run();

    return {
      ...existing,
      originalIssue: updatedIssue,
    };
  },

  async getIssue(issueId: string): Promise<TriagedIssue | undefined> {
    if (!db) return undefined;

    const result = await db.prepare(`
      SELECT * FROM issues WHERE id = ?
    `).bind(issueId).first<IssueRow>();

    return result ? rowToTriagedIssue(result) : undefined;
  },

  async getAllIssues(): Promise<TriagedIssue[]> {
    if (!db) return [];

    const priorityOrder = "CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 ELSE 3 END";
    const statusOrder = "CASE WHEN status = 'triaged' THEN 0 ELSE 1 END";

    const result = await db.prepare(`
      SELECT * FROM issues
      ORDER BY ${statusOrder}, ${priorityOrder}, created_at DESC
    `).all<IssueRow>();

    return (result.results || []).map(rowToTriagedIssue);
  },

  async getStats(): Promise<DashboardStats> {
    if (!db) {
      return {
        totalIssues: 0,
        highPriorityCount: 0,
        mediumPriorityCount: 0,
        lowPriorityCount: 0,
        pendingTriageCount: 0,
        failedTriageCount: 0,
        avgTriageTime: 0,
        recentActivityCount: 0,
      };
    }

    const totalResult = await db.prepare(`SELECT COUNT(*) as count FROM issues`).first<{ count: number }>();
    const highResult = await db.prepare(`SELECT COUNT(*) as count FROM issues WHERE status = 'triaged' AND priority = 'high'`).first<{ count: number }>();
    const mediumResult = await db.prepare(`SELECT COUNT(*) as count FROM issues WHERE status = 'triaged' AND priority = 'medium'`).first<{ count: number }>();
    const lowResult = await db.prepare(`SELECT COUNT(*) as count FROM issues WHERE status = 'triaged' AND priority = 'low'`).first<{ count: number }>();
    const pendingResult = await db.prepare(`SELECT COUNT(*) as count FROM issues WHERE status IN ('pending', 'triaging')`).first<{ count: number }>();
    const failedResult = await db.prepare(`SELECT COUNT(*) as count FROM issues WHERE status = 'failed'`).first<{ count: number }>();

    return {
      totalIssues: totalResult?.count || 0,
      highPriorityCount: highResult?.count || 0,
      mediumPriorityCount: mediumResult?.count || 0,
      lowPriorityCount: lowResult?.count || 0,
      pendingTriageCount: pendingResult?.count || 0,
      failedTriageCount: failedResult?.count || 0,
      avgTriageTime: 0,
      recentActivityCount: totalResult?.count || 0,
    };
  },

  async hasIssue(issueId: string): Promise<boolean> {
    if (!db) return false;

    const result = await db.prepare(`
      SELECT 1 FROM issues WHERE id = ? LIMIT 1
    `).bind(issueId).first();

    return result !== null;
  },

  async deleteIssue(issueId: string): Promise<boolean> {
    if (!db) return false;

    const result = await db.prepare(`
      DELETE FROM issues WHERE id = ?
    `).bind(issueId).run();

    return (result.meta?.changes || 0) > 0;
  },

  async getIssuesByPriority(priority: Priority): Promise<TriagedIssue[]> {
    if (!db) return [];

    const result = await db.prepare(`
      SELECT * FROM issues WHERE status = 'triaged' AND priority = ?
      ORDER BY created_at DESC
    `).bind(priority).all<IssueRow>();

    return (result.results || []).map(rowToTriagedIssue);
  },

  async getAssignees(): Promise<Assignee[]> {
    if (!db) return [];

    const result = await db.prepare(`SELECT original_issue FROM issues`).all<{ original_issue: string }>();
    const assigneeMap = new Map<string, Assignee>();

    for (const row of result.results || []) {
      const originalIssue = JSON.parse(row.original_issue) as PylonIssue & { metadata?: { assignee?: Assignee } };
      const assignee = originalIssue.assignee || originalIssue.metadata?.assignee;
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
