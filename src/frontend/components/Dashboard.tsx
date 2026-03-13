import React from 'react';
import type { TriagedIssue, Todo, DashboardStats, Assignee } from '../types';
import { IssueColumn } from './IssueColumn';
import { TodoColumn } from './TodoColumn';
import { StatsColumn } from './StatsColumn';

interface DashboardProps {
  issues: TriagedIssue[];
  stats: DashboardStats;
  todos: Todo[];
  lastUpdated: string | null;
  isLoading: boolean;
  userMap: Map<string, Assignee>;
  onTodoGenerated: (todo: Todo) => void;
  onTodoToggle: (id: string) => void;
  onTodoDelete: (id: string) => void;
  onTodoUpdate: (id: string, updates: Partial<Todo>) => void;
  onTodoCreateManual: (title: string, description?: string, steps?: string[]) => void;
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
  userMap,
  onTodoGenerated,
  onTodoToggle,
  onTodoDelete,
  onTodoUpdate,
  onTodoCreateManual,
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
        title="Issues"
        issues={sortedIssues}
        userMap={userMap}
        onTodoGenerated={onTodoGenerated}
        onIssueDeleted={onIssueDeleted}
        emptyMessage="No issues to show. Select a different assignee or wait for new issues."
      />

      <TodoColumn
        todos={todos}
        userMap={userMap}
        onToggle={onTodoToggle}
        onDelete={onTodoDelete}
        onUpdate={onTodoUpdate}
        onCreateManual={onTodoCreateManual}
        onClearCompleted={onClearCompleted}
        pendingCount={pendingTodoCount}
        completedCount={completedTodoCount}
      />

      <StatsColumn stats={stats} lastUpdated={lastUpdated} />
    </div>
  );
}
