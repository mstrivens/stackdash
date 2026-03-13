import React from 'react';
import type { TriagedIssue, Todo, DashboardStats } from '../types';
import { IssueColumn } from './IssueColumn';
import { TodoColumn } from './TodoColumn';
import { StatsColumn } from './StatsColumn';

interface DashboardProps {
  issues: TriagedIssue[];
  stats: DashboardStats;
  todos: Todo[];
  lastUpdated: string | null;
  isLoading: boolean;
  onTodoGenerated: (todo: Todo) => void;
  onTodoToggle: (id: string) => void;
  onTodoDelete: (id: string) => void;
  onClearCompleted: () => void;
  onIssueDeleted: (issueId: string) => void;
  pendingTodoCount: number;
  completedTodoCount: number;
}

export function Dashboard({
  issues,
  stats,
  todos,
  lastUpdated,
  isLoading,
  onTodoGenerated,
  onTodoToggle,
  onTodoDelete,
  onClearCompleted,
  onIssueDeleted,
  pendingTodoCount,
  completedTodoCount,
}: DashboardProps) {
  // Separate issues by priority
  const triaged = issues.filter(i => i.status === 'triaged');
  const pending = issues.filter(i => i.status === 'pending' || i.status === 'triaging');
  const failed = issues.filter(i => i.status === 'failed');

  // Combine triaged issues sorted by priority, then pending/failed at the end
  const sortedIssues = [
    ...triaged.filter(i => i.priority === 'high'),
    ...triaged.filter(i => i.priority === 'medium'),
    ...triaged.filter(i => i.priority === 'low'),
    ...pending,
    ...failed,
  ];

  if (isLoading && issues.length === 0) {
    return (
      <div className="dashboard">
        <div className="column">
          <div className="loading">
            <div className="spinner" />
          </div>
        </div>
        <div className="column">
          <div className="loading">
            <div className="spinner" />
          </div>
        </div>
        <StatsColumn stats={stats} lastUpdated={lastUpdated} />
      </div>
    );
  }

  return (
    <div className="dashboard">
      <IssueColumn
        title="Triaged Issues"
        issues={sortedIssues}
        onTodoGenerated={onTodoGenerated}
        onIssueDeleted={onIssueDeleted}
        emptyMessage="No issues received yet. Send a webhook to /api/pylon/webhook to get started."
      />

      <TodoColumn
        todos={todos}
        onToggle={onTodoToggle}
        onDelete={onTodoDelete}
        onClearCompleted={onClearCompleted}
        pendingCount={pendingTodoCount}
        completedCount={completedTodoCount}
      />

      <StatsColumn stats={stats} lastUpdated={lastUpdated} />
    </div>
  );
}
