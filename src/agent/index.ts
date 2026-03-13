import Anthropic from '@anthropic-ai/sdk';
import type { PylonIssue, TriageResult, Priority, CustomerTier, Todo } from '../types';
import { mcpClient, MCP_TOOLS } from '../mcp/client';

const anthropic = new Anthropic();

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
    const response = await anthropic.messages.create({
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
    const response = await anthropic.messages.create({
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

    return {
      id: `todo-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      issueId: issue.id,
      title: parsed.title,
      description: parsed.description,
      steps: parsed.steps,
      createdAt: new Date().toISOString(),
      completed: false,
    };
  } catch (error) {
    console.error('Todo generation failed:', error);

    // Fallback todo
    return {
      id: `todo-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      issueId: issue.id,
      title: `Investigate: ${issue.title.slice(0, 50)}`,
      description: triageResult.summary,
      steps: triageResult.investigationOutline,
      createdAt: new Date().toISOString(),
      completed: false,
    };
  }
}
