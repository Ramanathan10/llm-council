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
  recommendation: string
  risks: string[]
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
- Do not invent current price, support, resistance, moving averages, volume, catalysts, earnings dates, analyst news, or market regime.
- Use only the market context supplied by the user in this run.
- If the supplied context lacks current chart/market data, say the setup is not actionable from the available evidence.
- A valid swing-trade answer must include: data gap or evidence used, entry trigger, invalidation, stop zone, position sizing rule, no-trade condition, and review timing.
- Never fill missing price levels with plausible-sounding numbers.
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
      recommendation: `Do not accept the obvious answer yet. Treat "${shortQuestion}" as a hypothesis and identify the one failure mode that would make it expensive.`,
      risks: [
        'The plan may depend on assumptions that are currently untested.',
        'Optimistic framing can hide operational cost, timing risk, or weak demand.',
        'A single missing constraint could make the recommendation look better than it is.',
      ],
      nextStep: 'Write the kill criteria first, then decide whether the idea still deserves execution.',
      confidence: 72,
    }
  }

  if (text.includes('first principles') || text.includes('architect')) {
    return {
      headline: 'Reframe the real problem',
      recommendation: `Strip the decision down to the underlying job. The useful question is not only "${shortQuestion}", but what outcome this decision must improve.`,
      risks: [
        'The proposed path may optimize implementation speed while missing the real user outcome.',
        'A copied pattern can preserve someone else’s constraints instead of yours.',
        'Too much abstraction early can make the system harder to change.',
      ],
      nextStep: 'Define the non-negotiable outcome and the smallest architecture that proves it.',
      confidence: 78,
    }
  }

  if (text.includes('expansion') || text.includes('bull')) {
    return {
      headline: 'Look for the bigger adjacent win',
      recommendation: `The base idea is useful, but the stronger move is to make it reusable. Design this so the same council engine can support multiple domains without rewrites.`,
      risks: [
        'Starting too narrow can create a dead-end workflow.',
        'A useful pattern may be trapped inside one domain if personas are hardcoded.',
        'The upside comes from repeatable councils, not one impressive answer.',
      ],
      nextStep: 'Separate council engine, persona files, and domain presets before adding polish.',
      confidence: 81,
    }
  }

  if (text.includes('outsider') || text.includes('product')) {
    return {
      headline: 'Make it understandable without insider context',
      recommendation: `A new user should immediately understand what a council run does, why multiple roles matter, and what action to take after the verdict.`,
      risks: [
        'The product can feel like a prompt playground instead of a decision tool.',
        'Opaque personas reduce trust because users cannot inspect the judgment source.',
        'Too much AI ceremony can slow down the actual decision.',
      ],
      nextStep: 'Show the flow visually: question, advisors, anonymous review, chair verdict, next action.',
      confidence: 76,
    }
  }

  if (text.includes('executor') || text.includes('risk manager')) {
    return {
      headline: 'Convert the verdict into a controlled action',
      recommendation: `Make the first version useful in one sitting: enter a decision, run the council, inspect dissent, export the result.`,
      risks: [
        'A brilliant synthesis is wasted if it does not produce a next step.',
        'Without history, users cannot learn whether councils improve decisions.',
        'For trading, missing invalidation and sizing would make the output unsafe.',
      ],
      nextStep: 'Ship a static MVP with mock mode, editable Markdown personas, run history, and export.',
      confidence: 84,
    }
  }

  return {
    headline: 'Clarify the decision',
    recommendation: `Use the council to separate evidence, assumptions, dissent, and action for "${shortQuestion}".`,
    risks: [
      'The decision may be under-specified.',
      'The strongest objection may not come from the first answer.',
      'The next step may be too vague to execute.',
    ],
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
      ? 'Return only JSON with keys: headline, recommendation, risks (array of 3 strings), nextStep, confidence (0-100). In recommendation and nextStep, explicitly state when market context is insufficient; do not invent technical levels.'
      : 'Return only JSON with keys: headline, recommendation, risks (array of 3 strings), nextStep, confidence (0-100). Avoid vague advice; make the recommendation role-specific.'

  const advisors = await Promise.all(
    personas.map(async (persona) => {
      const fallback = {
        headline: persona.name,
        recommendation: 'The model did not return valid JSON. Inspect the raw prompt and retry.',
        risks: ['Invalid JSON output'],
        nextStep: 'Retry the run or switch to mock mode.',
        confidence: 50,
      }
      const content = await callChatCompletion(provider, apiKey, model, [
        {
          role: 'system',
          content: `${persona.prompt}\n\n${
            domain === 'trading' ? `${tradingEvidenceContract}\n\n` : ''
          }${councilQualityContract}\n\n${outputContract}`,
        },
        {
          role: 'user',
          content: decisionContext,
        },
      ])
      return {
        persona,
        ...parseModelJson(content, fallback),
      }
    }),
  )

  const anonymousResponses = advisors
    .map(
      (advisor, index) =>
        `Response ${String.fromCharCode(65 + index)}\nHeadline: ${advisor.headline}\nRecommendation: ${advisor.recommendation}\nRisks: ${advisor.risks.join('; ')}\nNext step: ${advisor.nextStep}`,
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
            domain === 'trading' ? `${tradingEvidenceContract}\n\n` : ''
          }${councilQualityContract}\n\nYou are anonymously reviewing peer responses. Do not infer author names. Penalize generic advice, ungrounded claims, missing dissent, and invented evidence. Return only JSON with keys: strongest, blindSpot, missed.`,
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
            ? 'For trading, reject invented levels and return "not actionable" when current market context is insufficient. '
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
      advisor.recommendation,
      '',
      'Risks:',
      ...advisor.risks.map((risk) => `- ${risk}`),
      '',
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
              <textarea
                className="market-context"
                onChange={(event) => setMarketContext(event.target.value)}
                placeholder="Paste current price, timeframe, trend, support/resistance, volume, market backdrop, earnings/catalysts, current position, and max risk..."
                value={marketContext}
              />
              <p className="hint">
                Trading councils use only this context. If it is empty, the correct
                answer is insufficient data.
              </p>
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
                    <p>{advisor.recommendation}</p>
                    <ul>
                      {advisor.risks.map((risk) => (
                        <li key={risk}>{risk}</li>
                      ))}
                    </ul>
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
