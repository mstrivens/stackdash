import type { Assignee } from '../types';
import { mcpClient } from '../mcp/client';

// Global D1 reference (set per-request in worker)
let db: D1Database | null = null;

const SE_TEAM_NAME = 'SEs';
const USERS_CACHE_KEY = 'users_last_updated';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export function setUsersD1Database(database: D1Database) {
  db = database;
}

interface UserRow {
  id: string;
  name: string | null;
  email: string | null;
  updated_at: string;
}

interface MetadataRow {
  key: string;
  value: string;
  updated_at: string;
}

export const d1UserStore = {
  async setUsers(users: Array<{ id: string; name?: string; email?: string }>): Promise<void> {
    if (!db) return;

    // Use a batch to insert all users
    const statements = users.map(user =>
      db!.prepare(`
        INSERT OR REPLACE INTO users (id, name, email, updated_at)
        VALUES (?, ?, ?, datetime('now'))
      `).bind(user.id, user.name || null, user.email || null)
    );

    // Also update the metadata timestamp
    statements.push(
      db.prepare(`
        INSERT OR REPLACE INTO metadata (key, value, updated_at)
        VALUES (?, ?, datetime('now'))
      `).bind(USERS_CACHE_KEY, new Date().toISOString())
    );

    await db.batch(statements);
  },

  async getUser(userId: string): Promise<Assignee | undefined> {
    if (!db) return undefined;

    const result = await db.prepare(`
      SELECT * FROM users WHERE id = ?
    `).bind(userId).first<UserRow>();

    if (!result) return undefined;

    return {
      id: result.id,
      name: result.name || undefined,
      email: result.email || undefined,
    };
  },

  async getAllUsers(): Promise<Assignee[]> {
    if (!db) return [];

    const result = await db.prepare(`
      SELECT * FROM users ORDER BY COALESCE(name, email, '') ASC
    `).all<UserRow>();

    return (result.results || []).map(row => ({
      id: row.id,
      name: row.name || undefined,
      email: row.email || undefined,
    }));
  },

  async hasUsers(): Promise<boolean> {
    if (!db) return false;

    const result = await db.prepare(`
      SELECT COUNT(*) as count FROM users
    `).first<{ count: number }>();

    return (result?.count || 0) > 0;
  },

  async isCacheStale(): Promise<boolean> {
    if (!db) return true;

    const result = await db.prepare(`
      SELECT value FROM metadata WHERE key = ?
    `).bind(USERS_CACHE_KEY).first<MetadataRow>();

    if (!result?.value) return true;

    const lastUpdated = new Date(result.value).getTime();
    return Date.now() - lastUpdated > CACHE_TTL_MS;
  },

  async ensureUsersLoaded(): Promise<void> {
    const hasUsers = await this.hasUsers();
    const isStale = await this.isCacheStale();

    if (!hasUsers || isStale) {
      const [teamsResult, usersResult] = await Promise.all([
        mcpClient.listTeams(),
        mcpClient.listUsers(),
      ]);

      const usersMap = new Map<string, { id: string; email: string; name: string }>();

      // Add all users from listUsers
      if (!usersResult.isError && usersResult.content) {
        for (const user of usersResult.content) {
          if (user.id && user.email) {
            const namePart = user.email.split('@')[0];
            const capitalizedName = namePart.charAt(0).toUpperCase() + namePart.slice(1);
            usersMap.set(user.id, {
              id: user.id,
              email: user.email,
              name: user.name || capitalizedName,
            });
          }
        }
      }

      // Override with SE team members
      if (!teamsResult.isError && teamsResult.content) {
        const seTeam = teamsResult.content.find(team => team.name === SE_TEAM_NAME);
        if (seTeam) {
          for (const member of seTeam.users) {
            const namePart = member.email.split('@')[0];
            const capitalizedName = namePart.charAt(0).toUpperCase() + namePart.slice(1);
            usersMap.set(member.id, {
              id: member.id,
              email: member.email,
              name: capitalizedName,
            });
          }
        }
      }

      if (usersMap.size > 0) {
        await this.setUsers(Array.from(usersMap.values()));
      }
    }
  },

  async enrichAssignee(assignee: { id: string; name?: string; email?: string }): Promise<Assignee> {
    // Ensure users are loaded before trying to enrich
    await this.ensureUsersLoaded();

    const cachedUser = await this.getUser(assignee.id);
    if (cachedUser) {
      return {
        id: assignee.id,
        name: assignee.name || cachedUser.name,
        email: assignee.email || cachedUser.email,
      };
    }
    return assignee;
  },
};
