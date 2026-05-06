const config = require('./config');
const OpenAI = require('openai');

const aiClient = config.ai.apiKey
  ? new OpenAI({
      apiKey: config.ai.apiKey,
      baseURL: config.ai.baseURL,
    })
  : null;

const SYSTEM_PROMPT = `You are a moderation assistant that analyzes chat messages for toxicity and misinformation.

For each message you must respond with a JSON object containing exactly these fields:
- toxicity_score: number between 0 and 1 (0 = not toxic, 1 = highly toxic). Consider insults, hate speech, threats, harassment.
- claim_detected: boolean. True if the message makes a factual claim about the world (events, statistics, causes, claims about people or organizations), false for opinions, questions, greetings, or casual chat.
- misinformation_risk: number between 0 and 1 (0 = low risk, 1 = high risk of being false/misleading). Only meaningful when claim_detected is true; otherwise use 0.
- truth_score: number between 0 and 100 (0 = likely false, 100 = likely true). Only meaningful when claim_detected is true; for non-claims use 50 (neutral).
- explanation: string. One short sentence explaining the scores (e.g. "Claim lacks supporting evidence and conflicts with trusted sources." or "No factual claim; casual conversation.").

Respond only with valid JSON, no markdown or extra text.`;

const SUMMARY_SYSTEM_PROMPT = `You summarize article discussions for readers.

Always respond in English only.

Output format:
SUMMARY: 2-4 sentences about what people discussed in the chat.
HIGHLIGHTS:
- short point
- short point

Rules:
- Focus on what the chat participants discussed, not a generic summary of the article.
- If the discussion is sparse, say that clearly.
- Mention disagreement or uncertainty when relevant.
- Do not invent facts that are not present in the messages.
- Keep the tone neutral and concise.
- Provide 2 to 4 highlight bullets.`;

function safeJsonParse(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function sanitizeHighlights(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .slice(0, 4);
}

function parseSummaryResponse(raw) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) {
    return {
      summary: 'The discussion summary could not be generated.',
      highlights: [],
    };
  }

  const summaryMatch = text.match(/SUMMARY:\s*([\s\S]*?)(?:\nHIGHLIGHTS:|$)/i);
  const highlightsMatch = text.match(/HIGHLIGHTS:\s*([\s\S]*)$/i);

  const summary = summaryMatch?.[1]?.trim()
    ? summaryMatch[1].trim()
    : text.split(/\n+/).slice(0, 2).join(' ').trim() || 'The discussion summary could not be generated.';

  const highlights = highlightsMatch?.[1]
    ? highlightsMatch[1]
        .split('\n')
        .map((line) => line.replace(/^\s*[-*]\s*/, '').trim())
        .filter(Boolean)
        .slice(0, 4)
    : [];

  return { summary, highlights };
}

/**
 * Call AI moderation service to analyze a message before broadcast.
 * Returns { toxicity_score, claim_detected, misinformation_risk, truth_score, explanation }
 * or null if moderation is disabled or the service is unavailable.
 */
async function analyzeMessage(message) {
  if (!aiClient) {
    console.warn('[moderation] AI API key not configured, skipping moderation.');
    return null;
  }

  const userContent =
    typeof message === 'string' ? message : message?.message ?? message?.body ?? String(message);
    
  if (!userContent.trim()) {
    return {
      toxicity_score: 0,
      claim_detected: false,
      misinformation_risk: 0,
      truth_score: 50,
      explanation: 'Empty or whitespace-only message.',
    };
  }

  try {
    const response = await aiClient.chat.completions.create({
      model: config.ai.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Analyze this chat message:\n\n"${userContent.replace(/"/g, '\\"')}"` },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_tokens: 300,
    });

    const raw = response.choices?.[0]?.message?.content?.trim();
    if (!raw) {
      console.warn('[moderation] Empty response from AI provider');
      return null;
    }

    const parsed = JSON.parse(raw);
    const clamp = (n, min, max) => Math.min(max, Math.max(min, Number(n) || 0));
    
    return {
      toxicity_score: clamp(parsed.toxicity_score, 0, 1),
      claim_detected: Boolean(parsed.claim_detected),
      misinformation_risk: clamp(parsed.misinformation_risk, 0, 1),
      truth_score: Math.round(clamp(parsed.truth_score, 0, 100)),
      explanation: typeof parsed.explanation === 'string' ? parsed.explanation.trim() : 'No explanation.',
    };
  } catch (err) {
    console.warn('[moderation] AI moderation failed:', err.message);
    return null;
  }
}

async function summarizeArticleDiscussion({ articleTitle, articleBody, messages }) {
  if (!aiClient) {
    throw new Error('AI API key not configured');
  }

  const normalizedMessages = Array.isArray(messages)
    ? messages
        .filter((message) => message && (message.body || message.attachment_url))
        .slice(-40)
        .map((message, index) => {
          const text = typeof message.body === 'string' ? message.body.trim() : '';
          const attachment = message.attachment_url ? ' [attachment shared]' : '';
          return `${index + 1}. ${text || '(no text)'}${attachment}`;
        })
    : [];

  if (normalizedMessages.length === 0) {
    return {
      summary: 'No discussion has happened yet for this article.',
      highlights: [],
    };
  }

  const response = await aiClient.chat.completions.create({
    model: config.ai.model,
    messages: [
      { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          `Article title: ${articleTitle || 'Untitled article'}`,
          '',
          'Article context:',
          (articleBody || '').slice(0, 2000) || 'No article body provided.',
          '',
          'Recent chat messages:',
          normalizedMessages.join('\n'),
        ].join('\n'),
      },
    ],
    temperature: 0.3,
    max_tokens: 400,
  });

  const raw = response.choices?.[0]?.message?.content?.trim();
  if (!raw) {
    throw new Error('Empty response from AI provider');
  }

  const parsed = parseSummaryResponse(raw);

  return {
    summary: parsed.summary,
    highlights: sanitizeHighlights(parsed.highlights),
  };
}

/**
 * Whether to block broadcast when misinformation risk is above threshold.
 * When true and analyzeMessage returns misinformation_risk >= threshold, the message is not broadcast.
 */
function shouldBlockForMisinformation(analysis, threshold) {
  if (!analysis || threshold == null || threshold < 0) return false;
  return Number(analysis.misinformation_risk) >= Number(threshold);
}

/**
 * Whether to block broadcast when toxicity is above threshold.
 */
function shouldBlockForToxicity(analysis, threshold) {
  if (!analysis || threshold == null || threshold < 0) return false;
  return Number(analysis.toxicity_score) >= Number(threshold);
}

module.exports = {
  analyzeMessage,
  summarizeArticleDiscussion,
  shouldBlockForMisinformation,
  shouldBlockForToxicity,
};
