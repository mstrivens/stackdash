import React, { useState } from 'react';
import type { Todo, Assignee } from '../types';
import { TodoCard } from './TodoCard';

interface TodoColumnProps {
  todos: Todo[];
  userMap: Map<string, Assignee>;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onUpdate?: (id: string, updates: Partial<Todo>) => void;
  onCreateManual?: (title: string, description?: string, steps?: string[]) => void;
  onClearCompleted: () => void;
  pendingCount: number;
  completedCount: number;
}

export function TodoColumn({
  todos,
  userMap,
  onToggle,
  onDelete,
  onUpdate,
  onCreateManual,
  onClearCompleted,
  pendingCount,
  completedCount,
}: TodoColumnProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newSteps, setNewSteps] = useState<string[]>([]);

  const handleCreate = () => {
    if (onCreateManual && newTitle.trim()) {
      onCreateManual(
        newTitle.trim(),
        newDescription.trim() || undefined,
        newSteps.filter(s => s.trim() !== '')
      );
      resetForm();
    }
  };

  const handleCancel = () => {
    resetForm();
  };

  const resetForm = () => {
    setNewTitle('');
    setNewDescription('');
    setNewSteps([]);
    setIsCreating(false);
  };

  const handleAddStep = () => {
    setNewSteps([...newSteps, '']);
  };

  const handleRemoveStep = (index: number) => {
    setNewSteps(newSteps.filter((_, i) => i !== index));
  };

  const handleStepChange = (index: number, value: string) => {
    const updated = [...newSteps];
    updated[index] = value;
    setNewSteps(updated);
  };

  return (
    <div className="column">
      <div className="column-header">
        <h2 className="column-title">To-Do List</h2>
        <div className="column-header-actions">
          <span className="column-count">{pendingCount} pending</span>
          {onCreateManual && !isCreating && (
            <button
              className="btn btn-primary btn-sm"
              onClick={() => setIsCreating(true)}
            >
              + Add
            </button>
          )}
          {completedCount > 0 && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={onClearCompleted}
            >
              Clear done
            </button>
          )}
        </div>
      </div>
      <div className="column-content">
        {isCreating && (
          <div className="todo-add-form">
            <div className="todo-edit-field">
              <label>Title *</label>
              <input
                type="text"
                className="todo-input"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="What needs to be done?"
                autoFocus
              />
            </div>

            <div className="todo-edit-field">
              <label>Description</label>
              <textarea
                className="todo-textarea"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="Add details (optional)"
                rows={2}
              />
            </div>

            <div className="todo-edit-field">
              <label>Steps</label>
              <div className="todo-steps-edit">
                {newSteps.map((step, index) => (
                  <div key={index} className="todo-step-input-row">
                    <input
                      type="text"
                      className="todo-step-input"
                      value={step}
                      onChange={(e) => handleStepChange(index, e.target.value)}
                      placeholder={`Step ${index + 1}`}
                    />
                    <button
                      type="button"
                      className="todo-step-remove"
                      onClick={() => handleRemoveStep(index)}
                      title="Remove step"
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="todo-add-step-btn"
                  onClick={handleAddStep}
                >
                  + Add step
                </button>
              </div>
            </div>

            <div className="todo-edit-actions">
              <button
                className="btn btn-primary"
                onClick={handleCreate}
                disabled={!newTitle.trim()}
              >
                Create
              </button>
              <button className="btn btn-secondary" onClick={handleCancel}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {todos.length === 0 && !isCreating ? (
          <div className="empty-state">
            <div className="empty-state-icon">✓</div>
            <p className="empty-state-text">
              No to-dos yet. Click "+ Add" to create one, or click "Create To-Do" on an issue.
            </p>
          </div>
        ) : (
          todos.map((todo) => (
            <TodoCard
              key={todo.id}
              todo={todo}
              userMap={userMap}
              onToggle={() => onToggle(todo.id)}
              onDelete={() => onDelete(todo.id)}
              onUpdate={onUpdate ? (updates) => onUpdate(todo.id, updates) : undefined}
            />
          ))
        )}
      </div>
    </div>
  );
}
