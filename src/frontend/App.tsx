import React, { useState, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { useIssues } from './hooks/useIssues';
import { useTodos } from './hooks/useTodos';
import { Dashboard } from './components/Dashboard';
import { AssigneeFilter } from './components/AssigneeFilter';
import type { Todo, TriagedIssue, Assignee } from './types';

// Helper to get assignee from issue (checks both top-level and metadata)
function getIssueAssignee(issue: TriagedIssue): Assignee | undefined {
  const originalIssue = issue.originalIssue as typeof issue.originalIssue & { metadata?: { assignee?: Assignee } };
  return originalIssue.assignee || originalIssue.metadata?.assignee;
}

function App() {
  const { issues, stats, assignees, userMap, isLoading, lastUpdated, refetch } = useIssues();
  const {
    todos,
    addTodo,
    addTodos,
    toggleTodo,
    deleteTodo,
    updateTodo,
    createManualTodo,
    clearCompleted,
    reorderTodos,
    getSourceIds,
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
      return issues.filter(i => !getIssueAssignee(i));
    }
    return issues.filter(i => getIssueAssignee(i)?.id === selectedAssignee);
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

  const handleImportMeetingActions = async (
    userEmail: string,
    userName: string,
    options: { days?: number; limit?: number }
  ): Promise<{ added: number; skipped: number; message: string }> => {
    const existingSourceIds = getSourceIds();
    const response = await fetch('/api/meetings/import-actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ existingSourceIds, userEmail, userName, ...options }),
    });

    const data = await response.json() as {
      success?: boolean;
      todos?: Todo[];
      skippedDuplicates?: string[];
      message?: string;
      error?: string;
    };

    if (!response.ok || !data.success) {
      throw new Error(data.error || 'Failed to import meeting actions');
    }

    if (data.todos && data.todos.length > 0) {
      addTodos(data.todos);
    }

    return {
      added: data.todos?.length || 0,
      skipped: data.skippedDuplicates?.length || 0,
      message: data.message || '',
    };
  };

  // Get the selected assignee object for passing to components
  const selectedAssigneeObj = useMemo(() => {
    if (!selectedAssignee || selectedAssignee === 'unassigned') return null;
    return assignees.find(a => a.id === selectedAssignee) || null;
  }, [selectedAssignee, assignees]);

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
        selectedAssignee={selectedAssigneeObj}
        onTodoGenerated={handleTodoGenerated}
        onTodoToggle={toggleTodo}
        onTodoDelete={deleteTodo}
        onTodoUpdate={updateTodo}
        onTodoCreateManual={createManualTodo}
        onClearCompleted={clearCompleted}
        onTodoReorder={reorderTodos}
        onIssueDeleted={handleIssueDeleted}
        onImportMeetingActions={handleImportMeetingActions}
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
