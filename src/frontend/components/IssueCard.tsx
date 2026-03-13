import React, { useState } from 'react';
import type { TriagedIssue, Todo } from '../types';
import { generateTodo, deleteIssue } from '../hooks/useIssues';

interface IssueCardProps {
  issue: TriagedIssue;
  onTodoGenerated: (todo: Todo) => void;
  onDeleted: (issueId: string) => void;
}

export function IssueCard({ issue, onTodoGenerated, onDeleted }: IssueCardProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    if (isDeleting) return;

    setIsDeleting(true);
    const { success, error } = await deleteIssue(issue.id);
    setIsDeleting(false);

    if (success) {
      onDeleted(issue.id);
    } else {
      console.error('Failed to delete issue:', error);
    }
  };

  const handleCreateTodo = async () => {
    if (isGenerating || issue.status !== 'triaged') return;

    setIsGenerating(true);
    const { todo, error } = await generateTodo(issue.id);
    setIsGenerating(false);

    if (todo) {
      onTodoGenerated(todo);
    } else {
      console.error('Failed to generate todo:', error);
    }
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const isPending = issue.status === 'pending' || issue.status === 'triaging';
  const pylonLink = issue.originalIssue.pylonLink;
  const issueNumber = issue.originalIssue.issueNumber;

  return (
    <div className={`issue-card ${isPending ? 'pending' : issue.priority}`}>
      <div className="issue-card-header">
        <span className="issue-title">
          {pylonLink ? (
            <a
              href={pylonLink}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: 'inherit',
                textDecoration: 'none',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.textDecoration = 'underline')}
              onMouseLeave={(e) => (e.currentTarget.style.textDecoration = 'none')}
            >
              {issueNumber ? `#${issueNumber} ` : ''}{issue.originalIssue.title}
            </a>
          ) : (
            issue.originalIssue.title
          )}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {!isPending && (
            <span className={`priority-badge ${issue.priority}`}>
              {issue.priority}
            </span>
          )}
          {isPending && (
            <span className="priority-badge" style={{ background: 'rgba(100, 116, 139, 0.2)', color: '#64748b' }}>
              {issue.status === 'triaging' ? 'Analyzing...' : 'Pending'}
            </span>
          )}
          <button
            className="todo-delete"
            onClick={handleDelete}
            disabled={isDeleting}
            title="Remove issue"
            style={{ opacity: 1 }}
          >
            {isDeleting ? '...' : '×'}
          </button>
        </div>
      </div>

      {issue.summary ? (
        <p className="issue-summary">{issue.summary}</p>
      ) : (
        <p className="issue-summary" style={{ fontStyle: 'italic' }}>
          {issue.originalIssue.description.slice(0, 100)}
          {issue.originalIssue.description.length > 100 ? '...' : ''}
        </p>
      )}

      <div className="issue-meta">
        <span>
          {issue.originalIssue.accountName ||
           issue.originalIssue.customerName ||
           issue.originalIssue.customerEmail ||
           'Unknown'}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {issue.originalIssue.customerTier && (
            <span className="customer-tier">{issue.originalIssue.customerTier}</span>
          )}
          {issue.originalIssue.source && (
            <span className="customer-tier">{issue.originalIssue.source}</span>
          )}
          <span>{formatTime(issue.originalIssue.createdAt)}</span>
        </div>
      </div>

      {issue.status === 'triaged' && (
        <div className="issue-actions">
          <button
            className="btn btn-primary"
            onClick={handleCreateTodo}
            disabled={isGenerating}
          >
            {isGenerating ? (
              <>
                <span className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} />
                Creating...
              </>
            ) : (
              '+ Create To-Do'
            )}
          </button>
          {pylonLink && (
            <a
              href={pylonLink}
              target="_blank"
              rel="noopener noreferrer"
              className="btn"
              style={{
                marginLeft: '0.5rem',
                background: 'var(--bg-secondary)',
                color: 'var(--text-secondary)',
                textDecoration: 'none',
              }}
            >
              View in Pylon
            </a>
          )}
        </div>
      )}

      {issue.status === 'failed' && (
        <div className="issue-actions">
          <span style={{ color: '#ef4444', fontSize: '0.75rem' }}>
            Triage failed: {issue.errorMessage}
          </span>
        </div>
      )}
    </div>
  );
}
