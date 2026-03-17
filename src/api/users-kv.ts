import { Hono } from 'hono';
import { d1UserStore } from '../store/d1-users';
import { mcpClient } from '../mcp/client';

const SE_TEAM_NAME = 'SEs';

// Pylon AI agent - hardcoded since it's not returned by the users API
const PYLON_AI_AGENT = {
  id: '9b76d9de-6c32-4176-9654-b463094e626d',
  email: 'ai-agent@pylon.com',
  name: 'Pylon AI',
};

function formatNameFromEmail(email: string): string {
  const namePart = email.split('@')[0];
  return namePart
    .split('.')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function createUsersRoutes() {
  const users = new Hono();

  // GET /api/users - Fetch SE team members only (plus Pylon AI agent)
  users.get('/', async (c) => {
    // Check if we need to refresh the cache
    const hasUsers = await d1UserStore.hasUsers();
    const isStale = await d1UserStore.isCacheStale();

    if (!hasUsers || isStale) {
      const teamsResult = await mcpClient.listTeams();

      const usersMap = new Map<string, { id: string; email: string; name: string }>();

      // Only include SE team members
      if (!teamsResult.isError && teamsResult.content) {
        const seTeam = teamsResult.content.find(team => team.name === SE_TEAM_NAME);
        if (seTeam) {
          for (const member of seTeam.users) {
            usersMap.set(member.id, {
              id: member.id,
              email: member.email,
              name: formatNameFromEmail(member.email),
            });
          }
        }
      }

      // Add Pylon AI agent (for name lookup when issues are initially assigned to it)
      usersMap.set(PYLON_AI_AGENT.id, PYLON_AI_AGENT);

      if (usersMap.size > 0) {
        await d1UserStore.setUsers(Array.from(usersMap.values()));
      }
    }

    const allUsers = await d1UserStore.getAllUsers();
    return c.json({ users: allUsers });
  });

  // POST /api/users/refresh - Force refresh the users cache
  users.post('/refresh', async (c) => {
    const teamsResult = await mcpClient.listTeams();

    const usersMap = new Map<string, { id: string; email: string; name: string }>();

    // Only include SE team members
    if (!teamsResult.isError && teamsResult.content) {
      const seTeam = teamsResult.content.find(team => team.name === SE_TEAM_NAME);
      if (seTeam) {
        for (const member of seTeam.users) {
          usersMap.set(member.id, {
            id: member.id,
            email: member.email,
            name: formatNameFromEmail(member.email),
          });
        }
      }
    }

    // Add Pylon AI agent (for name lookup)
    usersMap.set(PYLON_AI_AGENT.id, PYLON_AI_AGENT);

    if (usersMap.size > 0) {
      const allUsers = Array.from(usersMap.values());
      await d1UserStore.setUsers(allUsers);
      return c.json({
        success: true,
        count: usersMap.size,
        users: allUsers,
      });
    }

    return c.json({
      success: false,
      error: 'No SE team members found from MCP',
    }, 500);
  });

  // GET /api/users/:id - Get a single user
  users.get('/:id', async (c) => {
    const id = c.req.param('id');
    const user = await d1UserStore.getUser(id);

    if (!user) {
      return c.json({ error: 'User not found' }, 404);
    }

    return c.json(user);
  });

  return users;
}
