import React from 'react';
import { createRoot } from 'react-dom/client';
import { useIssues } from './hooks/useIssues';
import { useTodos } from './hooks/useTodos';
import { Dashboard } from './components/Dashboard';
import type { Todo } from './types';

function App() {
  const { issues, stats, isLoading, lastUpdated, refetch } = useIssues();
  const {
    todos,
    addTodo,
    toggleTodo,
    deleteTodo,
    clearCompleted,
    pendingCount,
    completedCount,
  } = useTodos();

  const handleTodoGenerated = (todo: Todo) => {
    addTodo(todo);
  };

  const handleIssueDeleted = () => {
    refetch();
  };

  return (
    <>
      <header className="header">
        <h1>StackDash</h1>
        <div className="header-status">
          <span className="status-dot" />
          <span>Live • Polling every 5s</span>
        </div>
      </header>

      <Dashboard
        issues={issues}
        stats={stats}
        todos={todos}
        lastUpdated={lastUpdated}
        isLoading={isLoading}
        onTodoGenerated={handleTodoGenerated}
        onTodoToggle={toggleTodo}
        onTodoDelete={deleteTodo}
        onClearCompleted={clearCompleted}
        onIssueDeleted={handleIssueDeleted}
        pendingTodoCount={pendingCount}
        completedTodoCount={completedCount}
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
