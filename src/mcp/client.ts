import type { MCPToolCall, MCPToolResult } from '../types';
import type { PylonMCPIssue, PylonUser, PylonTeam } from '../pylon/types';

// MCP JSON-RPC response structure
interface MCPResponse {
  jsonrpc: '2.0';
  id: number;
  result?: {
    content?: Array<{ type: string; text: string }>;
    structuredContent?: {
      isError: boolean;
      result: unknown;
    };
    isError?: boolean;
  };
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

// Available MCP tools for StackOne Pylon
export const MCP_TOOLS = {
  GET_ISSUE: 'pylon_get_issue',
  GET_ISSUE_MESSAGES: 'pylon_get_issue_messages',
  LIST_ISSUES: 'pylon_list_issues',
  SEARCH_ISSUES: 'pylon_search_issues',
  GET_ACCOUNT: 'pylon_get_account',
  LIST_ACCOUNTS: 'pylon_list_accounts',
  LIST_USERS: 'pylon_list_users',
  LIST_TEAMS: 'pylon_list_teams',
} as const;

// Available MCP tools for Fireflies
export const FIREFLIES_TOOLS = {
  LIST_TRANSCRIPTS: 'fireflies_list_transcripts',
  GET_TRANSCRIPT: 'fireflies_get_transcript',
  GET_MEETING_SUMMARY: 'fireflies_get_meeting_summary',
  SEARCH_MEETINGS: 'fireflies_search_meetings',
} as const;

// Fireflies transcript type (from list endpoint)
export interface FirefliesTranscript {
  id: string;
  title: string;
  date?: number; // timestamp in ms
  dateString?: string;
  duration?: number;
  host_email?: string | null;
  organizer_email?: string;
  meeting_link?: string;
  speakers?: Array<{ id: number; name: string }>;
  participants?: string[]; // email addresses
  fireflies_users?: string[];
}

// Fireflies meeting summary type (from get_meeting_summary endpoint)
export interface FirefliesMeetingSummary {
  id: string;
  title: string;
  date?: number;
  summary: {
    action_items?: string; // Markdown-formatted string with action items by person
    keywords?: string[];
    outline?: string | null;
    shorthand_bullet?: string;
    overview?: string;
    bullet_gist?: string;
    gist?: string;
    short_summary?: string;
  };
}

let requestId = 0;

// Global env storage for Workers compatibility
let globalEnv: Record<string, string | undefined> = {};

export function setMCPEnv(env: Record<string, string | undefined>) {
  globalEnv = env;
}

export class StackOneMCPClient {
  private baseUrl: string = '';
  private apiKey: string = '';
  private accountId: string = '';
  private timeout: number = 10000;
  private initialized: boolean = false;

  constructor(options?: {
    baseUrl?: string;
    apiKey?: string;
    accountId?: string;
    timeout?: number;
  }) {
    if (options?.apiKey) {
      this.initialize(options);
    }
  }

  private initialize(options?: {
    baseUrl?: string;
    apiKey?: string;
    accountId?: string;
    timeout?: number;
  }) {
    const env = globalEnv.STACKONE_API_KEY ? globalEnv :
                (typeof process !== 'undefined' ? process.env : {});
    this.baseUrl = options?.baseUrl || env.STACKONE_MCP_URL || 'https://api.stackone.com/mcp';
    this.apiKey = options?.apiKey || env.STACKONE_API_KEY || '';
    this.accountId = options?.accountId || env.STACKONE_ACCOUNT_ID || '';
    this.timeout = options?.timeout || 10000;
    this.initialized = true;
  }

  private ensureInitialized() {
    if (!this.initialized) {
      this.initialize();
    }
  }

  private getAuthHeader(): string {
    // StackOne uses Basic auth with API key as username
    const credentials = `${this.apiKey}:`;
    // Use btoa for Workers compatibility (Buffer not available)
    return `Basic ${btoa(credentials)}`;
  }

  private lastRequestDebug: { headers: Record<string, string>; status?: number; responseText?: string } | null = null;

  getLastRequestDebug() {
    return this.lastRequestDebug;
  }

  private async sendRequest(method: string, params?: Record<string, unknown>): Promise<MCPResponse> {
    this.ensureInitialized();
    const request = {
      jsonrpc: '2.0' as const,
      id: ++requestId,
      method,
      params,
    };

    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'Authorization': this.getAuthHeader(),
      'x-account-id': this.accountId,
      'User-Agent': 'StackDash/1.0 (Cloudflare Worker)',
    };

    this.lastRequestDebug = { headers: { ...headers, Authorization: headers.Authorization.substring(0, 20) + '...' } };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      this.lastRequestDebug.status = response.status;

      if (!response.ok) {
        this.lastRequestDebug.responseText = await response.text();
        throw new Error(`MCP request failed: ${response.status} ${response.statusText}`);
      }

      return await response.json() as MCPResponse;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`MCP request timed out after ${this.timeout}ms`);
      }
      throw error;
    }
  }

  private parseResult(response: MCPResponse): MCPToolResult {
    if (response.error) {
      return {
        content: null,
        isError: true,
        errorMessage: response.error.message,
      };
    }

    // Handle structured content format from StackOne MCP
    if (response.result?.structuredContent) {
      const { isError, result } = response.result.structuredContent;
      if (isError) {
        const errorResult = result as { error?: string };
        return {
          content: null,
          isError: true,
          errorMessage: errorResult?.error || 'Unknown MCP error',
        };
      }
      // Extract data from result - handle nested data.data structure
      const outerData = result as { data?: { data?: unknown } };
      const content = outerData?.data?.data || outerData?.data || result;
      return {
        content,
        isError: false,
      };
    }

    // Handle text content format
    if (response.result?.content?.[0]?.text) {
      try {
        const parsed = JSON.parse(response.result.content[0].text);
        if (parsed.isError) {
          return {
            content: null,
            isError: true,
            errorMessage: parsed.result?.error || 'Unknown error',
          };
        }
        // Handle nested data.data structure
        const outerData = parsed.result?.data;
        const content = outerData?.data || outerData || parsed.result;
        return {
          content,
          isError: false,
        };
      } catch {
        return {
          content: response.result.content[0].text,
          isError: false,
        };
      }
    }

    return {
      content: response.result,
      isError: false,
    };
  }

  async callTool(toolCall: MCPToolCall): Promise<MCPToolResult> {
    try {
      const response = await this.sendRequest('tools/call', {
        name: toolCall.name,
        arguments: toolCall.arguments,
      });

      return this.parseResult(response);
    } catch (error) {
      return {
        content: null,
        isError: true,
        errorMessage: error instanceof Error ? error.message : 'Unknown MCP error',
      };
    }
  }

  async getIssue(issueId: string): Promise<MCPToolResult & { content: PylonMCPIssue | null }> {
    const result = await this.callTool({
      name: MCP_TOOLS.GET_ISSUE,
      arguments: {
        path: { id: issueId },
      },
    });

    return result as MCPToolResult & { content: PylonMCPIssue | null };
  }

  // Debug: get current config
  getDebugInfo() {
    this.ensureInitialized();
    return {
      baseUrl: this.baseUrl,
      hasApiKey: !!this.apiKey,
      apiKeyPrefix: this.apiKey?.substring(0, 10),
      accountId: this.accountId,
      initialized: this.initialized,
    };
  }

  async getIssueMessages(issueId: string): Promise<MCPToolResult> {
    return this.callTool({
      name: MCP_TOOLS.GET_ISSUE_MESSAGES,
      arguments: {
        path: { id: issueId },
      },
    });
  }

  async getAccount(accountId: string): Promise<MCPToolResult> {
    return this.callTool({
      name: MCP_TOOLS.GET_ACCOUNT,
      arguments: {
        path: { id: accountId },
      },
    });
  }

  async searchIssues(filter: {
    field: string;
    operator: string;
    value?: string;
    values?: string[];
  }): Promise<MCPToolResult> {
    return this.callTool({
      name: MCP_TOOLS.SEARCH_ISSUES,
      arguments: {
        body: { filter },
      },
    });
  }

  async listTools(): Promise<string[]> {
    try {
      const response = await this.sendRequest('tools/list');
      if (response.error) {
        console.error('Failed to list MCP tools:', response.error.message);
        return [];
      }
      const result = response.result as { tools?: Array<{ name: string }> };
      return result?.tools?.map(t => t.name) || [];
    } catch (error) {
      console.error('Failed to list MCP tools:', error);
      return [];
    }
  }

  async listUsers(): Promise<MCPToolResult & { content: PylonUser[] | null }> {
    const result = await this.callTool({
      name: MCP_TOOLS.LIST_USERS,
      arguments: {},
    });

    // Handle array response from MCP
    if (!result.isError && Array.isArray(result.content)) {
      return { ...result, content: result.content as PylonUser[] };
    }

    return result as MCPToolResult & { content: PylonUser[] | null };
  }

  async listTeams(): Promise<MCPToolResult & { content: PylonTeam[] | null }> {
    const result = await this.callTool({
      name: MCP_TOOLS.LIST_TEAMS,
      arguments: {},
    });

    // Handle array response from MCP
    if (!result.isError && Array.isArray(result.content)) {
      return { ...result, content: result.content as PylonTeam[] };
    }

    return result as MCPToolResult & { content: PylonTeam[] | null };
  }

  // Call a tool with a different account ID (for Fireflies, etc.)
  async callToolWithAccount(toolCall: MCPToolCall, accountId: string): Promise<MCPToolResult> {
    const originalAccountId = this.accountId;
    this.accountId = accountId;
    try {
      return await this.callTool(toolCall);
    } finally {
      this.accountId = originalAccountId;
    }
  }

  // Fireflies: List recent transcripts
  async listFirefliesTranscripts(
    accountId: string,
    options?: { limit?: number; fromDate?: string; toDate?: string; userEmail?: string }
  ): Promise<MCPToolResult & { content: FirefliesTranscript[] | null }> {
    // Arguments need to be wrapped in 'query' for list endpoints
    const query: Record<string, unknown> = {};
    if (options?.limit) query.limit = options.limit;
    if (options?.fromDate) query.from_date = options.fromDate;
    if (options?.toDate) query.to_date = options.toDate;
    if (options?.userEmail) query.user_email = options.userEmail;

    const result = await this.callToolWithAccount(
      { name: FIREFLIES_TOOLS.LIST_TRANSCRIPTS, arguments: { query } },
      accountId
    );

    if (!result.isError && Array.isArray(result.content)) {
      return { ...result, content: result.content as FirefliesTranscript[] };
    }

    return result as MCPToolResult & { content: FirefliesTranscript[] | null };
  }

  // Fireflies: Get meeting summary with action items
  async getFirefliesMeetingSummary(
    accountId: string,
    transcriptId: string
  ): Promise<MCPToolResult & { content: FirefliesMeetingSummary | null }> {
    // Arguments need to be wrapped in 'body' with transcriptId
    const result = await this.callToolWithAccount(
      {
        name: FIREFLIES_TOOLS.GET_MEETING_SUMMARY,
        arguments: { body: { transcriptId } },
      },
      accountId
    );

    return result as MCPToolResult & { content: FirefliesMeetingSummary | null };
  }

  // Fireflies: Get full transcript
  async getFirefliesTranscript(
    accountId: string,
    transcriptId: string
  ): Promise<MCPToolResult & { content: FirefliesTranscript | null }> {
    // Arguments need to be wrapped in 'body' with transcriptId
    const result = await this.callToolWithAccount(
      {
        name: FIREFLIES_TOOLS.GET_TRANSCRIPT,
        arguments: { body: { transcriptId } },
      },
      accountId
    );

    return result as MCPToolResult & { content: FirefliesTranscript | null };
  }
}

// Singleton instance (for Bun local dev)
export const mcpClient = new StackOneMCPClient();

// Factory for creating client with env bindings (for Cloudflare Workers)
export function createMCPClient(env: {
  STACKONE_API_KEY?: string;
  STACKONE_ACCOUNT_ID?: string;
  STACKONE_MCP_URL?: string;
}): StackOneMCPClient {
  return new StackOneMCPClient({
    apiKey: env.STACKONE_API_KEY,
    accountId: env.STACKONE_ACCOUNT_ID,
    baseUrl: env.STACKONE_MCP_URL,
  });
}
