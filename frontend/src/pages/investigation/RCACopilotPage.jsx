import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { ACTIVE_COPILOT_VERSION, DEFAULT_CLUSTER_ID, DEFAULT_QUERY } from '../../config';
import { useCopilotSession } from '../../hooks/useCopilotSession';
import { useClusterCatalog } from '../../hooks/useClusterCatalog';
import { useInvestigationQuestions } from '../../hooks/useInvestigationQuestions';
import { fetchInvestigationQuestions, sendChatMessage } from '../../services/copilotService';
import { createPageLogger } from '../../utils/pageLogger';

const quickActions = [
  {
    label: 'Generate Hypotheses',
    prompt: 'Generate all possible root cause hypotheses for this anomaly.',
    taskType: 'hypothesis',
  },
  {
    label: 'Anti-Gravity Thoughts',
    prompt: 'What are non-obvious causes for this issue? Challenge the current assumption.',
    taskType: 'challenge',
  },
  {
    label: 'Simulate Impact',
    prompt: 'Simulate impact if Line 4 continues operation vs quarantining now.',
    taskType: 'rca',
  },
];

const defaultInvestigationQuestions = [
  {
    text: 'Why did the temperature spike only after 10:30 UTC instead of at startup?',
    taskType: 'rca',
  },
  {
    text: 'Could contamination originate AFTER processing (e.g. reverse causality)?',
    taskType: 'challenge',
  },
  {
    text: 'Is Station L-04 sensor calibration actually faulty instead of a true temperature rise?',
    taskType: 'hypothesis',
  },
  {
    text: "Is this pattern strictly correlated with Supplier Titanium-V's recent lot changes?",
    taskType: 'citations',
  },
];
const pageLogger = createPageLogger('RCACopilotPage');

const sectionVisuals = {
  Summary: {
    accent: '#123a8c',
    chip: 'Brief',
    background: 'linear-gradient(155deg, rgba(18, 58, 140, 0.16), rgba(80, 140, 255, 0.05) 55%, rgba(255,255,255,0.94))',
  },
  Hypotheses: {
    accent: '#006780',
    chip: 'Signal',
    background: 'linear-gradient(155deg, rgba(0, 103, 128, 0.14), rgba(128, 229, 255, 0.08) 50%, rgba(255,255,255,0.96))',
  },
  'Reasoning Chain': {
    accent: '#0b6e4f',
    chip: 'Trace',
    background: 'linear-gradient(155deg, rgba(11, 110, 79, 0.14), rgba(145, 230, 194, 0.08) 52%, rgba(255,255,255,0.96))',
  },
  'Next Actions': {
    accent: '#9a6700',
    chip: 'Action',
    background: 'linear-gradient(155deg, rgba(154, 103, 0, 0.13), rgba(255, 211, 133, 0.08) 50%, rgba(255,255,255,0.97))',
  },
  'Anti-Gravity Challenge': {
    accent: '#7c3aed',
    chip: 'Counterpoint',
    background: 'linear-gradient(155deg, rgba(124, 58, 237, 0.13), rgba(216, 180, 254, 0.08) 50%, rgba(255,255,255,0.97))',
  },
  Conclusion: {
    accent: '#ba1a1a',
    chip: 'Verdict',
    background: 'linear-gradient(155deg, rgba(186, 26, 26, 0.16), rgba(255, 215, 213, 0.18) 50%, rgba(255,255,255,0.97))',
  },
};

function parseStructuredAiContent(content) {
  const sectionAliasMap = {
    hypotheses: 'Hypotheses',
    'reasoning chain': 'Reasoning Chain',
    'anti-gravity challenge': 'Anti-Gravity Challenge',
    'next actions': 'Next Actions',
    conclusion: 'Conclusion',
  };

  const sections = [];
  let currentSection = null;

  const lines = String(content || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  for (const rawLine of lines) {
    const inlineHeadingMatch = rawLine.match(/^([A-Za-z\s-]+):\s+(.+)$/);
    if (inlineHeadingMatch) {
      const normalizedHeading = inlineHeadingMatch[1].toLowerCase().trim();
      const label = sectionAliasMap[normalizedHeading] || inlineHeadingMatch[1].trim();
      currentSection = { label, type: normalizedHeading === 'conclusion' ? 'conclusion' : 'section', items: [] };
      sections.push(currentSection);
      currentSection.items.push({ kind: 'text', value: inlineHeadingMatch[2].trim() });
      continue;
    }

    const headingMatch = rawLine.match(/^([A-Za-z\s-]+):$/);
    if (headingMatch) {
      const normalizedHeading = headingMatch[1].toLowerCase().trim();
      const label = sectionAliasMap[normalizedHeading] || headingMatch[1].trim();
      currentSection = { label, type: normalizedHeading === 'conclusion' ? 'conclusion' : 'section', items: [] };
      sections.push(currentSection);
      continue;
    }

    if (!currentSection) {
      currentSection = { label: 'Summary', type: 'section', items: [] };
      sections.push(currentSection);
    }

    if (/^([•*-]|\d+[.)])$/.test(rawLine)) {
      continue;
    }

    const bulletMatch =
      rawLine.match(/^[-*]\s+(.*)$/) ||
      rawLine.match(/^•\s*(.*)$/) ||
      rawLine.match(/^\d+[.)]\s+(.*)$/);
    if (bulletMatch) {
      const bulletValue = (bulletMatch[1] || '').trim();
      if (bulletValue) {
        currentSection.items.push({ kind: 'bullet', value: bulletValue });
      }
      continue;
    }

    currentSection.items.push({ kind: 'text', value: rawLine });
  }

  return sections;
}

function normalizeSectionLabel(rawLabel) {
  const normalized = String(rawLabel || '').toLowerCase().trim();
  if (normalized === 'hypotheses') return 'Hypotheses';
  if (normalized === 'reasoning chain') return 'Reasoning Chain';
  if (normalized === 'anti-gravity challenge') return 'Anti-Gravity Challenge';
  if (normalized === 'next actions') return 'Next Actions';
  if (normalized === 'conclusion') return 'Conclusion';
  if (normalized === 'summary') return 'Summary';
  return rawLabel;
}

function splitIntoAtomicItems(value) {
  const raw = String(value || '')
    .replace(/\r/g, ' ')
    .replace(/\n+/g, ' ')
    .replace(/\[[A-Z]+-[A-Z0-9_-]+\]/g, ' ')
    .trim();

  if (!raw) {
    return [];
  }

  const fragments = [];
  const firstBracketIndex = raw.indexOf('[');
  const bracketContents = [...raw.matchAll(/\[([^\]]+)\]/g)]
    .map(match => sanitizeModelText(match[1] || ''))
    .filter(Boolean)
    .filter(fragment => fragment.length > 24)
    .filter(fragment => !/^(db-|sku:|ticket:|cluster:)/i.test(fragment));

  if (firstBracketIndex > 0 && bracketContents.length > 0) {
    const prefix = raw.slice(0, firstBracketIndex).trim();
    if (prefix) {
      fragments.push(prefix);
    }
  }

  if (bracketContents.length > 0) {
    fragments.push(...bracketContents);
  }

  if (fragments.length === 0 && /\d+\.\s+/.test(raw)) {
    fragments.push(...raw.split(/(?=\d+\.\s+)/g));
  }

  if (fragments.length === 0) {
    fragments.push(raw);
  }

  return fragments
    .map(fragment =>
      sanitizeModelText(
        fragment
          .replace(/^\s*[-*•]\s*/, '')
          .replace(/^\s*\d+\.\s*/, '')
          .replace(/^\[\s*/, '')
          .replace(/\]\s*,?/g, '')
          .replace(/\bDB-[A-Z0-9_-]+\b/gi, '')
          .trim()
      )
    )
    .map(fragment => fragment.replace(/^[,;:\s]+/, '').replace(/[,\s]+$/, '').trim())
    .filter(Boolean)
    .filter(fragment => fragment.length > 16)
    .filter(fragment => !/^(db-|sku:|ticket:|cluster:|confidence|evidence from)/i.test(fragment));
}

function buildSectionsFromObject(obj) {
  const sections = [];
  const entries = Object.entries(obj || {});

  for (const [rawKey, rawValue] of entries) {
    const label = normalizeSectionLabel(rawKey);
    const keyNormalized = String(rawKey).toLowerCase().trim();
    const section = { label, type: keyNormalized === 'conclusion' ? 'conclusion' : 'section', items: [] };

    if (Array.isArray(rawValue)) {
      for (const item of rawValue) {
        if (typeof item === 'string') {
          const fragments = splitIntoAtomicItems(item);
          fragments.forEach(fragment => {
            section.items.push({ kind: 'bullet', value: fragment });
          });
          continue;
        }

        if (item && typeof item === 'object') {
          const title = sanitizeModelText(item.title || item.hypothesis || item.text || '');
          const confidence = sanitizeModelText(item.confidence || item.score || '');
          const value = title
            ? confidence
              ? `${title} (${String(confidence).replace(/[()]/g, '')})`
              : title
            : sanitizeModelText(JSON.stringify(item));
          splitIntoAtomicItems(value).forEach(fragment => {
            section.items.push({ kind: 'bullet', value: fragment });
          });
          continue;
        }

        splitIntoAtomicItems(String(item || '')).forEach(fragment => {
          section.items.push({ kind: 'bullet', value: fragment });
        });
      }
    } else if (rawValue && typeof rawValue === 'object') {
      const value = sanitizeModelText(JSON.stringify(rawValue));
      if (value) section.items.push({ kind: 'text', value });
    } else {
      splitIntoAtomicItems(String(rawValue || '')).forEach(fragment => {
        section.items.push({ kind: 'text', value: fragment });
      });
    }

    if (section.items.length > 0) {
      sections.push(section);
    }
  }

  return sections;
}

function parseJsonLikeContent(content) {
  const raw = String(content || '').trim();
  if (!raw || (!raw.startsWith('{') && !raw.startsWith('['))) {
    return null;
  }

  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const cleaned = raw
      .replace(/```json|```/gi, '')
      .replace(/\/\/.*$/gm, '')
      .trim();
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      parsed = null;
    }
  }

  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  if (Array.isArray(parsed)) {
    return [
      {
        label: 'Summary',
        type: 'section',
        items: parsed.map(item => ({ kind: 'bullet', value: sanitizeModelText(String(item || '')) })).filter(item => item.value),
      },
    ];
  }

  return buildSectionsFromObject(parsed);
}

function normalizeForDedupe(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function shouldHideSectionInChat(sectionLabel, metadata = {}) {
  const normalized = String(sectionLabel || '').toLowerCase().trim();
  if (normalized === 'hypotheses' && Array.isArray(metadata.hypotheses) && metadata.hypotheses.length > 0) {
    return true;
  }
  if (normalized === 'reasoning chain' && Array.isArray(metadata.reasoning_chain) && metadata.reasoning_chain.length > 0) {
    return true;
  }
  if (normalized === 'anti-gravity challenge' && metadata.anti_gravity_challenge) {
    return true;
  }
  if (normalized === 'next actions' && Array.isArray(metadata.next_actions) && metadata.next_actions.length > 0) {
    return true;
  }
  return false;
}

function dedupeSectionItems(items = []) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = `${item.kind}:${normalizeForDedupe(item.value)}`;
    if (!item?.value || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
  }
  return result;
}

function sanitizeModelText(value) {
  let cleaned = String(value || '');
  cleaned = cleaned.replace(/\[\s*confidence\s+at\s+least\s+around[^\]]*\]/gi, '');
  cleaned = cleaned.replace(/\bconfidence\s*%\s*based\s*on\s*frequency\b/gi, '');
  cleaned = cleaned.replace(/^\s*Hypotheses\s*:\s*/i, '');
  cleaned = cleaned.split(/\b(?:Reasoning Chain|Next Actions|Anti-Gravity Challenge|Conclusion)\s*:/i)[0];
  cleaned = cleaned.replace(/^"+|"+$/g, '');
  cleaned = cleaned.replace(/\s*\]{1,}\s*$/g, '');
  cleaned = cleaned.replace(/\s{2,}/g, ' ');
  cleaned = cleaned.replace(/\s+([.,;:!?])/g, '$1');
  return cleaned.trim();
}

function isNearDuplicateText(primary, comparison) {
  const left = normalizeForDedupe(sanitizeModelText(primary));
  const right = normalizeForDedupe(sanitizeModelText(comparison));

  if (!left || !right) {
    return false;
  }

  return left === right || left.includes(right) || right.includes(left);
}

function deriveConfidence(title, confidence, fallback) {
  if (typeof confidence === 'number') {
    return Math.round(confidence * 100);
  }
  const fromText = String(title || '').match(/(\d{1,3})\s*%/);
  if (fromText) {
    return Number(fromText[1]);
  }
  return fallback;
}

function splitReasoningContent(lines = []) {
  const reasoning = [];
  const challenge = [];
  const nextActions = [];

  for (const raw of lines) {
    const line = sanitizeModelText(raw);
    if (!line) {
      continue;
    }

    if (/^anti-gravity challenge\s*:/i.test(line)) {
      challenge.push(line.replace(/^anti-gravity challenge\s*:/i, '').trim());
      continue;
    }

    if (/^(targeted containment specifics|verification step tied directly back)\s*:/i.test(line)) {
      nextActions.push(
        line.replace(/^(targeted containment specifics|verification step tied directly back)\s*:/i, '').trim()
      );
      continue;
    }

    reasoning.push(line);
  }

  return { reasoning, challenge, nextActions };
}

function renderPlainAiMessage(content) {
  const items = splitIntoAtomicItems(content);

  if (!items.length) {
    return null;
  }

  return (
    <div style={{ display: 'grid', gap: '0.5rem' }}>
      {items.map((item, index) => (
        <div
          key={`${item.slice(0, 24)}-${index}`}
          style={{
            position: 'relative',
            overflow: 'hidden',
            borderRadius: '16px',
            border: '1px solid rgba(18, 26, 48, 0.08)',
            background: 'linear-gradient(155deg, rgba(255,255,255,0.96), rgba(241,246,255,0.94) 58%, rgba(220,234,255,0.82))',
            padding: '0.78rem 0.88rem',
            boxShadow: '0 14px 24px rgba(12, 28, 68, 0.08), inset 0 1px 0 rgba(255,255,255,0.88)',
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: '0 0 auto 0',
              height: '44%',
              background: 'linear-gradient(180deg, rgba(255,255,255,0.48), rgba(255,255,255,0))',
              pointerEvents: 'none',
            }}
          />
          <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: '20px 1fr', gap: '0.55rem' }}>
            <span
              style={{
                width: 20,
                height: 20,
                borderRadius: '999px',
                background: 'var(--secondary)',
                color: '#fff',
                fontSize: 11,
                fontWeight: 800,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 8px 18px rgba(0, 103, 128, 0.25)',
              }}
            >
              {index + 1}
            </span>
            <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.58 }}>
              {item}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

function buildSyntheticReasoningSteps(metadata = {}, replySummary = '') {
  const hypotheses = Array.isArray(metadata.hypotheses) ? metadata.hypotheses : [];
  const citations = Array.isArray(metadata.citations) ? metadata.citations : [];
  const nextActions = Array.isArray(metadata.next_actions) ? metadata.next_actions : [];
  const steps = [];

  if (citations.length > 0) {
    const citationIds = citations
      .map(citation => sanitizeModelText(citation?.id || citation?.source || ''))
      .filter(Boolean)
      .slice(0, 2)
      .join(', ');
    if (citationIds) {
      steps.push(`Evidence is anchored to ${citationIds}, so the investigation starts from concrete ticket and cluster signals.`);
    }
  }

  if (hypotheses.length > 0) {
    const leadHypothesis = sanitizeModelText(String(hypotheses[0]?.title || '').split(':')[0]);
    if (leadHypothesis) {
      steps.push(`The leading hypothesis points to ${leadHypothesis}, which becomes the primary line of inquiry.`);
    }
  }

  if (nextActions.length > 0) {
    const firstAction = sanitizeModelText(nextActions[0]);
    if (firstAction) {
      steps.push(`The next validation step is ${firstAction}, which should confirm or eliminate the primary hypothesis.`);
    }
  } else if (replySummary) {
    const shortReply = sanitizeModelText(replySummary).split('. ')[0];
    if (shortReply) {
      steps.push(`The current summary indicates ${shortReply}, so verification should focus on confirming that causal path.`);
    }
  }

  return dedupeSectionItems(steps.map(value => ({ kind: 'bullet', value }))).map(item => item.value).slice(0, 4);
}

function renderStructuredAiMessage(content, metadata) {
  const hasStructuredMetadata =
    (Array.isArray(metadata?.hypotheses) && metadata.hypotheses.length > 0) ||
    (Array.isArray(metadata?.reasoning_chain) && metadata.reasoning_chain.length > 0) ||
    (Array.isArray(metadata?.next_actions) && metadata.next_actions.length > 0) ||
    Boolean(metadata?.anti_gravity_challenge);

  const isJsonLikeDump =
    /^[\[{]/.test(String(content || '').trim()) ||
    /["']?(reply|hypotheses|title|confidence|reasoning_chain|next_actions|anti_gravity_challenge)["']?\s*:/i.test(
      String(content || '')
    );

  // If model returned a raw JSON-like dump, rely on structured metadata cards instead.
  if (hasStructuredMetadata && isJsonLikeDump) {
    return null;
  }

  const parsedSections = parseJsonLikeContent(content) || parseStructuredAiContent(content);
  const visibleSections = parsedSections
    .filter(section => !shouldHideSectionInChat(section.label, metadata))
    .map(section => ({ ...section, items: dedupeSectionItems(section.items) }))
    .filter(section => section.items.length > 0);

  if (!visibleSections.length) {
    return null;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
      {visibleSections.map((section, sectionIndex) => {
        const isConclusion = section.type === 'conclusion';
        const stylePreset = sectionVisuals[section.label] || sectionVisuals.Summary;
        return (
          <div
            key={`${section.label}-${sectionIndex}`}
            style={{
              position: 'relative',
              overflow: 'hidden',
              border: `1px solid ${isConclusion ? 'rgba(186, 26, 26, 0.3)' : 'rgba(18, 26, 48, 0.08)'}`,
              background: stylePreset.background,
              borderRadius: '16px',
              padding: '0.85rem 0.92rem',
              boxShadow: '0 16px 30px rgba(12, 28, 68, 0.10), inset 0 1px 0 rgba(255,255,255,0.85)',
              backdropFilter: 'blur(12px)',
            }}
          >
            <div
              style={{
                position: 'absolute',
                inset: '0 0 auto 0',
                height: '38%',
                background: 'linear-gradient(180deg, rgba(255,255,255,0.45), rgba(255,255,255,0))',
                pointerEvents: 'none',
              }}
            />
            <p
              style={{
                position: 'relative',
                margin: 0,
                marginBottom: '0.35rem',
                fontSize: 11,
                fontWeight: 800,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: stylePreset.accent,
              }}
            >
              {section.label}
            </p>
            <span
              style={{
                position: 'relative',
                display: 'inline-flex',
                marginBottom: '0.55rem',
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: stylePreset.accent,
                background: 'rgba(255,255,255,0.68)',
                border: `1px solid ${stylePreset.accent}22`,
                borderRadius: '999px',
                padding: '0.18rem 0.45rem',
              }}
            >
              {stylePreset.chip}
            </span>

            <div style={{ position: 'relative', display: 'grid', gap: '0.45rem' }}>
              {section.items.map((item, itemIndex) =>
                item.kind === 'bullet' ? (
                  <div
                    key={`${section.label}-bullet-${itemIndex}`}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '20px 1fr',
                      gap: '0.55rem',
                      alignItems: 'start',
                      padding: '0.48rem 0.55rem',
                      borderRadius: '12px',
                      background: 'rgba(255,255,255,0.62)',
                      border: '1px solid rgba(255,255,255,0.58)',
                    }}
                  >
                    <span
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: '999px',
                        background: stylePreset.accent,
                        color: '#fff',
                        fontSize: 11,
                        fontWeight: 800,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: `0 8px 18px ${stylePreset.accent}33`,
                      }}
                    >
                      {itemIndex + 1}
                    </span>
                    <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55 }}>{item.value}</p>
                  </div>
                ) : (
                  <p
                    key={`${section.label}-text-${itemIndex}`}
                    style={{
                      margin: 0,
                      padding: '0.5rem 0.58rem',
                      borderRadius: '12px',
                      background: 'rgba(255,255,255,0.58)',
                      border: '1px solid rgba(255,255,255,0.54)',
                      fontSize: 13.5,
                      lineHeight: 1.6,
                    }}
                  >
                    {item.value}
                  </p>
                )
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function renderCitationBadges(citations = []) {
  if (!citations.length) {
    return null;
  }

  return (
    <div style={{ marginTop: '0.5rem', display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
      {citations.map((citation, index) => (
        <span
          key={`${citation.id || 'citation'}-${index}`}
          title={citation.excerpt || citation.source || citation.id}
          style={{
            fontSize: 11,
            borderRadius: 'var(--radius-full)',
            border: '1px solid var(--outline-variant)',
            padding: '0.15rem 0.5rem',
            color: 'var(--on-surface-variant)',
            background: 'var(--surface)',
          }}
        >
          {citation.id || 'SOURCE'}
        </span>
      ))}
    </div>
  );
}

export default function RCACopilotPage() {
  const location = useLocation();
  const [, setSearchParams] = useSearchParams();
  const {
    clusters,
    selectedClusterId,
    setSelectedClusterId,
  } = useClusterCatalog({
    initialClusterId: DEFAULT_CLUSTER_ID || '',
    logger: pageLogger,
    channelKey: 'rca-clusters',
  });
  const [input, setInput] = useState(DEFAULT_QUERY || '');
  const initialMessages = useMemo(
    () => [
      {
        role: 'ai',
        content: 'I am ready. Ask me to trace suspect lots, summarize evidence, or map SOP-aligned actions.',
      },
    ],
    []
  );
  const [messages, setMessages] = useCopilotSession(`rca-copilot-${selectedClusterId}`, initialMessages);
  const [isLoading, setIsLoading] = useState(false);
  const [activeQuestionContext, setActiveQuestionContext] = useState(null);
  const chatScrollRef = useRef(null);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const prompt = params.get('prompt') || params.get('query');
    const clusterFromUrl = params.get('cluster_id');
    const autoSubmit = params.get('auto_submit') === 'true';

    if (prompt) {
      setInput(prompt);
      if (autoSubmit && clusterFromUrl) {
        setTimeout(() => {
          void sendPrompt(prompt, 'rca');
        }, 250);
      }
    } else if (!input && DEFAULT_QUERY) {
      setInput(DEFAULT_QUERY);
    }

    if (clusterFromUrl) {
      setSelectedClusterId(clusterFromUrl);
      pageLogger.info('Applied cluster from URL params', { cluster_id: clusterFromUrl });
    }
  }, [location.search]);

  useEffect(() => {
    setSearchParams(current => {
      const next = new URLSearchParams(current);
      if (selectedClusterId) {
        next.set('cluster_id', selectedClusterId);
      }
      return next;
    });
  }, [selectedClusterId, setSearchParams]);

  const activeCluster = useMemo(
    () => clusters.find(cluster => cluster.cluster_id === selectedClusterId),
    [clusters, selectedClusterId]
  );
  const { investigationQuestions, setInvestigationQuestions, isRefreshingQuestions } = useInvestigationQuestions({
    selectedClusterId,
    availableClusterIds: clusters.map(cluster => cluster.cluster_id),
    fallbackQuestions: defaultInvestigationQuestions,
    logger: pageLogger,
    count: 4,
  });

  const latestAiMessage = useMemo(
    () => [...messages].reverse().find(message => message.role === 'ai' && message.metadata) || null,
    [messages]
  );
  const latestMetadata = latestAiMessage?.metadata || {};

  const hypothesisCards = useMemo(() => {
    const items = Array.isArray(latestMetadata.hypotheses) ? latestMetadata.hypotheses : [];
    return items
      .slice(0, 3)
      .map((hypothesis, idx) => {
        const rawTitle = hypothesis?.title || '';
        const title = sanitizeModelText(rawTitle.replace(/\(\s*\d{1,3}\s*%\s*\)/g, '').trim());
        const confidence = deriveConfidence(rawTitle, hypothesis?.confidence, idx === 0 ? 92 : idx === 1 ? 61 : 35);
        return { title, confidence, idx };
      })
      .filter(card => card.title);
  }, [latestMetadata.hypotheses]);

  const reasoningData = useMemo(() => {
    const reasoningLines = Array.isArray(latestMetadata.reasoning_chain) ? latestMetadata.reasoning_chain : [];
    const split = splitReasoningContent(reasoningLines);
    const replySummary = sanitizeModelText(latestAiMessage?.content || '');

    if (latestMetadata.anti_gravity_challenge) {
      split.challenge.unshift(sanitizeModelText(latestMetadata.anti_gravity_challenge));
    }
    if (Array.isArray(latestMetadata.next_actions)) {
      split.nextActions.unshift(...latestMetadata.next_actions.map(action => sanitizeModelText(action)));
    }

    const challengeText = split.challenge.filter(Boolean)[0] || null;
    const nextActions = split.nextActions.filter(Boolean).slice(0, 2);
    let reasoning = split.reasoning
      .map(step => sanitizeModelText(step))
      .filter(Boolean)
      .filter(step => !isNearDuplicateText(step, replySummary))
      .filter(step => !isNearDuplicateText(step, challengeText))
      .filter(step => !nextActions.some(action => isNearDuplicateText(step, action)))
      .filter(step => step.length < 220)
      .slice(0, 4);

    if (reasoning.length === 0) {
      reasoning = buildSyntheticReasoningSteps(latestMetadata, replySummary);
    }

    return {
      reasoning,
      challenge: challengeText,
      nextActions,
    };
  }, [latestAiMessage?.content, latestMetadata.reasoning_chain, latestMetadata.anti_gravity_challenge, latestMetadata.next_actions]);

  useEffect(() => {
    if (!chatScrollRef.current) {
      return;
    }
    chatScrollRef.current.scrollTo({
      top: chatScrollRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages, isLoading]);

  const sendPrompt = async (promptText, taskType = 'rca') => {
    const text = String(promptText || '').trim();
    if (!text || isLoading) {
      return;
    }

    setActiveQuestionContext({ text, taskType });
    const nextMessages = [...messages, { role: 'user', content: text }];
    setMessages(nextMessages);
    setInput('');
    setIsLoading(true);

    try {
      const payload = await sendChatMessage(text, selectedClusterId, taskType, 2, 250);
      setMessages([
        ...nextMessages,
        {
          role: 'ai',
          content: payload.reply || 'Unknown: no response content.',
          metadata: {
            asked_question: text,
            task_type: taskType,
            citations: Array.isArray(payload.citations) ? payload.citations : [],
            hypotheses: Array.isArray(payload.hypotheses) ? payload.hypotheses : [],
            reasoning_chain: Array.isArray(payload.reasoning_chain) ? payload.reasoning_chain : [],
            next_actions: Array.isArray(payload.next_actions) ? payload.next_actions : [],
            anti_gravity_challenge: payload.anti_gravity_challenge || null,
            mode: payload.mode || null,
            timing_ms: Number.isFinite(payload.timing_ms) ? payload.timing_ms : null,
            request_id: payload.request_id || null,
            model: payload.model || null,
            confidence: typeof payload.confidence === 'number' ? payload.confidence : null,
          },
        },
      ]);
    } catch (err) {
      setMessages([
        ...nextMessages,
        {
          role: 'ai',
          content: `Error reaching copilot: ${err instanceof Error ? err.message : 'Unknown network error'}`,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const refreshInvestigationQuestions = async () => {
    if (!selectedClusterId || isRefreshingQuestions || isLoading) {
      return;
    }
    try {
      const payload = await pageLogger.trackFetch(
        'manual investigation question refresh',
        () => fetchInvestigationQuestions(selectedClusterId, 4),
        { cluster_id: selectedClusterId }
      );
      if (Array.isArray(payload) && payload.length > 0) {
        setInvestigationQuestions(
          payload.map((item, index) => ({
            text: item?.text || defaultInvestigationQuestions[index % defaultInvestigationQuestions.length].text,
            taskType: item?.task_type || defaultInvestigationQuestions[index % defaultInvestigationQuestions.length].taskType,
          }))
        );
      }
    } catch (err) {
      pageLogger.error('Failed to manually refresh investigation questions', {
        cluster_id: selectedClusterId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <div className="rca-shell">
      <section className="rca-left custom-scroll">
        <div style={{ marginBottom: '2rem' }}>
          <p
            style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: 'var(--secondary)',
              marginBottom: '0.25rem',
            }}
          >
            RCA Copilot Workspace (v{ACTIVE_COPILOT_VERSION})
          </p>
          <h1
            style={{
              fontSize: '1.875rem',
              fontWeight: 800,
              letterSpacing: '-0.02em',
              marginBottom: '0.5rem',
            }}
          >
            Glass-Box Investigation Canvas
          </h1>
          <p style={{ color: 'var(--on-surface-variant)' }}>
            Grounded reasoning, traceability hints, and SOP-aware next actions for active quality investigations.
          </p>
        </div>

        <article
          className="card"
          style={{
            padding: '1.5rem',
            marginBottom: '2rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: '1rem',
          }}
        >
          <div>
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--on-surface-variant)',
                display: 'block',
                marginBottom: '0.25rem',
              }}
            >
              Active Investigation
            </span>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.5rem' }}>
              {activeCluster?.title || 'Batch #4419 Thermal Variance'}
            </h2>
            <p style={{ fontSize: 14, color: 'var(--on-surface-variant)', lineHeight: 1.6 }}>
              {activeCluster?.ai_summary ||
                'Rising thermal drift correlated with post-maintenance run window.'}
            </p>
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
              gap: '0.25rem',
              flexShrink: 0,
              background: 'var(--error-container)',
              padding: '0.5rem 0.75rem',
              borderRadius: 'var(--radius-md)',
            }}
          >
            <strong style={{ color: 'var(--on-error-container)', fontSize: 14 }}>
              {activeCluster?.severity || 'Critical'}
            </strong>
            <small style={{ fontSize: 11, color: 'var(--on-error-container)', opacity: 0.8 }}>
              detected 4h ago
            </small>
          </div>
        </article>

        <article
          className="card"
          style={{
            padding: '1.5rem',
            marginBottom: '1.5rem',
            border: '1px solid var(--primary)',
            background: 'linear-gradient(to right, rgba(0,35,111,0.02), transparent)',
          }}
          >
            <div
              style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              marginBottom: '1rem',
              color: 'var(--primary)',
            }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 24 }}>
                psychology
              </span>
              <h3 style={{ fontSize: '1.125rem', fontWeight: 800 }}>AI Investigation Engine</h3>
            <button
              type="button"
              onClick={() => void refreshInvestigationQuestions()}
              disabled={isRefreshingQuestions || isLoading}
              style={{
                marginLeft: 'auto',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                borderRadius: '999px',
                border: '1px solid rgba(18, 58, 140, 0.18)',
                padding: '0.38rem 0.72rem',
                background: 'rgba(255,255,255,0.72)',
                color: 'var(--primary)',
                fontSize: 12,
                fontWeight: 800,
                cursor: isRefreshingQuestions || isLoading ? 'not-allowed' : 'pointer',
                opacity: isRefreshingQuestions || isLoading ? 0.65 : 1,
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                refresh
              </span>
              {isRefreshingQuestions ? 'Refreshing…' : 'Refresh Questions'}
            </button>
            <span
              style={{
                fontSize: 10,
                background: 'var(--primary-container)',
                color: 'var(--on-primary-container)',
                padding: '0.25rem 0.5rem',
                borderRadius: '4px',
                fontWeight: 700,
                letterSpacing: '0.05em',
              }}
            >
              AUTONOMOUS
            </span>
            </div>

            {activeQuestionContext ? (
              <div
                style={{
                  marginBottom: '1rem',
                  padding: '0.85rem 1rem',
                  borderRadius: 'var(--radius-md)',
                  background: 'rgba(0, 103, 128, 0.06)',
                  border: '1px solid rgba(0, 103, 128, 0.12)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: 12, color: 'var(--secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Answering Now
                  </strong>
                  <span style={{ fontSize: 11, color: 'var(--on-surface-variant)' }}>
                    Mode: {activeQuestionContext.taskType}
                  </span>
                </div>
                <p style={{ marginTop: '0.4rem', fontSize: 14, lineHeight: 1.5 }}>
                  {activeQuestionContext.text}
                </p>
              </div>
            ) : null}

          <div className="rca-investigation-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            {investigationQuestions.map((question, idx) => (
              <button
                type="button"
                key={question.text}
                disabled={isLoading}
                onClick={() => {
                  setInput(question.text);
                  void sendPrompt(question.text, question.taskType);
                }}
                style={{
                  display: 'block',
                  width: '100%',
                  background: 'var(--surface)',
                  padding: '1rem',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid rgba(0, 103, 128, 0.12)',
                  borderLeft: '3px solid var(--secondary)',
                  boxShadow: 'var(--shadow-sm)',
                  textAlign: 'left',
                  transition: 'transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease',
                  cursor: isLoading ? 'not-allowed' : 'pointer',
                  opacity: isLoading ? 0.65 : 1,
                  whiteSpace: 'normal',
                  overflow: 'visible',
                  wordBreak: 'break-word',
                  lineHeight: 1.45,
                }}
                onMouseEnter={event => {
                  if (!isLoading) {
                    event.currentTarget.style.transform = 'translateY(-1px)';
                    event.currentTarget.style.boxShadow = '0 8px 18px rgba(0, 35, 111, 0.08)';
                    event.currentTarget.style.borderColor = 'rgba(0, 103, 128, 0.28)';
                  }
                }}
                onMouseLeave={event => {
                  event.currentTarget.style.transform = 'translateY(0)';
                  event.currentTarget.style.boxShadow = 'var(--shadow-sm)';
                  event.currentTarget.style.borderColor = 'rgba(0, 103, 128, 0.12)';
                }}
              >
                <strong
                  style={{
                    fontSize: 11,
                    color: 'var(--secondary)',
                    display: 'block',
                    marginBottom: '0.25rem',
                    textTransform: 'uppercase',
                  }}
                >
                  Question {idx + 1}
                </strong>
                <span
                  style={{
                    display: 'block',
                    width: '100%',
                    fontSize: 14,
                    color: 'var(--on-surface)',
                    fontWeight: 500,
                    lineHeight: 1.45,
                    whiteSpace: 'normal',
                    overflowWrap: 'anywhere',
                    wordBreak: 'break-word',
                  }}
                >
                  {question.text}
                </span>
              </button>
            ))}
          </div>
        </article>

        <div className="rca-analysis-grid" style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
          <article className="card" style={{ padding: '1.5rem', background: 'var(--surface-container-lowest)' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 800, marginBottom: '1.25rem', color: 'var(--on-surface)' }}>
              Multi-Step Reasoning Chain
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem', position: 'relative' }}>
              <div
                style={{
                  position: 'absolute',
                  left: '17px',
                  top: '18px',
                  bottom: '108px',
                  width: '3px',
                  borderRadius: '999px',
                  background: 'linear-gradient(180deg, rgba(0,103,128,0.18), rgba(18,58,140,0.45), rgba(124,58,237,0.12))',
                }}
              />

              {(reasoningData.reasoning.length > 0 ? reasoningData.reasoning : [])
                .slice(0, 4)
                .map((step, idx) => (
                  <div key={`${step}-${idx}`} style={{ display: 'grid', gridTemplateColumns: '24px 1fr', alignItems: 'start', gap: '0.875rem', zIndex: 1 }}>
                    <div
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: '50%',
                        background: idx === 0 ? 'linear-gradient(180deg, #0f7ea0, #0b5a78)' : 'linear-gradient(180deg, #123a8c, #0b2d6e)',
                        color: 'white',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 12,
                        fontWeight: 700,
                        boxShadow: '0 10px 18px rgba(18, 58, 140, 0.22)',
                      }}
                    >
                      {idx + 1}
                    </div>
                    <div
                      style={{
                        padding: '0.78rem 0.9rem',
                        borderRadius: '16px',
                        border: '1px solid rgba(18, 26, 48, 0.08)',
                        background: 'linear-gradient(155deg, rgba(255,255,255,0.95), rgba(240,247,255,0.92) 58%, rgba(214,237,255,0.68))',
                        boxShadow: '0 18px 28px rgba(10, 30, 68, 0.08), inset 0 1px 0 rgba(255,255,255,0.9)',
                      }}
                    >
                      <span style={{ display: 'block', fontSize: 11, fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--secondary)', marginBottom: '0.2rem' }}>
                        Step {idx + 1}
                      </span>
                      <span style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.55 }}>{step}</span>
                    </div>
                  </div>
                ))}

              {reasoningData.reasoning.length === 0 ? (
                <div
                  style={{
                    marginLeft: '2.2rem',
                    border: '1px dashed var(--outline-variant)',
                    borderRadius: 'var(--radius-md)',
                    background: 'linear-gradient(145deg, rgba(255,255,255,0.96), rgba(243,246,251,0.9))',
                    padding: '0.65rem 0.75rem',
                    color: 'var(--on-surface-variant)',
                    fontSize: 14,
                  }}
                >
                  No reasoning chain returned for this question yet.
                </div>
              ) : null}

              {reasoningData.challenge ? (
                <div
                  style={{
                    marginTop: '0.35rem',
                    marginLeft: '2.2rem',
                    border: '1px solid rgba(124, 58, 237, 0.18)',
                    borderRadius: '16px',
                    background: 'linear-gradient(155deg, rgba(124, 58, 237, 0.12), rgba(255,255,255,0.95) 60%)',
                    padding: '0.8rem 0.9rem',
                    boxShadow: '0 16px 26px rgba(71, 45, 123, 0.08)',
                  }}
                >
                  <span style={{ fontSize: 11, fontWeight: 800, color: '#6d28d9', textTransform: 'uppercase' }}>
                    Anti-Gravity Challenge
                  </span>
                  <p style={{ margin: '0.25rem 0 0', fontSize: 14 }}>{reasoningData.challenge}</p>
                </div>
              ) : null}

              {reasoningData.nextActions.length > 0 ? (
                <div style={{ marginLeft: '2.2rem', display: 'grid', gap: '0.5rem' }}>
                  {reasoningData.nextActions.map((action, actionIdx) => (
                    <div
                      key={`${action}-${actionIdx}`}
                      style={{
                        border: '1px solid rgba(154, 103, 0, 0.16)',
                        borderRadius: '16px',
                        background: 'linear-gradient(155deg, rgba(255,246,224,0.76), rgba(255,255,255,0.94))',
                        padding: '0.68rem 0.75rem',
                        fontSize: 14,
                        boxShadow: '0 14px 24px rgba(154, 103, 0, 0.07)',
                      }}
                    >
                      {action}
                    </div>
                  ))}
                </div>
              ) : null}

              <div
                style={{
                  marginTop: '0.5rem',
                  padding: '0.9rem',
                  background: 'linear-gradient(155deg, rgba(255, 228, 226, 0.94), rgba(255,255,255,0.96))',
                  borderRadius: '18px',
                  border: '1px solid rgba(186, 26, 26, 0.14)',
                  marginLeft: '2.2rem',
                  display: 'inline-block',
                  boxShadow: '0 18px 30px rgba(186, 26, 26, 0.10)',
                }}
              >
                <span
                  style={{
                    fontSize: 11,
                    color: 'var(--error)',
                    display: 'block',
                    fontWeight: 800,
                    textTransform: 'uppercase',
                    marginBottom: '0.25rem',
                  }}
                >
                  → Final Root Cause
                </span>
                <span style={{ fontSize: 15, color: '#8f1313', fontWeight: 700, lineHeight: 1.45 }}>
                  {hypothesisCards[0]?.title || 'Awaiting RCA conclusion'}
                </span>
              </div>
            </div>
          </article>
        </div>
      </section>

      <aside className="rca-chat">
        <header
          style={{
            padding: '1.5rem',
            borderBottom: '1px solid var(--surface-container)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
          }}
        >
          <div>
            <h2 style={{ fontWeight: 700, fontSize: '1.125rem' }}>RCA Copilot</h2>
            <span style={{ fontSize: 11, color: 'var(--secondary)', fontWeight: 600 }}>System grounded</span>
          </div>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--on-surface-variant)' }}>Cluster</span>
            <select
              value={selectedClusterId}
              onChange={event => setSelectedClusterId(event.target.value)}
              disabled={isLoading}
              style={{
                padding: '0.25rem 0.5rem',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--outline-variant)',
                fontSize: 13,
                fontFamily: 'var(--font-mono)',
                background: 'white',
                outline: 'none',
              }}
            >
              {clusters.map(cluster => (
                <option key={cluster.cluster_id} value={cluster.cluster_id}>
                  {cluster.cluster_id}
                </option>
              ))}
            </select>
          </label>
        </header>

        <div
          ref={chatScrollRef}
          className="rca-chat-messages custom-scroll"
          style={{
            padding: '1.5rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
          }}
        >
          {messages.map((msg, i) => (
            <div
              key={`${msg.role}-${i}`}
              style={{
                alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '85%',
                padding: '0.75rem 1rem',
                borderRadius: 'var(--radius-xl)',
                background:
                  msg.role === 'user'
                    ? 'linear-gradient(180deg, #16398d, #0e2b6d)'
                    : 'linear-gradient(160deg, rgba(255,255,255,0.96), rgba(240,245,255,0.95) 55%, rgba(225,236,255,0.88))',
                color: msg.role === 'user' ? 'white' : 'var(--on-surface)',
                fontSize: 14,
                lineHeight: 1.6,
                boxShadow: msg.role === 'user' ? '0 14px 24px rgba(18,58,140,0.24)' : '0 18px 30px rgba(12, 28, 68, 0.08)',
                border: msg.role === 'user' ? 'none' : '1px solid rgba(18, 26, 48, 0.08)',
              }}
            >
              {msg.role === 'ai' ? (
                <>
                  {renderStructuredAiMessage(msg.content, msg.metadata) || renderPlainAiMessage(msg.content)}
                  {renderCitationBadges(msg.metadata?.citations || [])}
                  {msg.metadata?.timing_ms ? (
                    <p style={{ margin: '0.45rem 0 0', fontSize: 11, color: 'var(--outline)' }}>
                      {msg.metadata?.mode || 'live'} mode • {msg.metadata.timing_ms} ms
                    </p>
                  ) : null}
                </>
              ) : (
                msg.content
              )}
            </div>
          ))}

          {isLoading ? (
            <div
              style={{
                alignSelf: 'flex-start',
                padding: '0.75rem 1rem',
                borderRadius: 'var(--radius-xl)',
                background: 'var(--surface-container-low)',
                fontSize: 14,
                fontStyle: 'italic',
                color: 'var(--outline)',
              }}
            >
              Analyzing traceability and SOP context...
            </div>
          ) : null}
        </div>

        <div
          style={{
            padding: '0.75rem 1rem',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '0.5rem',
            borderTop: '1px solid var(--surface-container)',
          }}
        >
          {quickActions.map(action => (
            <button
              key={action.label}
              onClick={() => sendPrompt(action.prompt, action.taskType)}
              disabled={isLoading}
              style={{
                padding: '0.375rem 0.75rem',
                borderRadius: 'var(--radius-full)',
                border: '1px solid var(--outline-variant)',
                fontSize: 12,
                fontWeight: 500,
                color: 'var(--primary)',
                background: 'white',
                transition: 'all 0.15s',
                cursor: isLoading ? 'not-allowed' : 'pointer',
                opacity: isLoading ? 0.5 : 1,
              }}
            >
              {action.label}
            </button>
          ))}
        </div>

        <form
          onSubmit={event => {
            event.preventDefault();
            void sendPrompt(input);
          }}
          style={{
            padding: '1rem',
            borderTop: '1px solid var(--surface-container)',
            display: 'flex',
            gap: '0.5rem',
          }}
        >
          <textarea
            rows={2}
            value={input}
            onChange={event => setInput(event.target.value)}
            placeholder="Ask Copilot to cross-reference batch lineage, SOPs, and ticket evidence..."
            disabled={isLoading}
            style={{
              flex: 1,
              padding: '0.75rem',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--outline-variant)',
              fontSize: 14,
              lineHeight: 1.5,
              resize: 'none',
              outline: 'none',
              fontFamily: 'var(--font-body)',
            }}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            style={{
              padding: '0.75rem',
              borderRadius: 'var(--radius-md)',
              background: isLoading ? '#94a3b8' : 'var(--primary)',
              color: 'white',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: isLoading || !input.trim() ? 'not-allowed' : 'pointer',
              alignSelf: 'flex-end',
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
              send
            </span>
          </button>
        </form>
      </aside>
    </div>
  );
}
