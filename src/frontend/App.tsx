import React, { useState, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { useIssues } from './hooks/useIssues';
import { useTodos } from './hooks/useTodos';
import { Dashboard } from './components/Dashboard';
import { AssigneeFilter } from './components/AssigneeFilter';
import type { Todo } from './types';

function App() {
  const { issues, stats, assignees, userMap, isLoading, lastUpdated, refetch } = useIssues();
  const {
    todos,
    addTodo,
    toggleTodo,
    deleteTodo,
    updateTodo,
    createManualTodo,
    clearCompleted,
    pendingCount,
    completedCount,
  } = useTodos();

  const [selectedAssignee, setSelectedAssignee] = useState<string | null>(null);

  // Filter issues based on selected assignee
  const filteredIssues = useMemo(() => {
    if (selectedAssignee === null) {
      return issues;
    }
    if (selectedAssignee === 'unassigned') {
      return issues.filter(i => !i.originalIssue.assignee);
    }
    return issues.filter(i => i.originalIssue.assignee?.id === selectedAssignee);
  }, [issues, selectedAssignee]);

  // Filter todos based on selected assignee (by matching issue assignee)
  const filteredTodos = useMemo(() => {
    if (selectedAssignee === null) {
      return todos;
    }
    // Find issues that match the filter to get their IDs
    const filteredIssueIds = new Set(filteredIssues.map(i => i.id));
    return todos.filter(t => filteredIssueIds.has(t.issueId) || t.assignee?.id === selectedAssignee);
  }, [todos, selectedAssignee, filteredIssues]);

  const handleTodoGenerated = (todo: Todo) => {
    addTodo(todo);
  };

  const handleIssueDeleted = () => {
    refetch();
  };

  const selectedAssigneeName = useMemo(() => {
    if (selectedAssignee === null) return null;
    if (selectedAssignee === 'unassigned') return 'Unassigned';
    const assignee = assignees.find(a => a.id === selectedAssignee);
    return assignee?.name || assignee?.email || 'Unknown';
  }, [selectedAssignee, assignees]);

  return (
    <>
      <header className="header">
        <h1>StackDash</h1>
        <div className="header-controls">
          <AssigneeFilter
            assignees={assignees}
            selectedAssignee={selectedAssignee}
            onFilterChange={setSelectedAssignee}
          />
          <div className="header-status">
            <span className="status-dot" />
            <span>Live</span>
          </div>
        </div>
      </header>
      {selectedAssignee && (
        <div className="filter-banner">
          Viewing: <strong>{selectedAssigneeName}</strong>
          <button className="filter-clear" onClick={() => setSelectedAssignee(null)}>
            Clear filter
          </button>
        </div>
      )}

      <Dashboard
        issues={filteredIssues}
        stats={stats}
        todos={filteredTodos}
        lastUpdated={lastUpdated}
        isLoading={isLoading}
        userMap={userMap}
        onTodoGenerated={handleTodoGenerated}
        onTodoToggle={toggleTodo}
        onTodoDelete={deleteTodo}
        onTodoUpdate={updateTodo}
        onTodoCreateManual={createManualTodo}
        onClearCompleted={clearCompleted}
        onIssueDeleted={handleIssueDeleted}
        pendingTodoCount={filteredTodos.filter(t => !t.completed).length}
        completedTodoCount={filteredTodos.filter(t => t.completed).length}
      />
    </>
  );
}

// Mount the app
const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
