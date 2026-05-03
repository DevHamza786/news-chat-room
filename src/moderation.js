const config = require('./config');
const OpenAI = require('openai');

const openai = config.openai.apiKey
  ? new OpenAI({ apiKey: config.openai.apiKey })
  : null;

const SYSTEM_PROMPT = `You are a moderation assistant that analyzes chat messages for toxicity and misinformation.

For each message you must respond with a JSON object containing exactly these fields:
- toxicity_score: number between 0 and 1 (0 = not toxic, 1 = highly toxic). Consider insults, hate speech, threats, harassment.
- claim_detected: boolean. True if the message makes a factual claim about the world (events, statistics, causes, claims about people or organizations), false for opinions, questions, greetings, or casual chat.
- misinformation_risk: number between 0 and 1 (0 = low risk, 1 = high risk of being false/misleading). Only meaningful when claim_detected is true; otherwise use 0.
- truth_score: number between 0 and 100 (0 = likely false, 100 = likely true). Only meaningful when claim_detected is true; for non-claims use 50 (neutral).
- explanation: string. One short sentence explaining the scores (e.g. "Claim lacks supporting evidence and conflicts with trusted sources." or "No factual claim; casual conversation.").

Respond only with valid JSON, no markdown or extra text.`;

/**
 * Call AI moderation service to analyze a message before broadcast.
 * Returns { toxicity_score, claim_detected, misinformation_risk, truth_score, explanation }
 * or null if moderation is disabled or the service is unavailable.
 */
async function analyzeMessage(message) {
  if (!openai) {
    console.warn('[moderation] OpenAI API key not configured, skipping moderation.');
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
    const response = await openai.chat.completions.create({
      model: config.openai.model,
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
      console.warn('[moderation] Empty response from OpenAI');
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
  shouldBlockForMisinformation,
  shouldBlockForToxicity,
};
