import { Hono } from 'hono';
import { userStore } from '../store/users';
import { mcpClient } from '../mcp/client';

const SE_TEAM_NAME = 'SEs';

const users = new Hono();

// GET /api/users - Fetch all users (from cache or MCP)
users.get('/', async (c) => {
  // Check if we need to refresh the cache
  if (!userStore.hasUsers() || userStore.isCacheStale()) {
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
        userStore.setUsers(seTeamUsers);
        console.log(`Cached ${seTeamUsers.length} SE team users from Pylon`);
      } else {
        console.warn('SEs team not found');
      }
    } else {
      console.warn('Failed to fetch teams from MCP:', result.errorMessage);
    }
  }

  const allUsers = userStore.getAllUsers();
  return c.json({ users: allUsers });
});

// GET /api/users/:id - Get a single user
users.get('/:id', (c) => {
  const id = c.req.param('id');
  const user = userStore.getUser(id);

  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }

  return c.json(user);
});

export { users };
