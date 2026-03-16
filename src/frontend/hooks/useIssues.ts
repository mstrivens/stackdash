import { useState, useEffect, useCallback, useMemo } from 'react';
import type {
  TriagedIssue,
  DashboardStats,
  IssuesResponse,
  Assignee,
  GeneratePromptResponse,
  GenerateCustomerResponseResponse,
} from '../types';

const POLL_INTERVAL = 5000; // 5 seconds

interface UseIssuesReturn {
  issues: TriagedIssue[];
  stats: DashboardStats;
  assignees: Assignee[];
  userMap: Map<string, Assignee>;
  isLoading: boolean;
  error: string | null;
  lastUpdated: string | null;
  refetch: () => Promise<void>;
}

const defaultStats: DashboardStats = {
  totalIssues: 0,
  highPriorityCount: 0,
  mediumPriorityCount: 0,
  lowPriorityCount: 0,
  pendingTriageCount: 0,
  failedTriageCount: 0,
  avgTriageTime: 0,
  recentActivityCount: 0,
};

export function useIssues(): UseIssuesReturn {
  const [issues, setIssues] = useState<TriagedIssue[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [users, setUsers] = useState<Assignee[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  // Create a map of user ID -> user data for quick lookup
  const userMap = useMemo(() => {
    const map = new Map<string, Assignee>();
    for (const user of users) {
      map.set(user.id, user);
    }
    return map;
  }, [users]);

  // Use all users from the API as assignees (already filtered to SE team on backend)
  const assignees = useMemo(() => {
    return [...users].sort((a, b) => {
      const nameA = a.name || a.email || '';
      const nameB = b.name || b.email || '';
      return nameA.localeCompare(nameB);
    });
  }, [users]);

  // Fetch issues only (for polling)
  const fetchIssues = useCallback(async () => {
    try {
      const response = await fetch('/api/issues');

      if (!response.ok) {
        throw new Error(`Failed to fetch issues: ${response.status}`);
      }

      const data: IssuesResponse = await response.json();
      setIssues(data.issues);
      setStats(data.stats);
      setLastUpdated(data.lastUpdated);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Fetch users once on mount (static data)
  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const response = await fetch('/api/users');
        if (response.ok) {
          const data = await response.json();
          setUsers(data.users || []);
        }
      } catch (err) {
        console.error('Failed to fetch users:', err);
      }
    };
    fetchUsers();
  }, []);

  // Initial issues fetch
  useEffect(() => {
    fetchIssues();
  }, [fetchIssues]);

  // Poll issues only (not users)
  useEffect(() => {
    const interval = setInterval(fetchIssues, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchIssues]);

  return {
    issues,
    stats: stats || defaultStats,
    assignees,
    userMap,
    isLoading,
    error,
    lastUpdated,
    refetch: fetchIssues,
  };
}

// Delete an issue
export async function deleteIssue(issueId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(`/api/issues/${issueId}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      const data = await response.json();
      return { success: false, error: data.error || 'Failed to delete issue' };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

// Generate todo from issue
export async function generateTodo(issueId: string): Promise<{ todo: any; error?: string }> {
  try {
    const response = await fetch('/api/todos/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issueId }),
    });

    if (!response.ok) {
      const data = await response.json();
      return { todo: null, error: data.error || 'Failed to generate todo' };
    }

    const data = await response.json();
    return { todo: data.todo };
  } catch (err) {
    return { todo: null, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

// Generate investigation prompt for Claude Code
export async function generatePrompt(issueId: string): Promise<GeneratePromptResponse & { error?: string }> {
  try {
    const response = await fetch('/api/generate/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issueId }),
    });

    if (!response.ok) {
      const data = await response.json();
      return { prompt: '', issueTitle: '', error: data.error || 'Failed to generate prompt' };
    }

    const data: GeneratePromptResponse = await response.json();
    return data;
  } catch (err) {
    return { prompt: '', issueTitle: '', error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

// Generate customer response
export async function generateCustomerResponse(
  issueId: string
): Promise<GenerateCustomerResponseResponse & { error?: string }> {
  try {
    const response = await fetch('/api/generate/response', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issueId }),
    });

    if (!response.ok) {
      const data = await response.json();
      return {
        responseType: 'holding',
        reasoning: '',
        message: '',
        error: data.error || 'Failed to generate response',
      };
    }

    const data: GenerateCustomerResponseResponse = await response.json();
    return data;
  } catch (err) {
    return {
      responseType: 'holding',
      reasoning: '',
      message: '',
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}
