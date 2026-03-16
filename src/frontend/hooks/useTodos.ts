import { useState, useEffect, useCallback } from 'react';
import type { Todo } from '../types';

const STORAGE_KEY = 'stackdash_todos';

interface UseTodosReturn {
  todos: Todo[];
  addTodo: (todo: Todo) => void;
  addTodos: (todos: Todo[]) => void;
  toggleTodo: (id: string) => void;
  deleteTodo: (id: string) => void;
  updateTodo: (id: string, updates: Partial<Todo>) => void;
  createManualTodo: (title: string, description?: string, steps?: string[]) => void;
  clearCompleted: () => void;
  reorderTodos: (draggedId: string, targetId: string) => void;
  getSourceIds: () => string[];
  pendingCount: number;
  completedCount: number;
}

function loadTodos(): Todo[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    return JSON.parse(stored) as Todo[];
  } catch {
    return [];
  }
}

function saveTodos(todos: Todo[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(todos));
  } catch (err) {
    console.error('Failed to save todos:', err);
  }
}

export function useTodos(): UseTodosReturn {
  const [todos, setTodos] = useState<Todo[]>(() => loadTodos());

  // Persist to localStorage whenever todos change
  useEffect(() => {
    saveTodos(todos);
  }, [todos]);

  const addTodo = useCallback((todo: Todo) => {
    setTodos(prev => {
      // Check for duplicate by id or sourceId
      if (prev.some(t => t.id === todo.id || (todo.sourceId && t.sourceId === todo.sourceId))) {
        return prev;
      }
      return [todo, ...prev];
    });
  }, []);

  const addTodos = useCallback((newTodos: Todo[]) => {
    setTodos(prev => {
      const existingIds = new Set(prev.map(t => t.id));
      const existingSourceIds = new Set(prev.map(t => t.sourceId).filter(Boolean));

      // Filter out duplicates
      const uniqueNewTodos = newTodos.filter(todo =>
        !existingIds.has(todo.id) &&
        !(todo.sourceId && existingSourceIds.has(todo.sourceId))
      );

      if (uniqueNewTodos.length === 0) return prev;
      return [...uniqueNewTodos, ...prev];
    });
  }, []);

  const getSourceIds = useCallback(() => {
    return todos.map(t => t.sourceId).filter((id): id is string => !!id);
  }, [todos]);

  const toggleTodo = useCallback((id: string) => {
    setTodos(prev =>
      prev.map(todo =>
        todo.id === id
          ? {
              ...todo,
              completed: !todo.completed,
              completedAt: !todo.completed ? new Date().toISOString() : undefined,
            }
          : todo
      )
    );
  }, []);

  const deleteTodo = useCallback((id: string) => {
    setTodos(prev => prev.filter(todo => todo.id !== id));
  }, []);

  const updateTodo = useCallback((id: string, updates: Partial<Todo>) => {
    setTodos(prev =>
      prev.map(todo =>
        todo.id === id ? { ...todo, ...updates } : todo
      )
    );
  }, []);

  const createManualTodo = useCallback((title: string, description?: string, steps?: string[]) => {
    const newTodo: Todo = {
      id: `manual-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      issueId: 'manual',
      title,
      description: description || '',
      steps: steps || [],
      createdAt: new Date().toISOString(),
      completed: false,
    };
    setTodos(prev => [newTodo, ...prev]);
  }, []);

  const clearCompleted = useCallback(() => {
    setTodos(prev => prev.filter(todo => !todo.completed));
  }, []);

  const reorderTodos = useCallback((draggedId: string, targetId: string) => {
    if (draggedId === targetId) return;
    setTodos(prev => {
      const draggedIndex = prev.findIndex(t => t.id === draggedId);
      const targetIndex = prev.findIndex(t => t.id === targetId);
      if (draggedIndex === -1 || targetIndex === -1) return prev;

      const result = [...prev];
      const [removed] = result.splice(draggedIndex, 1);
      result.splice(targetIndex, 0, removed);
      return result;
    });
  }, []);

  const pendingCount = todos.filter(t => !t.completed).length;
  const completedCount = todos.filter(t => t.completed).length;

  return {
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
  };
}
