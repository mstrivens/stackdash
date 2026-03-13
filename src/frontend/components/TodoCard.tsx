import React from 'react';
import type { Todo } from '../types';

interface TodoCardProps {
  todo: Todo;
  onToggle: () => void;
  onDelete: () => void;
}

export function TodoCard({ todo, onToggle, onDelete }: TodoCardProps) {
  return (
    <div className={`todo-card ${todo.completed ? 'completed' : ''}`}>
      <div className="todo-header">
        <div
          className={`todo-checkbox ${todo.completed ? 'checked' : ''}`}
          onClick={onToggle}
          role="checkbox"
          aria-checked={todo.completed}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onToggle();
            }
          }}
        />
        <span className={`todo-title ${todo.completed ? 'completed' : ''}`}>
          {todo.title}
        </span>
        <button className="todo-delete" onClick={onDelete} title="Delete to-do">
          ×
        </button>
      </div>

      {!todo.completed && (
        <>
          <p className="todo-description">{todo.description}</p>
          {todo.steps.length > 0 && (
            <ul className="todo-steps">
              {todo.steps.map((step, index) => (
                <li key={index} className="todo-step">
                  {step}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
