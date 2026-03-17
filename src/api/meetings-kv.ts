import { Hono } from 'hono';
import { mcpClient } from '../mcp/client';
import { d1UserStore } from '../store/d1-users';
import { extractMeetingActions, meetingActionsToTodos } from '../agent';
import type { Todo, Assignee } from '../types';

// Module-level env storage for Cloudflare Workers
let meetingsEnv: { STACKONE_FIREFLIES_ACCOUNT_ID?: string } = {};

export function setMeetingsEnv(env: { STACKONE_FIREFLIES_ACCOUNT_ID?: string }) {
  meetingsEnv = env;
}

// Get Fireflies account ID from env
function getFirefliesAccountId(): string {
  return meetingsEnv.STACKONE_FIREFLIES_ACCOUNT_ID || '';
}

export function createMeetingsRoutes() {
  const meetings = new Hono();

  // POST /api/meetings/import-actions - Import action items from recent meetings for a specific user
  meetings.post('/import-actions', async (c) => {
    const firefliesAccountId = getFirefliesAccountId();
    if (!firefliesAccountId) {
      return c.json({ error: 'Fireflies account ID not configured' }, 500);
    }

    // Get parameters from request body
    const body = await c.req.json().catch(() => ({})) as {
      existingSourceIds?: string[];
      userEmail?: string;
      userName?: string;
      days?: number;
      limit?: number;
    };
    const existingSourceIds = new Set(body.existingSourceIds || []);
    const userEmail = body.userEmail;
    const userName = body.userName;
    const days = body.days || 7; // Default to 7 days
    const limit = body.limit || 10; // Default to 10 meetings

    if (!userEmail || !userName) {
      return c.json({ error: 'userEmail and userName are required' }, 400);
    }

    try {
      // Calculate date range
      const fromDateObj = new Date();
      fromDateObj.setDate(fromDateObj.getDate() - days);
      const fromDate = fromDateObj.toISOString().split('T')[0];

      console.log(`Fetching Fireflies transcripts for ${userEmail} from ${fromDate} (limit: ${limit})...`);
      const transcriptsResult = await mcpClient.listFirefliesTranscripts(
        firefliesAccountId,
        { limit, fromDate, userEmail }
      );

      if (transcriptsResult.isError || !transcriptsResult.content) {
        const debugInfo = mcpClient.getLastRequestDebug();
        console.error('Failed to fetch transcripts:', transcriptsResult.errorMessage);
        console.error('Debug info:', JSON.stringify(debugInfo, null, 2));
        return c.json({
          error: transcriptsResult.errorMessage || 'Failed to fetch transcripts',
          debug: debugInfo,
        }, 500);
      }

      let transcripts = transcriptsResult.content;
      console.log(`Found ${transcripts.length} transcripts for ${userEmail} (before date filter)`);

      // Client-side filtering as fallback (in case Fireflies API ignores from_date)
      const fromDateMidnight = new Date(fromDate + 'T00:00:00.000Z').getTime();
      transcripts = transcripts.filter(t => {
        if (!t.date) return true;
        return t.date >= fromDateMidnight;
      });
      console.log(`After date filtering: ${transcripts.length} transcripts within ${days} day(s)`);

      if (transcripts.length === 0) {
        return c.json({
          success: true,
          todos: [],
          message: `No recent meetings found for ${userName}`,
        });
      }

      // Fetch summaries and extract actions for each transcript
      const allTodos: Todo[] = [];
      const processedMeetings: string[] = [];
      const skippedDuplicates: string[] = [];

      // Get all users for the userMap (for assignee lookup)
      const users = await d1UserStore.getAllUsers();
      const userMap = new Map<string, Assignee>();
      for (const user of users) {
        userMap.set(user.id, user);
      }

      // Only look for actions assigned to this specific user
      const targetNames = [userName];

      for (const transcript of transcripts) {
        try {
          console.log(`Processing meeting: ${transcript.title} (${transcript.id})`);

          // Fetch the meeting summary
          const summaryResult = await mcpClient.getFirefliesMeetingSummary(
            firefliesAccountId,
            transcript.id
          );

          if (summaryResult.isError || !summaryResult.content) {
            console.warn(`Failed to get summary for ${transcript.title}:`, summaryResult.errorMessage);
            continue;
          }

          console.log(`Got summary for ${transcript.title}, extracting actions for: ${userName}`);

          // Extract action items mentioning this user
          const actions = await extractMeetingActions(
            transcript,
            summaryResult.content,
            targetNames
          );

          console.log(`Found ${actions.length} actions for ${userName} in ${transcript.title}`);

          if (actions.length > 0) {
            // Convert to todos
            const todos = meetingActionsToTodos(actions, userMap);

            // Filter out duplicates based on sourceId
            const newTodos = todos.filter(todo => {
              if (todo.sourceId && existingSourceIds.has(todo.sourceId)) {
                skippedDuplicates.push(todo.title);
                return false;
              }
              return true;
            });

            allTodos.push(...newTodos);
            processedMeetings.push(transcript.title);
          }
        } catch (err) {
          console.error(`Error processing meeting ${transcript.title}:`, err);
        }
      }

      return c.json({
        success: true,
        todos: allTodos,
        processedMeetings,
        skippedDuplicates,
        message: allTodos.length > 0
          ? `Found ${allTodos.length} action items for ${userName} from ${processedMeetings.length} meetings`
          : `No action items found for ${userName}`,
      });
    } catch (error) {
      console.error('Meeting import failed:', error);
      return c.json({
        error: error instanceof Error ? error.message : 'Unknown error',
      }, 500);
    }
  });

  // GET /api/meetings/recent - List recent meetings (for debugging/preview)
  meetings.get('/recent', async (c) => {
    const firefliesAccountId = getFirefliesAccountId();
    if (!firefliesAccountId) {
      return c.json({ error: 'Fireflies account ID not configured' }, 500);
    }

    try {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const fromDate = sevenDaysAgo.toISOString().split('T')[0];

      const result = await mcpClient.listFirefliesTranscripts(
        firefliesAccountId,
        { limit: 10, fromDate }
      );

      if (result.isError) {
        return c.json({ error: result.errorMessage }, 500);
      }

      return c.json({
        meetings: result.content?.map(t => ({
          id: t.id,
          title: t.title,
          date: t.dateString || t.date,
          duration: t.duration,
          speakers: t.speakers?.map(s => s.name),
          participants: t.participants, // email addresses
        })),
      });
    } catch (error) {
      return c.json({
        error: error instanceof Error ? error.message : 'Unknown error',
      }, 500);
    }
  });

  return meetings;
}
