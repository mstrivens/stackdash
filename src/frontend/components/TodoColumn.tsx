import React, { useState } from 'react';
import type { Todo, Assignee } from '../types';
import { TodoCard } from './TodoCard';

interface TodoColumnProps {
  todos: Todo[];
  userMap: Map<string, Assignee>;
  selectedAssignee: Assignee | null;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onUpdate?: (id: string, updates: Partial<Todo>) => void;
  onCreateManual?: (title: string, description?: string, steps?: string[]) => void;
  onClearCompleted: () => void;
  onReorder: (draggedId: string, targetId: string) => void;
  onImportMeetingActions?: (userEmail: string, userName: string, options: { days?: number; limit?: number }) => Promise<{ added: number; skipped: number; message: string }>;
  pendingCount: number;
  completedCount: number;
}

export function TodoColumn({
  todos,
  userMap,
  selectedAssignee,
  onToggle,
  onDelete,
  onUpdate,
  onCreateManual,
  onClearCompleted,
  onReorder,
  onImportMeetingActions,
  pendingCount,
  completedCount,
}: TodoColumnProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newSteps, setNewSteps] = useState<string[]>([]);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ added: number; skipped: number; message: string } | null>(null);
  const [importRange, setImportRange] = useState<string>('3-days');

  const handleDragStart = (id: string) => {
    setDraggedId(id);
  };

  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    if (id !== draggedId) {
      setDragOverId(id);
    }
  };

  const handleDragLeave = () => {
    setDragOverId(null);
  };

  const handleDrop = (targetId: string) => {
    if (draggedId && draggedId !== targetId) {
      onReorder(draggedId, targetId);
    }
    setDraggedId(null);
    setDragOverId(null);
  };

  const handleDragEnd = () => {
    setDraggedId(null);
    setDragOverId(null);
  };

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

  const handleImportMeetings = async () => {
    if (!onImportMeetingActions || isImporting || !selectedAssignee?.email || !selectedAssignee?.name) return;

    setIsImporting(true);
    setImportResult(null);

    // Parse the import range
    const [value, type] = importRange.split('-');
    const options = type === 'days'
      ? { days: parseInt(value, 10) }
      : { limit: parseInt(value, 10) };

    try {
      const result = await onImportMeetingActions(selectedAssignee.email, selectedAssignee.name, options);
      setImportResult(result);
      // Clear the result message after 5 seconds
      setTimeout(() => setImportResult(null), 5000);
    } catch (err) {
      setImportResult({
        added: 0,
        skipped: 0,
        message: err instanceof Error ? err.message : 'Import failed',
      });
      setTimeout(() => setImportResult(null), 5000);
    } finally {
      setIsImporting(false);
    }
  };

  // Only show import button when a specific user with email is selected
  const canImportMeetings = onImportMeetingActions && selectedAssignee?.email && selectedAssignee?.name;

  return (
    <div className="column">
      <div className="column-header">
        <h2 className="column-title">To-Do List</h2>
        <div className="column-header-actions">
          <span className="column-count">{pendingCount} pending</span>
          {canImportMeetings && (
            <div className="import-btn-group">
              <button
                className="import-btn-main"
                onClick={handleImportMeetings}
                disabled={isImporting}
                title={`Import action items from ${selectedAssignee?.name}'s recent meetings`}
              >
                {isImporting ? 'Importing...' : 'Import Meetings'}
              </button>
              <select
                className="import-btn-select"
                value={importRange}
                onChange={(e) => setImportRange(e.target.value)}
                disabled={isImporting}
              >
                <option value="1-days">1d</option>
                <option value="3-days">3d</option>
                <option value="7-days">7d</option>
              </select>
            </div>
          )}
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
      {importResult && (
        <div className={`import-result ${importResult.added > 0 ? 'import-success' : 'import-info'}`}>
          {importResult.message}
          {importResult.skipped > 0 && ` (${importResult.skipped} duplicates skipped)`}
        </div>
      )}
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
              isDragging={draggedId === todo.id}
              isDragOver={dragOverId === todo.id}
              onDragStart={() => handleDragStart(todo.id)}
              onDragOver={(e) => handleDragOver(e, todo.id)}
              onDragLeave={handleDragLeave}
              onDrop={() => handleDrop(todo.id)}
              onDragEnd={handleDragEnd}
            />
          ))
        )}
      </div>
    </div>
  );
}
