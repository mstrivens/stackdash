import React from 'react';
import type { TriagedIssue, Todo } from '../types';
import { IssueCard } from './IssueCard';

interface IssueColumnProps {
  title: string;
  issues: TriagedIssue[];
  onTodoGenerated: (todo: Todo) => void;
  onIssueDeleted: (issueId: string) => void;
  emptyMessage?: string;
}

export function IssueColumn({
  title,
  issues,
  onTodoGenerated,
  onIssueDeleted,
  emptyMessage = 'No issues',
}: IssueColumnProps) {
  return (
    <div className="column">
      <div className="column-header">
        <h2 className="column-title">{title}</h2>
        <span className="column-count">{issues.length}</span>
      </div>
      <div className="column-content">
        {issues.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📭</div>
            <p className="empty-state-text">{emptyMessage}</p>
          </div>
        ) : (
          issues.map((issue) => (
            <IssueCard
              key={issue.id}
              issue={issue}
              onTodoGenerated={onTodoGenerated}
              onDeleted={onIssueDeleted}
            />
          ))
        )}
      </div>
    </div>
  );
}
