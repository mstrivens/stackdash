import type { MCPToolCall, MCPToolResult } from '../types';
import type { PylonMCPIssue } from '../pylon/types';

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
} as const;

let requestId = 0;

export class StackOneMCPClient {
  private baseUrl: string;
  private apiKey: string;
  private accountId: string;
  private timeout: number;

  constructor(options?: {
    baseUrl?: string;
    apiKey?: string;
    accountId?: string;
    timeout?: number;
  }) {
    this.baseUrl = options?.baseUrl || process.env.STACKONE_MCP_URL || 'https://api.stackone.com/mcp';
    this.apiKey = options?.apiKey || process.env.STACKONE_API_KEY || '';
    this.accountId = options?.accountId || process.env.STACKONE_ACCOUNT_ID || '';
    this.timeout = options?.timeout || 10000; // 10s default timeout
  }

  private getAuthHeader(): string {
    // StackOne uses Basic auth with API key as username
    const credentials = `${this.apiKey}:`;
    return `Basic ${Buffer.from(credentials).toString('base64')}`;
  }

  private async sendRequest(method: string, params?: Record<string, unknown>): Promise<MCPResponse> {
    const request = {
      jsonrpc: '2.0' as const,
      id: ++requestId,
      method,
      params,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'Authorization': this.getAuthHeader(),
          'x-account-id': this.accountId,
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
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
}

// Singleton instance
export const mcpClient = new StackOneMCPClient();
