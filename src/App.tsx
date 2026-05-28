import { useEffect, useMemo, useState } from 'react'
import './App.css'

type Domain = 'general' | 'software' | 'trading'

type PersonaSummary = {
  id: string
  file: string
  domain: Domain
}

type Persona = PersonaSummary & {
  name: string
  stance: string
  objective: string
  reviewFocus: string
  prompt: string
  questions: string[]
}

type AdvisorResponse = {
  persona: Persona
  headline: string
  evidenceUsed: string[]
  missingInputs: string[]
  recommendation: string
  risks: string[]
  invalidation: string
  noTradeCondition: string
  nextStep: string
  confidence: number
}

type PeerReview = {
  reviewer: Persona
  strongest: string
  blindSpot: string
  missed: string
}

type ChairVerdict = {
  recommendation: string
  confidence: number
  dissent: string
  nextAction: string
  whatEveryoneMissed: string
}

type CouncilRun = {
  id: string
  createdAt: string
  domain: Domain
  question: string
  marketContext?: string
  advisors: AdvisorResponse[]
  reviews: PeerReview[]
  chair: ChairVerdict
}

type ProviderMode = 'mock' | 'openai' | 'openrouter'

type YahooChartResponse = {
  chart?: {
    result?: Array<{
      meta?: {
        currency?: string
        exchangeName?: string
        fiftyTwoWeekHigh?: number
        fiftyTwoWeekLow?: number
        fullExchangeName?: string
        longName?: string
        regularMarketDayHigh?: number
        regularMarketDayLow?: number
        regularMarketPrice?: number
        regularMarketTime?: number
        regularMarketVolume?: number
        symbol?: string
      }
      timestamp?: number[]
      indicators?: {
        quote?: Array<{
          close?: Array<number | null>
          high?: Array<number | null>
          low?: Array<number | null>
          volume?: Array<number | null>
        }>
      }
    }>
    error?: { code?: string; description?: string }
  }
}

const domainLabels: Record<Domain, string> = {
  general: 'General',
  software: 'Software Engineering',
  trading: 'Swing Trading',
}

const sampleQuestions: Record<Domain, string> = {
  general:
    'Should I turn this idea into a weekend project, a serious product, or drop it?',
  software:
    'Should we build the LLM Council as a static GitHub Pages app first, or start with a full-stack backend?',
  trading:
    'Should I take a swing trade in a strong stock after earnings, or wait for a retest?',
}

const tradingEvidenceContract = `
Trading evidence contract:
- Do not invent current price, support, resistance, moving averages, volume, catalysts, earnings dates, analyst news, fundamentals, valuation, open positions, closed positions, or market regime.
- Use only the market context supplied by the user in this run. The app does not read Ram's trading journal or broker state.
- If the supplied context lacks the data your persona needs, still produce a useful lane-specific checklist with the exact missing inputs, a provisional decision gate, and what would change the answer.
- A valid swing-trade answer must include: evidence used, missing inputs, entry trigger or trigger checklist, invalidation, stop zone or stop-input needed, position sizing rule or sizing-input needed, no-trade condition, and review timing.
- Never fill missing facts with plausible-sounding numbers or narratives.
`.trim()

const fundamentalNewsContract = `
Bull/Bear evidence lane:
- Base Bull Case and Bear Case on news, fundamentals, catalysts, valuation, earnings/revisions, sector narrative, and macro/industry risk.
- Do not perform technical analysis except to defer timing to the Market Technician.
- Do not invent news, earnings dates, guidance, analyst actions, valuation metrics, or financial results.
- If supplied context only contains Yahoo chart data, say the fundamental/news case is under-specified and list the missing fundamental/news inputs.
- Bull Case should answer: why could fundamentals/news justify upside?
- Bear Case should answer: what fundamental/news risk could break the thesis?
- Bull/Bear must not cite chart levels as evidence for their case. If they need timing, they must ask Market Technician for it.
`.trim()

const technicalAnalysisContract = `
Market Technician evidence lane:
- Base Market Technician analysis only on price, trend, support/resistance, moving averages, volume, relative strength, extension, and timeframe.
- Do not make fundamental, valuation, earnings-quality, or news claims.
- Use Yahoo chart context and user-supplied technical context when available.
- If technical context is incomplete, return the exact chart inputs needed before judging entry timing.
- Market Technician must not cite catalysts, valuation, earnings, or news as evidence for entry quality.
`.trim()

const councilQualityContract = `
Council quality contract:
- Stay inside your persona; do not produce a generic balanced assistant answer.
- Separate observed evidence from assumptions and missing information.
- Prefer concrete criteria, thresholds, tradeoffs, and next checks over broad advice.
- If the decision is under-specified, say exactly what is missing and how that changes confidence.
- Do not claim facts, dates, prices, benchmarks, APIs, or external events that were not supplied in the prompt.
- Make the answer useful for a decision, not just descriptive.
`.trim()

function tradingPersonaContract(persona: Persona) {
  if (persona.id === 'trading-bull' || persona.id === 'trading-bear') {
    return `${tradingEvidenceContract}\n\n${fundamentalNewsContract}`
  }

  if (persona.id === 'trading-technician') {
    return `${tradingEvidenceContract}\n\n${technicalAnalysisContract}`
  }

  return tradingEvidenceContract
}

function inferTicker(question: string) {
  const candidates = question.toUpperCase().match(/\b[A-Z]{1,5}\b/g) ?? []
  const ignored = new Set([
    'A',
    'AI',
    'AM',
    'I',
    'IN',
    'LLM',
    'ME',
    'OR',
    'SHOULD',
    'SWING',
    'TAKE',
    'THE',
    'TRADE',
  ])
  return candidates.find((item) => !ignored.has(item)) ?? ''
}

function formatNumber(value: number | null | undefined, digits = 2) {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toFixed(digits)
    : 'n/a'
}

function formatVolume(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return String(Math.round(value))
}

function average(values: Array<number | null | undefined>) {
  const clean = values.filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value),
  )
  if (!clean.length) return null
  return clean.reduce((sum, value) => sum + value, 0) / clean.length
}

function latest(values: Array<number | null | undefined>) {
  return [...values]
    .reverse()
    .find((value): value is number => typeof value === 'number' && Number.isFinite(value))
}

function buildYahooMarketContext(symbol: string, data: YahooChartResponse) {
  const result = data.chart?.result?.[0]
  if (!result || data.chart?.error) {
    throw new Error(data.chart?.error?.description || 'Yahoo Finance returned no chart data.')
  }

  const meta = result.meta ?? {}
  const quote = result.indicators?.quote?.[0] ?? {}
  const closes = quote.close ?? []
  const highs = quote.high ?? []
  const lows = quote.low ?? []
  const volumes = quote.volume ?? []
  const latestClose = latest(closes)
  const priorClose = latest(closes.slice(0, -1))
  const closeChange =
    typeof latestClose === 'number' && typeof priorClose === 'number'
      ? latestClose - priorClose
      : null
  const closeChangePercent =
    typeof closeChange === 'number' && typeof priorClose === 'number' && priorClose !== 0
      ? (closeChange / priorClose) * 100
      : null
  const recentHigh = latest(highs.slice(-20))
  const recentLow = latest(lows.slice(-20))
  const twentyDayHigh = Math.max(
    ...highs.slice(-20).filter((value): value is number => typeof value === 'number'),
  )
  const twentyDayLow = Math.min(
    ...lows.slice(-20).filter((value): value is number => typeof value === 'number'),
  )
  const avgVolume20 = average(volumes.slice(-20))
  const sourceUrl = `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/chart`
  const finvizUrl = `https://finviz.com/quote.ashx?t=${encodeURIComponent(symbol)}`

  return [
    `Source: Yahoo Finance chart endpoint, 3mo daily data. Cross-check: ${sourceUrl} and ${finvizUrl}`,
    `Ticker: ${meta.symbol || symbol}`,
    `Company: ${meta.longName || 'n/a'}`,
    `Exchange: ${meta.fullExchangeName || meta.exchangeName || 'n/a'}`,
    `Current/regular price: ${formatNumber(meta.regularMarketPrice ?? latestClose)} ${meta.currency || ''}`.trim(),
    `Latest daily close: ${formatNumber(latestClose)}`,
    `Prior daily close: ${formatNumber(priorClose)}`,
    `Daily close change: ${formatNumber(closeChange)} (${formatNumber(closeChangePercent)}%)`,
    `Day range: ${formatNumber(meta.regularMarketDayLow)} - ${formatNumber(meta.regularMarketDayHigh)}`,
    `Latest observed daily high/low: ${formatNumber(recentLow)} - ${formatNumber(recentHigh)}`,
    `Approx 20-day high/low: ${formatNumber(Number.isFinite(twentyDayHigh) ? twentyDayHigh : null)} - ${formatNumber(Number.isFinite(twentyDayLow) ? twentyDayLow : null)}`,
    `52-week range: ${formatNumber(meta.fiftyTwoWeekLow)} - ${formatNumber(meta.fiftyTwoWeekHigh)}`,
    `Regular volume: ${formatVolume(meta.regularMarketVolume)}`,
    `Approx 20-day average volume: ${formatVolume(avgVolume20)}`,
    'User must still supply: intended timeframe, entry style, stop/risk budget, existing correlated exposure, and any thesis/catalyst not visible in price data.',
  ].join('\n')
}

function buildDecisionContext(domain: Domain, question: string, marketContext: string) {
  if (domain !== 'trading') {
    return `Domain: ${domainLabels[domain]}\nDecision: ${question}`
  }

  const context = marketContext.trim()
  return [
    `Domain: ${domainLabels[domain]}`,
    `Decision: ${question}`,
    '',
    'User-supplied market context:',
    context || '[none supplied]',
    '',
    'Position-state rule: only use current position or exposure if it appears above. Do not infer holdings from prior history.',
    '',
    tradingEvidenceContract,
  ].join('\n')
}

function parseFrontmatter(markdown: string) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!match) return { data: new Map<string, string>(), body: markdown }

  const data = new Map<string, string>()
  for (const line of match[1].split('\n')) {
    const [key, ...rest] = line.split(':')
    if (key && rest.length) {
      data.set(key.trim(), rest.join(':').trim().replace(/^["']|["']$/g, ''))
    }
  }
  return { data, body: match[2].trim() }
}

function extractQuestions(body: string) {
  const section = body.split(/##\s+Default Questions/i)[1] ?? ''
  return section
    .split('\n')
    .map((line) => line.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 5)
}

function inferPersonaTone(persona: Persona, question: string) {
  const text = `${persona.name} ${persona.stance} ${persona.objective}`.toLowerCase()
  const shortQuestion = question.trim().replace(/\s+/g, ' ')

  if (text.includes('contrarian') || text.includes('bear')) {
    return {
      headline: 'Stress test before commitment',
      evidenceUsed: ['Mock mode uses persona shape only, not live market evidence.'],
      missingInputs: ['Current price context', 'Technical levels', 'Fundamental/news catalyst', 'Risk budget'],
      recommendation: `Do not accept the obvious answer yet. Treat "${shortQuestion}" as a hypothesis and identify the one failure mode that would make it expensive.`,
      risks: [
        'The plan may depend on assumptions that are currently untested.',
        'Optimistic framing can hide operational cost, timing risk, or weak demand.',
        'A single missing constraint could make the recommendation look better than it is.',
      ],
      invalidation: 'The thesis is invalid if the core assumption cannot be verified with supplied evidence.',
      noTradeCondition: 'Do not act while the decisive evidence is missing.',
      nextStep: 'Write the kill criteria first, then decide whether the idea still deserves execution.',
      confidence: 72,
    }
  }

  if (text.includes('first principles') || text.includes('architect')) {
    return {
      headline: 'Reframe the real problem',
      evidenceUsed: ['Mock mode uses persona shape only, not live market evidence.'],
      missingInputs: ['Decision constraints', 'Success metric', 'Failure criteria'],
      recommendation: `Strip the decision down to the underlying job. The useful question is not only "${shortQuestion}", but what outcome this decision must improve.`,
      risks: [
        'The proposed path may optimize implementation speed while missing the real user outcome.',
        'A copied pattern can preserve someone else’s constraints instead of yours.',
        'Too much abstraction early can make the system harder to change.',
      ],
      invalidation: 'The plan fails if it optimizes the wrong outcome.',
      noTradeCondition: 'Do not execute until the real constraint is named.',
      nextStep: 'Define the non-negotiable outcome and the smallest architecture that proves it.',
      confidence: 78,
    }
  }

  if (text.includes('expansion') || text.includes('bull')) {
    return {
      headline: 'Look for the bigger adjacent win',
      evidenceUsed: ['Mock mode uses persona shape only, not live market evidence.'],
      missingInputs: ['Upside catalyst', 'Market/fundamental confirmation', 'Timing evidence'],
      recommendation: `The base idea is useful, but the stronger move is to make it reusable. Design this so the same council engine can support multiple domains without rewrites.`,
      risks: [
        'Starting too narrow can create a dead-end workflow.',
        'A useful pattern may be trapped inside one domain if personas are hardcoded.',
        'The upside comes from repeatable councils, not one impressive answer.',
      ],
      invalidation: 'Upside is invalid if the reusable path adds complexity without improving decisions.',
      noTradeCondition: 'Do not act on upside alone without a defined invalidation.',
      nextStep: 'Separate council engine, persona files, and domain presets before adding polish.',
      confidence: 81,
    }
  }

  if (text.includes('outsider') || text.includes('product')) {
    return {
      headline: 'Make it understandable without insider context',
      evidenceUsed: ['Mock mode uses persona shape only, not live market evidence.'],
      missingInputs: ['User context', 'Decision history', 'Evidence source'],
      recommendation: `A new user should immediately understand what a council run does, why multiple roles matter, and what action to take after the verdict.`,
      risks: [
        'The product can feel like a prompt playground instead of a decision tool.',
        'Opaque personas reduce trust because users cannot inspect the judgment source.',
        'Too much AI ceremony can slow down the actual decision.',
      ],
      invalidation: 'The output fails if the user cannot tell what to do next.',
      noTradeCondition: 'Do not rely on output that cannot name its evidence.',
      nextStep: 'Show the flow visually: question, advisors, anonymous review, chair verdict, next action.',
      confidence: 76,
    }
  }

  if (text.includes('executor') || text.includes('risk manager')) {
    return {
      headline: 'Convert the verdict into a controlled action',
      evidenceUsed: ['Mock mode uses persona shape only, not live market evidence.'],
      missingInputs: ['Entry trigger', 'Stop/invalidation', 'Sizing rule', 'Review timing'],
      recommendation: `Make the first version useful in one sitting: enter a decision, run the council, inspect dissent, export the result.`,
      risks: [
        'A brilliant synthesis is wasted if it does not produce a next step.',
        'Without history, users cannot learn whether councils improve decisions.',
        'For trading, missing invalidation and sizing would make the output unsafe.',
      ],
      invalidation: 'The plan is invalid if it cannot be converted into an if/then action.',
      noTradeCondition: 'No action without a written trigger, invalidation, and size rule.',
      nextStep: 'Ship a static MVP with mock mode, editable Markdown personas, run history, and export.',
      confidence: 84,
    }
  }

  return {
    headline: 'Clarify the decision',
    evidenceUsed: ['Mock mode uses persona shape only, not live market evidence.'],
    missingInputs: ['Decision context', 'Evidence', 'Constraints'],
    recommendation: `Use the council to separate evidence, assumptions, dissent, and action for "${shortQuestion}".`,
    risks: [
      'The decision may be under-specified.',
      'The strongest objection may not come from the first answer.',
      'The next step may be too vague to execute.',
    ],
    invalidation: 'The recommendation is invalid if it rests on unstated assumptions.',
    noTradeCondition: 'Do not act until the decision has evidence and a no-go rule.',
    nextStep: 'Add context, run the council, and compare dissent before acting.',
    confidence: 70,
  }
}

function buildMockCouncil(question: string, domain: Domain, personas: Persona[]): CouncilRun {
  const advisors = personas.map((persona) => ({
    persona,
    ...inferPersonaTone(persona, question),
  }))

  const reviews = personas.map((reviewer, index) => {
    const strongest = advisors[(index + 2) % advisors.length]
    const weakest = advisors[(index + 1) % advisors.length]
    return {
      reviewer,
      strongest: `${strongest.persona.name} has the most actionable framing because it converts the decision into a testable move.`,
      blindSpot: `${weakest.persona.name} underweights one constraint: execution quality matters as much as the idea itself.`,
      missed:
        'The council should explicitly capture the condition that would change the recommendation later.',
    }
  })

  const avgConfidence = Math.round(
    advisors.reduce((sum, item) => sum + item.confidence, 0) / advisors.length,
  )

  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    domain,
    question,
    advisors,
    reviews,
    chair: {
      recommendation:
        domain === 'trading'
          ? 'Use the council as a trade-quality review, not a signal generator. The verdict must include thesis, invalidation, sizing, and review date before any action.'
          : 'Build the council as a reusable decision engine with editable Markdown personas and a compact verdict view. Start narrow enough to ship, but keep domains configurable.',
      confidence: avgConfidence,
      dissent:
        'The strongest dissent is that a council can create false confidence if every role is powered by the same missing context.',
      nextAction:
        domain === 'software'
          ? 'Run this MVP against one real engineering decision and compare its output with a direct single-model answer.'
          : 'Create one real council run, inspect the dissent, and edit the weakest persona before trusting repeated use.',
      whatEveryoneMissed:
        'The system needs a memory of past decisions and outcomes, otherwise it cannot learn which council patterns actually improved judgment.',
    },
  }
}

function parseModelJson<T>(content: string, fallback: T): T {
  const cleaned = content
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim()

  try {
    return JSON.parse(cleaned) as T
  } catch {
    return fallback
  }
}

function asStringArray(value: unknown, fallback: string[]) {
  return Array.isArray(value)
    ? value
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean)
    : fallback
}

function normalizeAdvisorResponse(
  persona: Persona,
  parsed: Partial<Omit<AdvisorResponse, 'persona'>>,
): Omit<AdvisorResponse, 'persona'> {
  return {
    headline: parsed.headline?.trim() || persona.name,
    evidenceUsed: asStringArray(parsed.evidenceUsed, [
      'No valid evidence list returned.',
    ]),
    missingInputs: asStringArray(parsed.missingInputs, [
      'The model did not identify missing inputs.',
    ]),
    recommendation:
      parsed.recommendation?.trim() ||
      'The model did not return a valid recommendation.',
    risks: asStringArray(parsed.risks, ['No valid risk list returned.']).slice(0, 3),
    invalidation:
      parsed.invalidation?.trim() || 'No valid invalidation returned.',
    noTradeCondition:
      parsed.noTradeCondition?.trim() || 'No valid no-trade condition returned.',
    nextStep: parsed.nextStep?.trim() || 'Retry the run with more context.',
    confidence:
      typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence)
        ? Math.max(0, Math.min(100, Math.round(parsed.confidence)))
        : 50,
  }
}

function normalizeProviderModel(provider: Exclude<ProviderMode, 'mock'>, model: string) {
  const trimmed = model.trim()
  if (provider === 'openai' && trimmed.startsWith('openai/')) {
    return trimmed.replace(/^openai\//, '')
  }
  return trimmed
}

async function readProviderError(response: Response) {
  const fallback = await response.text().catch(() => '')
  try {
    const parsed = JSON.parse(fallback) as {
      error?: { message?: string; type?: string; code?: string }
    }
    const message = parsed.error?.message
    const code = parsed.error?.code || parsed.error?.type
    return [message, code && `code: ${code}`].filter(Boolean).join(' ')
  } catch {
    return fallback
  }
}

async function callChatCompletion(
  provider: Exclude<ProviderMode, 'mock'>,
  apiKey: string,
  model: string,
  messages: unknown[],
) {
  const endpoint =
    provider === 'openai'
      ? 'https://api.openai.com/v1/chat/completions'
      : 'https://openrouter.ai/api/v1/chat/completions'
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }

  if (provider === 'openrouter') {
    headers['HTTP-Referer'] = window.location.href
    headers['X-Title'] = 'LLM Council'
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: normalizeProviderModel(provider, model),
      temperature: 0.35,
      messages,
    }),
  })

  if (!response.ok) {
    const label = provider === 'openai' ? 'OpenAI' : 'OpenRouter'
    const detail = await readProviderError(response)
    throw new Error(
      `${label} returned ${response.status}${detail ? `: ${detail}` : ''}`,
    )
  }

  const data = await response.json()
  return data.choices?.[0]?.message?.content as string
}

async function buildProviderCouncil(
  question: string,
  domain: Domain,
  personas: Persona[],
  provider: Exclude<ProviderMode, 'mock'>,
  apiKey: string,
  model: string,
  marketContext: string,
): Promise<CouncilRun> {
  const decisionContext = buildDecisionContext(domain, question, marketContext)
  const outputContract =
    domain === 'trading'
      ? 'Return only JSON with keys: headline, evidenceUsed (array), missingInputs (array), recommendation, risks (array of 3 strings), invalidation, noTradeCondition, nextStep, confidence (0-100). In recommendation and nextStep, explicitly state when market context is insufficient; do not invent technical levels, fundamentals, news, or holdings.'
      : 'Return only JSON with keys: headline, evidenceUsed (array), missingInputs (array), recommendation, risks (array of 3 strings), invalidation, noTradeCondition, nextStep, confidence (0-100). Avoid vague advice; make the recommendation role-specific.'

  const advisors = await Promise.all(
    personas.map(async (persona) => {
      const fallback = {
        headline: persona.name,
        evidenceUsed: ['No valid JSON output'],
        missingInputs: ['Retry is required because the response was not parseable.'],
        recommendation: 'The model did not return valid JSON. Inspect the raw prompt and retry.',
        risks: ['Invalid JSON output'],
        invalidation: 'Invalid response format.',
        noTradeCondition: 'Do not act on invalid model output.',
        nextStep: 'Retry the run or switch to mock mode.',
        confidence: 50,
      }
      const content = await callChatCompletion(provider, apiKey, model, [
        {
          role: 'system',
          content: `${persona.prompt}\n\n${
            domain === 'trading' ? `${tradingPersonaContract(persona)}\n\n` : ''
          }${councilQualityContract}\n\n${outputContract}`,
        },
        {
          role: 'user',
          content: decisionContext,
        },
      ])
      return {
        persona,
        ...normalizeAdvisorResponse(persona, parseModelJson(content, fallback)),
      }
    }),
  )

  const anonymousResponses = advisors
    .map(
      (advisor, index) =>
        [
          `Response ${String.fromCharCode(65 + index)}`,
          `Headline: ${advisor.headline}`,
          `Evidence used: ${advisor.evidenceUsed.join('; ')}`,
          `Missing inputs: ${advisor.missingInputs.join('; ')}`,
          `Recommendation: ${advisor.recommendation}`,
          `Risks: ${advisor.risks.join('; ')}`,
          `Invalidation: ${advisor.invalidation}`,
          `No-trade condition: ${advisor.noTradeCondition}`,
          `Next step: ${advisor.nextStep}`,
        ].join('\n'),
    )
    .join('\n\n')

  const reviews = await Promise.all(
    personas.map(async (reviewer) => {
      const fallback = {
        strongest: 'No valid review returned.',
        blindSpot: 'No valid blind spot returned.',
        missed: 'No valid missed item returned.',
      }
      const content = await callChatCompletion(provider, apiKey, model, [
        {
          role: 'system',
          content: `${reviewer.prompt}\n\n${
            domain === 'trading' ? `${tradingPersonaContract(reviewer)}\n\n` : ''
          }${councilQualityContract}\n\nYou are anonymously reviewing peer responses. Do not infer author names. Penalize generic advice, role-lane violations, ungrounded claims, missing dissent, invented evidence, invented holdings, and missing no-trade gates. Return only JSON with keys: strongest, blindSpot, missed.`,
        },
        {
          role: 'user',
          content: `${decisionContext}\n\n${anonymousResponses}`,
        },
      ])
      return {
        reviewer,
        ...parseModelJson(content, fallback),
      }
    }),
  )

  const chairFallback = buildMockCouncil(question, domain, personas).chair
  const chairContent = await callChatCompletion(provider, apiKey, model, [
    {
      role: 'system',
      content:
        `You are the chair of an LLM council. Synthesize advisor answers and peer reviews into a decision verdict. ${
          domain === 'trading'
            ? 'For trading, reject invented levels, fundamentals, news, and holdings. If context is insufficient, the verdict must still be operational: say "not actionable yet" and name the exact missing inputs, the next data-gathering action, the no-trade gate, and which persona owns the blocker. '
            : ''
        }Use the council quality contract: separate evidence from assumptions, surface unresolved gaps, preserve the strongest dissent, and avoid generic compromise. Return only JSON with keys: recommendation, confidence (0-100), dissent, nextAction, whatEveryoneMissed.`,
    },
    {
      role: 'user',
      content: `${decisionContext}\n\nAdvisor responses:\n${anonymousResponses}\n\nPeer reviews:\n${reviews
        .map(
          (review) =>
            `Reviewer: ${review.reviewer.name}\nStrongest: ${review.strongest}\nBlind spot: ${review.blindSpot}\nMissed: ${review.missed}`,
        )
        .join('\n\n')}`,
    },
  ])

  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    domain,
    question,
    marketContext: marketContext.trim() || undefined,
    advisors,
    reviews,
    chair: parseModelJson(chairContent, chairFallback),
  }
}

function saveMarkdown(run: CouncilRun) {
  const lines = [
    `# LLM Council Run - ${domainLabels[run.domain]}`,
    '',
    `Question: ${run.question}`,
    `Created: ${new Date(run.createdAt).toLocaleString()}`,
    ...(run.marketContext
      ? ['', '## Market Context', '', run.marketContext]
      : []),
    '',
    '## Chair Verdict',
    '',
    `Recommendation: ${run.chair.recommendation}`,
    `Confidence: ${run.chair.confidence}%`,
    `Dissent: ${run.chair.dissent}`,
    `What everyone missed: ${run.chair.whatEveryoneMissed}`,
    `Next action: ${run.chair.nextAction}`,
    '',
    '## Advisors',
    '',
    ...run.advisors.flatMap((advisor) => [
      `### ${advisor.persona.name}`,
      '',
      advisor.headline,
      '',
      'Evidence used:',
      ...advisor.evidenceUsed.map((item) => `- ${item}`),
      '',
      'Missing inputs:',
      ...advisor.missingInputs.map((item) => `- ${item}`),
      '',
      advisor.recommendation,
      '',
      'Risks:',
      ...advisor.risks.map((risk) => `- ${risk}`),
      '',
      `Invalidation: ${advisor.invalidation}`,
      `No-trade condition: ${advisor.noTradeCondition}`,
      `Next step: ${advisor.nextStep}`,
      '',
    ]),
    '## Peer Review',
    '',
    ...run.reviews.flatMap((review) => [
      `### ${review.reviewer.name}`,
      '',
      `Strongest: ${review.strongest}`,
      `Blind spot: ${review.blindSpot}`,
      `Missed: ${review.missed}`,
      '',
    ]),
  ]

  const blob = new Blob([lines.join('\n')], { type: 'text/markdown' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `llm-council-${run.domain}-${run.id.slice(0, 8)}.md`
  link.click()
  URL.revokeObjectURL(url)
}

function App() {
  const [personas, setPersonas] = useState<Persona[]>([])
  const [domain, setDomain] = useState<Domain>('software')
  const [question, setQuestion] = useState(sampleQuestions.software)
  const [marketContext, setMarketContext] = useState('')
  const [marketTicker, setMarketTicker] = useState('')
  const [isFetchingMarketData, setIsFetchingMarketData] = useState(false)
  const [marketDataStatus, setMarketDataStatus] = useState<string | null>(null)
  const [activeRun, setActiveRun] = useState<CouncilRun | null>(null)
  const [history, setHistory] = useState<CouncilRun[]>(() => {
    const stored = localStorage.getItem('llm-council-history')
    return stored ? (JSON.parse(stored) as CouncilRun[]) : []
  })
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)
  const [providerMode, setProviderMode] = useState<ProviderMode>('mock')
  const [apiKey, setApiKey] = useState(
    () => localStorage.getItem('llm-council-api-key') ?? '',
  )
  const [openRouterKey, setOpenRouterKey] = useState(
    () => localStorage.getItem('llm-council-openrouter-key') ?? '',
  )
  const [model, setModel] = useState(
    () => localStorage.getItem('llm-council-model') ?? 'gpt-4.1-mini',
  )
  const [selectedPersonaIds, setSelectedPersonaIds] = useState<Set<string>>(
    () => new Set(),
  )

  useEffect(() => {
    async function loadPersonas() {
      const personaBase = `${import.meta.env.BASE_URL}personas`
      const manifest = (await fetch(`${personaBase}/manifest.json`).then((res) => {
        if (!res.ok) throw new Error(`Persona manifest returned ${res.status}`)
        return res.json()
      })) as PersonaSummary[]

      const loaded = await Promise.all(
        manifest.map(async (item) => {
          const markdown = await fetch(`${personaBase}/${item.file}`).then((res) => {
            if (!res.ok) throw new Error(`${item.file} returned ${res.status}`)
            return res.text()
          })
          const { data, body } = parseFrontmatter(markdown)
          return {
            ...item,
            name: data.get('name') ?? item.id,
            stance: data.get('stance') ?? 'Advisor',
            objective: data.get('objective') ?? 'Evaluate the decision clearly.',
            reviewFocus:
              data.get('review_focus') ??
              'Find the strongest answer, the largest blind spot, and what everyone missed.',
            prompt: body,
            questions: extractQuestions(body),
          }
        }),
      )

      setPersonas(loaded)
      setSelectedPersonaIds(
        new Set(
          loaded
            .filter((persona) => persona.domain === 'software')
            .map((persona) => persona.id),
        ),
      )
      setIsLoading(false)
    }

    loadPersonas().catch((error: Error) => {
      setLoadError(error.message)
      setIsLoading(false)
    })
  }, [])

  const domainPersonas = useMemo(
    () => personas.filter((persona) => persona.domain === domain),
    [domain, personas],
  )

  const selectedPersonas = useMemo(
    () => domainPersonas.filter((persona) => selectedPersonaIds.has(persona.id)),
    [domainPersonas, selectedPersonaIds],
  )

  function changeDomain(nextDomain: Domain) {
    setDomain(nextDomain)
    setQuestion(sampleQuestions[nextDomain])
    setActiveRun(null)
    setSelectedPersonaIds(
      new Set(
        personas
          .filter((persona) => persona.domain === nextDomain)
          .map((persona) => persona.id),
      ),
    )
  }

  function togglePersona(personaId: string) {
    setSelectedPersonaIds((current) => {
      const next = new Set(current)
      if (next.has(personaId)) next.delete(personaId)
      else next.add(personaId)
      return next
    })
  }

  async function fetchYahooContext() {
    const symbol = (marketTicker.trim() || inferTicker(question)).toUpperCase()
    if (!symbol) {
      setMarketDataStatus('Enter a ticker first, for example NVDA.')
      return
    }

    setMarketTicker(symbol)
    setIsFetchingMarketData(true)
    setMarketDataStatus(null)
    try {
      const response = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
          symbol,
        )}?range=3mo&interval=1d`,
      )
      if (!response.ok) {
        throw new Error(`Yahoo Finance returned ${response.status}`)
      }
      const data = (await response.json()) as YahooChartResponse
      const context = buildYahooMarketContext(symbol, data)
      setMarketContext((current) =>
        current.trim() ? `${context}\n\nUser notes:\n${current.trim()}` : context,
      )
      setMarketDataStatus(`Loaded Yahoo context for ${symbol}.`)
    } catch (error) {
      setMarketDataStatus(
        `Could not fetch Yahoo context for ${symbol}: ${
          error instanceof Error ? error.message : 'unknown error'
        }. Open Yahoo/Finviz and paste the key chart facts manually.`,
      )
    } finally {
      setIsFetchingMarketData(false)
    }
  }

  async function runCouncil() {
    if (!question.trim() || selectedPersonas.length === 0) return
    setIsRunning(true)
    setRunError(null)
    try {
      const selectedKey =
        providerMode === 'openrouter' ? openRouterKey.trim() : apiKey.trim()
      if (providerMode !== 'mock' && (!selectedKey || !model.trim())) {
        throw new Error('Add an API key and model, or switch back to Mock mode.')
      }
      const run =
        providerMode !== 'mock'
          ? await buildProviderCouncil(
              question,
              domain,
              selectedPersonas,
              providerMode,
              selectedKey,
              model.trim(),
              marketContext,
            )
          : buildMockCouncil(question, domain, selectedPersonas)
      setActiveRun(run)
      const nextHistory = [run, ...history].slice(0, 12)
      setHistory(nextHistory)
      localStorage.setItem('llm-council-history', JSON.stringify(nextHistory))
      localStorage.setItem('llm-council-api-key', apiKey)
      localStorage.setItem('llm-council-openrouter-key', openRouterKey)
      localStorage.setItem('llm-council-model', model)
    } catch (error) {
      setRunError(error instanceof Error ? error.message : 'Council run failed')
    } finally {
      setIsRunning(false)
    }
  }

  return (
    <main className="app-shell">
      <section className="workspace">
        <aside className="sidebar" aria-label="Council controls">
          <div className="brand-block">
            <div className="brand-mark" aria-hidden="true">
              LC
            </div>
            <div>
              <h1>LLM Council</h1>
              <p>Independent advisors, blind review, one verdict.</p>
            </div>
          </div>

          <div className="control-group">
            <span className="control-label">Preset</span>
            <div className="segmented">
              {(Object.keys(domainLabels) as Domain[]).map((item) => (
                <button
                  className={item === domain ? 'active' : ''}
                  key={item}
                  onClick={() => changeDomain(item)}
                  type="button"
                >
                  {domainLabels[item]}
                </button>
              ))}
            </div>
          </div>

          <div className="control-group">
            <span className="control-label">Decision</span>
            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Paste the decision, proposal, trade thesis, or engineering question..."
            />
          </div>

          {domain === 'trading' ? (
            <div className="control-group">
              <span className="control-label">Market context</span>
              <div className="market-source-row">
                <input
                  aria-label="Ticker"
                  onChange={(event) => setMarketTicker(event.target.value.toUpperCase())}
                  placeholder="Ticker, e.g. NVDA"
                  value={marketTicker}
                />
                <button
                  className="secondary-button"
                  disabled={isFetchingMarketData}
                  onClick={fetchYahooContext}
                  type="button"
                >
                  {isFetchingMarketData ? 'Fetching...' : 'Fetch Yahoo'}
                </button>
              </div>
              <textarea
                className="market-context"
                onChange={(event) => setMarketContext(event.target.value)}
                placeholder="Paste current price, timeframe, trend, support/resistance, volume, news/catalysts, fundamentals/valuation, current open position/exposure, and max risk..."
                value={marketContext}
              />
              <p className="hint">
                Trading councils use Yahoo-loaded chart context plus anything pasted here.
                They do not read the trading journal or infer closed/open positions.
              </p>
              {marketTicker ? (
                <p className="hint source-links">
                  <a
                    href={`https://finance.yahoo.com/quote/${encodeURIComponent(
                      marketTicker,
                    )}/chart`}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Yahoo
                  </a>
                  <a
                    href={`https://finviz.com/quote.ashx?t=${encodeURIComponent(
                      marketTicker,
                    )}`}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Finviz
                  </a>
                </p>
              ) : null}
              {marketDataStatus ? <p className="hint">{marketDataStatus}</p> : null}
            </div>
          ) : null}

          <div className="control-group">
            <span className="control-label">Run mode</span>
            <div className="segmented provider-mode">
              <button
                className={providerMode === 'mock' ? 'active' : ''}
                onClick={() => setProviderMode('mock')}
                type="button"
              >
                Mock
              </button>
              <button
                className={providerMode === 'openai' ? 'active' : ''}
                onClick={() => {
                  setProviderMode('openai')
                  if (!model.trim() || model.startsWith('openai/')) {
                    setModel('gpt-4.1-mini')
                  }
                }}
                type="button"
              >
                OpenAI
              </button>
              <button
                className={providerMode === 'openrouter' ? 'active' : ''}
                onClick={() => {
                  setProviderMode('openrouter')
                  if (!model.trim() || model === 'gpt-4.1-mini') {
                    setModel('openai/gpt-4o-mini')
                  }
                }}
                type="button"
              >
                OpenRouter
              </button>
            </div>
          </div>

          {providerMode !== 'mock' ? (
            <div className="control-group">
              <span className="control-label">Provider</span>
              {providerMode === 'openai' ? (
                <input
                  aria-label="OpenAI API key"
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder="OpenAI API key"
                  type="password"
                  value={apiKey}
                />
              ) : (
                <input
                  aria-label="OpenRouter API key"
                  onChange={(event) => setOpenRouterKey(event.target.value)}
                  placeholder="OpenRouter API key"
                  type="password"
                  value={openRouterKey}
                />
              )}
              <input
                aria-label="Model id"
                onChange={(event) => setModel(event.target.value)}
                placeholder={
                  providerMode === 'openai'
                    ? 'Model id, for example gpt-4.1-mini'
                    : 'Model id, for example openai/gpt-4o-mini'
                }
                value={model}
              />
              <p className="hint">Stored only in this browser's local storage.</p>
            </div>
          ) : null}

          <button
            className="run-button"
            disabled={isLoading || isRunning}
            onClick={runCouncil}
          >
            {isRunning ? 'Running...' : 'Run council'}
          </button>
          {runError ? <p className="load-error">{runError}</p> : null}

          <div className="persona-list">
            <div className="persona-list-header">
              <span className="control-label">
                Personas selected ({selectedPersonas.length}/{domainPersonas.length})
              </span>
              <button
                className="text-button"
                onClick={() => {
                  const allSelected = selectedPersonas.length === domainPersonas.length
                  setSelectedPersonaIds(
                    new Set(allSelected ? [] : domainPersonas.map((persona) => persona.id)),
                  )
                }}
                type="button"
              >
                {selectedPersonas.length === domainPersonas.length
                  ? 'Clear'
                  : 'Select all'}
              </button>
            </div>
            {loadError ? <p className="load-error">{loadError}</p> : null}
            {domainPersonas.map((persona) => (
              <article
                className={`persona-chip ${
                  selectedPersonaIds.has(persona.id) ? 'selected' : ''
                }`}
                key={persona.id}
              >
                <label>
                  <input
                    checked={selectedPersonaIds.has(persona.id)}
                    onChange={() => togglePersona(persona.id)}
                    type="checkbox"
                  />
                  <span>
                    <strong>{persona.name}</strong>
                    <small>{persona.stance}</small>
                  </span>
                </label>
              </article>
            ))}
            {selectedPersonas.length === 0 ? (
              <p className="load-error">Select at least one persona for the run.</p>
            ) : null}
          </div>
        </aside>

        <section className="run-space">
          <div className="status-row">
            <div>
              <span className="eyebrow">Council flow</span>
              <h2>{domainLabels[domain]}</h2>
            </div>
            {activeRun ? (
              <button className="secondary-button" onClick={() => saveMarkdown(activeRun)}>
                Export markdown
              </button>
            ) : null}
          </div>

          <div className="flow-map" aria-label="Council execution flow">
            {['Question', 'Advisors', 'Blind review', 'Chair verdict'].map(
              (step, index) => (
                <div className="flow-node" key={step}>
                  <span>{index + 1}</span>
                  {step}
                </div>
              ),
            )}
          </div>

          {!activeRun ? (
            <section className="empty-state">
              <h2>Start with a decision that is expensive to get wrong.</h2>
              <p>
                Personas live in <code>public/personas</code>. Edit the Markdown
                files or add new ones to change the council behavior.
              </p>
            </section>
          ) : (
            <section className="results">
              <article className="verdict-panel">
                <div>
                  <span className="eyebrow">Chair verdict</span>
                  <h2>{activeRun.chair.recommendation}</h2>
                </div>
                <div className="confidence">
                  <strong>{activeRun.chair.confidence}%</strong>
                  <span>confidence</span>
                </div>
                <p>
                  <strong>Dissent:</strong> {activeRun.chair.dissent}
                </p>
                <p>
                  <strong>What everyone missed:</strong>{' '}
                  {activeRun.chair.whatEveryoneMissed}
                </p>
                <p>
                  <strong>Next action:</strong> {activeRun.chair.nextAction}
                </p>
              </article>

              <div className="section-heading">
                <h3>Advisor Responses</h3>
                <span>{activeRun.advisors.length} independent reads</span>
              </div>
              <div className="advisor-grid">
                {activeRun.advisors.map((advisor) => (
                  <article className="advisor-card" key={advisor.persona.id}>
                    <span className="persona-name">{advisor.persona.name}</span>
                    <h4>{advisor.headline}</h4>
                    <div className="evidence-block">
                      <strong>Evidence</strong>
                      <ul>
                        {advisor.evidenceUsed.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="evidence-block missing">
                      <strong>Missing</strong>
                      <ul>
                        {advisor.missingInputs.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                    <p>{advisor.recommendation}</p>
                    <ul>
                      {advisor.risks.map((risk) => (
                        <li key={risk}>{risk}</li>
                      ))}
                    </ul>
                    <p>
                      <strong>Invalidation:</strong> {advisor.invalidation}
                    </p>
                    <p>
                      <strong>No-trade:</strong> {advisor.noTradeCondition}
                    </p>
                    <div className="next-step">{advisor.nextStep}</div>
                  </article>
                ))}
              </div>

              <div className="section-heading">
                <h3>Anonymous Peer Review</h3>
                <span>Reviewers judge the answers, not the author labels.</span>
              </div>
              <div className="review-grid">
                {activeRun.reviews.map((review) => (
                  <article className="review-card" key={review.reviewer.id}>
                    <strong>{review.reviewer.name}</strong>
                    <p>{review.strongest}</p>
                    <p>{review.blindSpot}</p>
                    <p>{review.missed}</p>
                  </article>
                ))}
              </div>
            </section>
          )}
        </section>

        <aside className="history-panel" aria-label="Run history">
          <span className="control-label">Run history</span>
          {history.length === 0 ? (
            <p className="muted">No runs yet.</p>
          ) : (
            history.map((run) => (
              <button
                className="history-item"
                key={run.id}
                onClick={() => {
                  setDomain(run.domain)
                  setQuestion(run.question)
                  setActiveRun(run)
                }}
                type="button"
              >
                <strong>{domainLabels[run.domain]}</strong>
                <span>{run.question}</span>
              </button>
            ))
          )}
        </aside>
      </section>
    </main>
  )
}

export default App
