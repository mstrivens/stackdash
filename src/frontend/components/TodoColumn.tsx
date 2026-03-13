import React from 'react';
import type { Todo } from '../types';
import { TodoCard } from './TodoCard';

interface TodoColumnProps {
  todos: Todo[];
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onClearCompleted: () => void;
  pendingCount: number;
  completedCount: number;
}

export function TodoColumn({
  todos,
  onToggle,
  onDelete,
  onClearCompleted,
  pendingCount,
  completedCount,
}: TodoColumnProps) {
  return (
    <div className="column">
      <div className="column-header">
        <h2 className="column-title">To-Do List</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span className="column-count">{pendingCount} pending</span>
          {completedCount > 0 && (
            <button
              className="btn"
              style={{
                background: 'transparent',
                color: 'var(--text-muted)',
                padding: '0.25rem 0.5rem',
              }}
              onClick={onClearCompleted}
            >
              Clear done
            </button>
          )}
        </div>
      </div>
      <div className="column-content">
        {todos.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">✓</div>
            <p className="empty-state-text">
              No to-dos yet. Click "Create To-Do" on an issue to get started.
            </p>
          </div>
        ) : (
          todos.map((todo) => (
            <TodoCard
              key={todo.id}
              todo={todo}
              onToggle={() => onToggle(todo.id)}
              onDelete={() => onDelete(todo.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}
