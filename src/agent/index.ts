import Anthropic from '@anthropic-ai/sdk';
import type { PylonIssue, TriageResult, Priority, CustomerTier, Todo, CustomerResponseType } from '../types';
import type { PylonMCPIssue } from '../pylon/types';
import { mcpClient } from '../mcp/client';

// Global env storage for Workers compatibility
let globalEnv: Record<string, string | undefined> = {};
let anthropicClient: Anthropic | null = null;

export function setAgentEnv(env: Record<string, string | undefined>) {
  globalEnv = env;
  anthropicClient = null; // Reset client to pick up new key
}

function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    const apiKey = globalEnv.ANTHROPIC_API_KEY ||
                   (typeof process !== 'undefined' ? process.env?.ANTHROPIC_API_KEY : undefined);
    anthropicClient = new Anthropic({ apiKey });
  }
  return anthropicClient;
}

// Priority keywords for language analysis
const PRIORITY_KEYWORDS: Record<Priority, string[]> = {
  high: ['urgent', 'critical', 'down', 'broken', 'security', 'outage', 'emergency', 'asap', 'immediately', 'production'],
  medium: ['slow', 'error', 'not working', 'issue', 'problem', 'bug', 'incorrect', 'fails', 'unable'],
  low: ['how to', 'feature request', 'question', 'wondering', 'suggestion', 'would be nice', 'consider', 'documentation'],
};

// Customer tier priority multipliers
const TIER_MULTIPLIERS: Record<CustomerTier, number> = {
  enterprise: 1.2,  // +20%
  business: 1.1,    // +10%
  starter: 1.0,     // No adjustment
  free: 0.9,        // -10%
};

// Calculate base priority from text analysis
function analyzeTextPriority(text: string): { priority: Priority; confidence: number } {
  const lowerText = text.toLowerCase();

  let highScore = 0;
  let mediumScore = 0;
  let lowScore = 0;

  for (const keyword of PRIORITY_KEYWORDS.high) {
    if (lowerText.includes(keyword)) highScore++;
  }
  for (const keyword of PRIORITY_KEYWORDS.medium) {
    if (lowerText.includes(keyword)) mediumScore++;
  }
  for (const keyword of PRIORITY_KEYWORDS.low) {
    if (lowerText.includes(keyword)) lowScore++;
  }

  const total = highScore + mediumScore + lowScore;
  if (total === 0) {
    return { priority: 'medium', confidence: 0.5 };
  }

  if (highScore >= mediumScore && highScore >= lowScore) {
    return { priority: 'high', confidence: Math.min(0.9, 0.5 + highScore * 0.1) };
  }
  if (mediumScore >= lowScore) {
    return { priority: 'medium', confidence: Math.min(0.85, 0.5 + mediumScore * 0.1) };
  }
  return { priority: 'low', confidence: Math.min(0.85, 0.5 + lowScore * 0.1) };
}

// Apply customer tier weighting
function applyTierWeighting(
  basePriority: Priority,
  baseConfidence: number,
  tier?: CustomerTier
): { priority: Priority; confidence: number } {
  if (!tier) return { priority: basePriority, confidence: baseConfidence };

  const multiplier = TIER_MULTIPLIERS[tier];
  const priorityScore = { high: 3, medium: 2, low: 1 }[basePriority];
  const adjustedScore = priorityScore * multiplier;

  let newPriority: Priority;
  if (adjustedScore >= 2.8) {
    newPriority = 'high';
  } else if (adjustedScore >= 1.8) {
    newPriority = 'medium';
  } else {
    newPriority = 'low';
  }

  // Slightly reduce confidence if priority changed due to tier
  const confidenceAdjustment = newPriority !== basePriority ? 0.9 : 1;

  return {
    priority: newPriority,
    confidence: Math.min(0.95, baseConfidence * confidenceAdjustment),
  };
}

// Fetch additional context from MCP
async function fetchMCPContext(issue: PylonIssue): Promise<string> {
  const contextParts: string[] = [];

  try {
    // Fetch issue messages for additional context
    const [messagesResult, accountResult] = await Promise.all([
      mcpClient.getIssueMessages(issue.id),
      issue.accountId
        ? mcpClient.getAccount(issue.accountId)
        : Promise.resolve({ content: null, isError: true }),
    ]);

    if (!messagesResult.isError && messagesResult.content) {
      contextParts.push(`Message History: ${JSON.stringify(messagesResult.content)}`);
    }

    if (!accountResult.isError && accountResult.content) {
      contextParts.push(`Account Info: ${JSON.stringify(accountResult.content)}`);
    }
  } catch (error) {
    console.warn('MCP context fetch failed:', error);
    // Continue with available info
  }

  return contextParts.join('\n\n');
}

// Main triage function using Claude
export async function triageIssue(issue: PylonIssue): Promise<TriageResult> {
  // Pre-analyze with language heuristics
  const textContent = `${issue.title}\n${issue.description}`;
  const textAnalysis = analyzeTextPriority(textContent);
  const tierAdjusted = applyTierWeighting(
    textAnalysis.priority,
    textAnalysis.confidence,
    issue.customerTier
  );

  // Fetch MCP context (with timeout handling)
  const mcpContext = await fetchMCPContext(issue);

  const systemPrompt = `You are a customer support triage specialist. Your job is to analyze customer issues and provide:
1. A priority classification (high, medium, or low)
2. A confidence score (0-1) for your classification
3. A concise 2-3 sentence summary of the issue
4. An investigation outline with 3-5 action items

Priority Guidelines:
- HIGH: System outages, security issues, production blockers, data loss, critical bugs affecting many users
- MEDIUM: Functional bugs, performance issues, errors that have workarounds, significant user friction
- LOW: Feature requests, questions, minor UI issues, documentation requests

Consider the customer tier when assessing urgency:
- Enterprise customers: Business-critical issues should be elevated
- Business customers: Important but may have some flexibility
- Starter/Free: Standard prioritization

Respond in JSON format with this structure:
{
  "priority": "high" | "medium" | "low",
  "confidence": 0.0-1.0,
  "summary": "2-3 sentence summary",
  "investigationOutline": ["step 1", "step 2", ...]
}`;

  const userPrompt = `Analyze this customer issue:

Title: ${issue.title}
Description: ${issue.description}

Customer: ${issue.customerName || 'Unknown'} (${issue.customerEmail})
Customer Tier: ${issue.customerTier || 'Unknown'}
Source: ${issue.source || 'Unknown'}
Tags: ${issue.tags?.join(', ') || 'None'}
Created: ${issue.createdAt}

Initial Analysis:
- Text-based priority: ${tierAdjusted.priority} (confidence: ${Math.round(tierAdjusted.confidence * 100)}%)

${mcpContext ? `Additional Context:\n${mcpContext}` : ''}

Provide your triage assessment in JSON format.`;

  try {
    const response = await getAnthropicClient().messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [
        { role: 'user', content: userPrompt },
      ],
      system: systemPrompt,
    });

    // Extract text content
    const textBlock = response.content.find(block => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('No text response from Claude');
    }

    // Parse JSON response
    const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      priority: Priority;
      confidence: number;
      summary: string;
      investigationOutline: string[];
    };

    // Combine Claude's assessment with heuristic analysis
    const finalConfidence = (parsed.confidence + tierAdjusted.confidence) / 2;

    return {
      priority: parsed.priority,
      confidence: finalConfidence,
      summary: parsed.summary,
      investigationOutline: parsed.investigationOutline,
    };
  } catch (error) {
    console.error('Claude triage failed:', error);

    // Fallback to heuristic analysis
    return {
      priority: tierAdjusted.priority,
      confidence: tierAdjusted.confidence * 0.7, // Lower confidence for fallback
      summary: `Issue from ${issue.customerName || issue.customerEmail}: ${issue.title}`,
      investigationOutline: [
        'Review the issue description',
        'Check for related incidents',
        'Contact customer for more details if needed',
      ],
    };
  }
}

// Generate a to-do from an issue
export async function generateTodoFromIssue(issue: PylonIssue, triageResult: TriageResult): Promise<Todo> {
  const systemPrompt = `You are a task generation assistant. Given a customer issue and its triage assessment, generate a clear, actionable to-do item for the support team.

The to-do should include:
1. A concise title (max 10 words)
2. A brief description of what needs to be done
3. 3-5 specific steps to resolve or investigate the issue

Respond in JSON format:
{
  "title": "Brief task title",
  "description": "What needs to be done",
  "steps": ["Step 1", "Step 2", ...]
}`;

  const userPrompt = `Generate a to-do for this issue:

Title: ${issue.title}
Summary: ${triageResult.summary}
Priority: ${triageResult.priority}
Customer: ${issue.customerName || issue.customerEmail}
Customer Tier: ${issue.customerTier || 'Unknown'}

Investigation Outline:
${triageResult.investigationOutline.map((item, i) => `${i + 1}. ${item}`).join('\n')}`;

  try {
    const response = await getAnthropicClient().messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 512,
      messages: [
        { role: 'user', content: userPrompt },
      ],
      system: systemPrompt,
    });

    const textBlock = response.content.find(block => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('No text response from Claude');
    }

    const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      title: string;
      description: string;
      steps: string[];
    };

    // Get assignee from top-level or metadata (legacy data)
    const assignee = issue.assignee || (issue.metadata as { assignee?: typeof issue.assignee })?.assignee;

    return {
      id: `todo-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      issueId: issue.id,
      title: parsed.title,
      description: parsed.description,
      steps: parsed.steps,
      createdAt: new Date().toISOString(),
      completed: false,
      assignee,
    };
  } catch (error) {
    console.error('Todo generation failed:', error);

    // Get assignee from top-level or metadata (legacy data)
    const assignee = issue.assignee || (issue.metadata as { assignee?: typeof issue.assignee })?.assignee;

    // Fallback todo
    return {
      id: `todo-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      issueId: issue.id,
      title: `Investigate: ${issue.title.slice(0, 50)}`,
      description: triageResult.summary,
      steps: triageResult.investigationOutline,
      createdAt: new Date().toISOString(),
      completed: false,
      assignee,
    };
  }
}

// Interface for fresh issue context
interface FreshIssueContext {
  issue: PylonMCPIssue;
  messages: unknown;
  account: unknown | null;
}

// Fetch fresh issue context from MCP
async function fetchFreshIssueContext(issueId: string): Promise<FreshIssueContext> {
  const issueResult = await mcpClient.getIssue(issueId);
  if (issueResult.isError || !issueResult.content) {
    throw new Error(issueResult.errorMessage || 'Failed to fetch issue');
  }

  const issue = issueResult.content;

  // Fetch messages and account in parallel
  const [messagesResult, accountResult] = await Promise.all([
    mcpClient.getIssueMessages(issueId),
    issue.account?.id
      ? mcpClient.getAccount(issue.account.id)
      : Promise.resolve({ content: null, isError: false }),
  ]);

  return {
    issue,
    messages: messagesResult.isError ? null : messagesResult.content,
    account: accountResult.isError ? null : accountResult.content,
  };
}

// Format messages for display in prompt
function formatMessages(messages: unknown): string {
  if (!messages || !Array.isArray(messages)) {
    return 'No message history available';
  }

  return messages.map((msg: { body_text?: string; from?: { email?: string; name?: string }; created_at?: string }, i: number) => {
    const sender = msg.from?.name || msg.from?.email || 'Unknown';
    const timestamp = msg.created_at ? new Date(msg.created_at).toLocaleString() : '';
    const body = msg.body_text || '(no content)';
    return `[${i + 1}] ${sender} (${timestamp}):\n${body}`;
  }).join('\n\n---\n\n');
}

// Strip HTML tags from text
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Generate investigation prompt for Claude Code
export async function generateInvestigationPrompt(
  issueId: string,
  triageResult: TriageResult
): Promise<string> {
  // Fetch fresh context from MCP
  const context = await fetchFreshIssueContext(issueId);
  const { issue, messages } = context;

  const customerName = issue.requester?.name || issue.requester?.email || 'Unknown';
  const customerEmail = issue.requester?.email || 'Unknown';
  const accountName = issue.account?.name || 'Unknown';
  const description = stripHtml(issue.body_html || '');
  const formattedMessages = formatMessages(messages);

  const prompt = `I need to investigate a customer support issue for StackOne.

## Issue Details
- **Title:** ${issue.title}
- **Issue #:** ${issue.number}
- **Customer:** ${customerName} (${customerEmail})
- **Account:** ${accountName}
- **Created:** ${new Date(issue.created_at).toLocaleString()}
- **State:** ${issue.state}
${issue.tags?.length ? `- **Tags:** ${issue.tags.join(', ')}` : ''}

## Description
${description}

## Message Thread
${formattedMessages}

## Triage Summary
${triageResult.summary}

## Investigation Outline
${triageResult.investigationOutline.map((item, i) => `${i + 1}. ${item}`).join('\n')}

## Your Task
Investigate this issue in the codebase. Focus on:
1. Identifying the root cause
2. Finding relevant code paths
3. Suggesting potential fixes or workarounds

Start by exploring the areas suggested in the investigation outline.`;

  return prompt;
}

// Generate customer response
export async function generateCustomerResponse(
  issueId: string,
  triageResult: TriageResult
): Promise<{
  responseType: CustomerResponseType;
  reasoning: string;
  message: string;
  infoNeeded?: string[];
}> {
  // Fetch fresh context from MCP
  const context = await fetchFreshIssueContext(issueId);
  const { issue, messages, account } = context;

  const customerName = issue.requester?.name || issue.requester?.email?.split('@')[0] || 'there';
  const accountData = account as { tier?: string; name?: string } | null;
  const customerTier = accountData?.tier || 'standard';
  const description = stripHtml(issue.body_html || '');
  const formattedMessages = formatMessages(messages);

  const systemPrompt = `You are a Solutions Engineer at StackOne responding to a customer issue.

Analyze the issue and determine the appropriate response:
1. HOLDING - We have enough info to investigate, acknowledge and set expectations
2. REQUEST_INFO - We need more details before we can investigate
3. RESOLUTION - We can provide an immediate answer/solution

## Writing Style: BLUF (Bottom Line Up Front)

Lead with the answer or key point. Then provide supporting details. Be concise and direct.

## Style Guidelines
- NEVER repeat the customer's problem back to them - they know what they asked
- Keep responses short (2-5 sentences typical, longer only if explaining something technical)
- Be direct and helpful, not overly formal or apologetic
- Set clear expectations about what's possible and what isn't
- Provide specific next steps or actionable information
- Use conversational tone, not corporate speak
- It's OK to say "I'll look into this" without excessive pleasantries

## Formatting
- Use line breaks (\\n) between distinct thoughts or topics
- Each new point or step should be on its own line
- Don't write as a single wall of text
- Short responses (1-2 sentences) can be a single paragraph
- Longer responses MUST have line breaks between sections

## Example Responses (match this style and formatting):

Example 1 (Resolution with technical walkthrough - note the line breaks):
"For this specific issue, you can see what's happening directly in the StackOne dashboard logs.

If you head to the request logs here: https://app.stackone.com/request_logs - you can filter by account to inspect requests for a specific customer.

The batch response returns 202, which means the request payload itself passed validation. If you drill into Underlying Requests, you'll see the individual requests failed with a 500 error.

Going one level deeper, the root cause is: Unrecognised provider. This indicates a mismatch between the Learning Content Provider configured on the Account Linking page, and the provider configured in their SAP Learning Admin Hub.

Once those two are aligned, the upsert requests should process successfully."

Example 2 (Quick clarification - short, so single paragraph is fine):
"I believe we are talking about time off not time off balances. I will look into the Workday issue but at a glance this is a completely separate issue."

Example 3 (Setting expectations):
"In the instance where you were on our 'Accelerate' tier, this type of enhancement would be taken as a request for a connector extension, and delivered under a contractually guaranteed timeline.

Alternately, on our Grow plan, if we added this functionality unrelated to your request, it would become available to you at that point. Your route to doing this yourself would be via the Proxy endpoint."

Example 4 (Request for info - short):
"Can you explain a bit more about this? I'm struggling to see how your customer might be interacting with StackOne directly."

Example 5 (Direct answers - short):
"They are instant, subject slightly to webhook request backlogs, but they are not on a schedule."

Respond ONLY in valid JSON with this exact structure:
{
  "responseType": "holding" | "request_info" | "resolution",
  "reasoning": "Brief explanation of why you chose this response type",
  "message": "The actual message to send",
  "infoNeeded": ["item1", "item2"]
}

The "infoNeeded" field should only be included if responseType is "request_info".`;

  const userPrompt = `Analyze this customer issue and draft an appropriate response:

## Issue
Title: ${issue.title}
Description: ${description}

## Message Thread
${formattedMessages}

## Triage Summary
${triageResult.summary}

## Investigation Outline
${triageResult.investigationOutline.map((item, i) => `${i + 1}. ${item}`).join('\n')}

Draft a response in JSON format.`;

  try {
    const response = await getAnthropicClient().messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [
        { role: 'user', content: userPrompt },
      ],
      system: systemPrompt,
    });

    const textBlock = response.content.find(block => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('No text response from Claude');
    }

    const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      responseType: CustomerResponseType;
      reasoning: string;
      message: string;
      infoNeeded?: string[];
    };

    return {
      responseType: parsed.responseType,
      reasoning: parsed.reasoning,
      message: parsed.message,
      infoNeeded: parsed.infoNeeded,
    };
  } catch (error) {
    console.error('Customer response generation failed:', error);

    // Fallback response
    return {
      responseType: 'holding',
      reasoning: 'Automatic fallback due to generation error',
      message: `Hi ${customerName},\n\nThank you for reaching out. We've received your issue and our team is looking into it. We'll get back to you with an update soon.\n\nBest regards,\nStackOne Support`,
    };
  }
}
