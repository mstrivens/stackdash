import type { Assignee } from '../types';

class UserStore {
  private users: Map<string, Assignee> = new Map();
  private lastFetched: number = 0;

  // Set users from MCP response
  setUsers(users: Array<{ id: string; name?: string; email?: string }>): void {
    this.users.clear();
    for (const user of users) {
      this.users.set(user.id, {
        id: user.id,
        name: user.name,
        email: user.email,
      });
    }
    this.lastFetched = Date.now();
  }

  // Get a user by ID
  getUser(userId: string): Assignee | undefined {
    return this.users.get(userId);
  }

  // Get all users
  getAllUsers(): Assignee[] {
    return Array.from(this.users.values()).sort((a, b) => {
      const nameA = a.name || a.email || '';
      const nameB = b.name || b.email || '';
      return nameA.localeCompare(nameB);
    });
  }

  // Check if we have users cached
  hasUsers(): boolean {
    return this.users.size > 0;
  }

  // Check if cache is stale (older than 5 minutes)
  isCacheStale(): boolean {
    const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
    return Date.now() - this.lastFetched > CACHE_TTL_MS;
  }

  // Enrich an assignee with full user data
  enrichAssignee(assignee: { id: string; name?: string; email?: string }): Assignee {
    const cachedUser = this.users.get(assignee.id);
    if (cachedUser) {
      return {
        id: assignee.id,
        name: assignee.name || cachedUser.name,
        email: assignee.email || cachedUser.email,
      };
    }
    return assignee;
  }

  // Clear the store
  clear(): void {
    this.users.clear();
    this.lastFetched = 0;
  }
}

// Singleton instance
export const userStore = new UserStore();
