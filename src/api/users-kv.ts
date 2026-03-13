import { Hono } from 'hono';
import { kvUserStore } from '../store/kv-users';
import { mcpClient } from '../mcp/client';

const SE_TEAM_NAME = 'SEs';

export function createUsersRoutes() {
  const users = new Hono();

  // GET /api/users - Fetch all users (from cache or MCP)
  users.get('/', async (c) => {
    // Check if we need to refresh the cache
    const hasUsers = await kvUserStore.hasUsers();
    const isStale = await kvUserStore.isCacheStale();

    if (!hasUsers || isStale) {
      console.log('Fetching teams from Pylon MCP...');
      const result = await mcpClient.listTeams();

      if (!result.isError && result.content) {
        // Find the SEs team
        const seTeam = result.content.find(team => team.name === SE_TEAM_NAME);
        if (seTeam) {
          // Convert team members to user format
          const seTeamUsers = seTeam.users.map(member => {
            const namePart = member.email.split('@')[0];
            const capitalizedName = namePart.charAt(0).toUpperCase() + namePart.slice(1);
            return {
              id: member.id,
              email: member.email,
              name: capitalizedName,
            };
          });
          await kvUserStore.setUsers(seTeamUsers);
          console.log(`Cached ${seTeamUsers.length} SE team users from Pylon`);
        } else {
          console.warn('SEs team not found');
        }
      } else {
        console.warn('Failed to fetch teams from MCP:', result.errorMessage);
      }
    }

    const allUsers = await kvUserStore.getAllUsers();
    return c.json({ users: allUsers });
  });

  // POST /api/users/refresh - Force refresh the users cache
  users.post('/refresh', async (c) => {
    console.log('Force refreshing teams from Pylon MCP...');
    const result = await mcpClient.listTeams();

    if (!result.isError && result.content) {
      // Find the SEs team
      const seTeam = result.content.find(team => team.name === SE_TEAM_NAME);
      if (seTeam) {
        // Convert team members to user format
        const seTeamUsers = seTeam.users.map(member => {
          const namePart = member.email.split('@')[0];
          const capitalizedName = namePart.charAt(0).toUpperCase() + namePart.slice(1);
          return {
            id: member.id,
            email: member.email,
            name: capitalizedName,
          };
        });
        await kvUserStore.setUsers(seTeamUsers);
        console.log(`Refreshed: ${seTeamUsers.length} SE team users from Pylon`);
        return c.json({
          success: true,
          count: seTeamUsers.length,
          teamName: seTeam.name,
          users: seTeamUsers,
        });
      }

      return c.json({
        success: false,
        error: 'SEs team not found',
        availableTeams: result.content.map(t => t.name),
      }, 404);
    }

    return c.json({
      success: false,
      error: result.errorMessage || 'Failed to fetch teams',
    }, 500);
  });

  // GET /api/users/:id - Get a single user
  users.get('/:id', async (c) => {
    const id = c.req.param('id');
    const user = await kvUserStore.getUser(id);

    if (!user) {
      return c.json({ error: 'User not found' }, 404);
    }

    return c.json(user);
  });

  return users;
}
