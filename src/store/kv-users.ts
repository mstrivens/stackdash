import type { Assignee } from '../types';

// Global KV reference (set per-request in worker)
let kvNamespace: KVNamespace | null = null;

export function setUsersKVNamespace(kv: KVNamespace) {
  kvNamespace = kv;
}

const USERS_KEY = 'users';

interface StoredUsersData {
  users: Record<string, Assignee>;
  lastUpdated: string;
}

async function getData(): Promise<StoredUsersData> {
  if (!kvNamespace) {
    return { users: {}, lastUpdated: '' };
  }
  const data = await kvNamespace.get(USERS_KEY, 'json') as StoredUsersData | null;
  return data || { users: {}, lastUpdated: '' };
}

async function saveData(data: StoredUsersData): Promise<void> {
  if (!kvNamespace) return;
  await kvNamespace.put(USERS_KEY, JSON.stringify(data));
}

export const kvUserStore = {
  async setUsers(users: Array<{ id: string; name?: string; email?: string }>): Promise<void> {
    const data: StoredUsersData = {
      users: {},
      lastUpdated: new Date().toISOString(),
    };

    for (const user of users) {
      data.users[user.id] = {
        id: user.id,
        name: user.name,
        email: user.email,
      };
    }

    await saveData(data);
  },

  async getUser(userId: string): Promise<Assignee | undefined> {
    const data = await getData();
    return data.users[userId];
  },

  async getAllUsers(): Promise<Assignee[]> {
    const data = await getData();
    return Object.values(data.users).sort((a, b) => {
      const nameA = a.name || a.email || '';
      const nameB = b.name || b.email || '';
      return nameA.localeCompare(nameB);
    });
  },

  async hasUsers(): Promise<boolean> {
    const data = await getData();
    return Object.keys(data.users).length > 0;
  },

  async isCacheStale(): Promise<boolean> {
    const data = await getData();
    if (!data.lastUpdated) return true;
    const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
    return Date.now() - new Date(data.lastUpdated).getTime() > CACHE_TTL_MS;
  },

  async enrichAssignee(assignee: { id: string; name?: string; email?: string }): Promise<Assignee> {
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
