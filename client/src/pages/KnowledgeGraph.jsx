import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { Share2, RefreshCw, Building2, Languages, GraduationCap, Info } from 'lucide-react';
import api from '../api/index.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useT } from '../i18n/index.jsx';
import { PageShell } from '../components/PageShell.jsx';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

const GRAPH_HEIGHT = 600;

const DEPT_COLORS = {
  Engineering: '#6366f1',
  Finance: '#10b981',
  Marketing: '#f59e0b',
  Operations: '#06b6d4',
  Product: '#ec4899',
  Design: '#8b5cf6',
  Sales: '#ef4444',
  HR: '#14b8a6',
};

const EDGE_COLORS = {
  can_teach: '#22c55e',
  wants_to_learn: '#f59e0b',
  session: '#3b82f6',
  connection: '#a855f7',
};

// Person->person edges backed by actual interactions (0026).
const REAL_LINK_TYPES = new Set(['session', 'connection']);

const LANG_LABELS = { en: 'English', it: 'Italiano', fr: 'Français', de: 'Deutsch', es: 'Español', pt: 'Português' };

function langLabel(code) {
  return LANG_LABELS[code] || (code ? code.toUpperCase() : code);
}

function deptColor(dept) {
  if (DEPT_COLORS[dept]) return DEPT_COLORS[dept];
  // Stable fallback hue for unknown departments.
  let h = 0;
  for (let i = 0; i < (dept || '').length; i++) h = (h * 31 + dept.charCodeAt(i)) % 360;
  return `hsl(${h} 65% 55%)`;
}

export default function KnowledgeGraph() {
  const { user } = useAuth();
  const { t } = useT();
  const isPlatform = user?.admin_scope === 'platform';

  const [graph, setGraph] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [company, setCompany] = useState('');
  const [language, setLanguage] = useState('');
  const [hovered, setHovered] = useState(null);
  // 'bipartite' = people <-> skills; 'people' = people connected via shared
  // skills (skills become invisible connectors).
  const [view, setView] = useState('bipartite');
  // "Real connections" overlay: completed sessions + accepted connections.
  const [showReal, setShowReal] = useState(true);
  const [program, setProgram] = useState('');
  const [graphWidth, setGraphWidth] = useState(900);

  const reqId = useRef(0);
  const fgRef = useRef(null);
  const containerRef = useRef(null);

  const loadGraph = useCallback(async (org, lang) => {
    const id = ++reqId.current;
    setLoading(true);
    setError('');
    try {
      const qs = new URLSearchParams();
      if (org) qs.set('org', org);
      if (lang) qs.set('language', lang);
      const res = await api.get(`/admin/knowledge-graph${qs.toString() ? `?${qs}` : ''}`);
      if (id !== reqId.current) return; // a newer request superseded this one
      setGraph(res.data);
    } catch (e) {
      if (id !== reqId.current) return;
      setError(e.response?.data?.error || t('graph.error.loadFailed'));
      setGraph(null);
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [t]);

  useEffect(() => { loadGraph(company, language); }, [company, language, loadGraph]);

  const organizations = graph?.meta?.organizations || [];
  const languages = graph?.meta?.languages || [];

  const nodes = graph?.nodes || [];
  const edges = graph?.edges || [];

  // Program filter (client-side): person nodes carry `program` (0026); an
  // edge survives only if both endpoints stay in scope.
  const visibleNodes = useMemo(
    () => (program ? nodes.filter((n) => n.kind !== 'person' || n.program === program) : nodes),
    [nodes, program]
  );
  const visibleEdges = useMemo(() => {
    const keep = new Set(visibleNodes.map((n) => n.id));
    return edges.filter((e) => keep.has(e.source) && keep.has(e.target));
  }, [edges, visibleNodes]);

  const programs = useMemo(() => {
    const set = new Set();
    for (const n of nodes) if (n.kind === 'person' && n.program) set.add(n.program);
    return [...set].sort();
  }, [nodes]);

  const kindById = useMemo(() => new Map(nodes.map((n) => [n.id, n.kind])), [nodes]);

  // Build the force-graph dataset for the active view. New object identities are
  // produced only when the underlying data or the view changes, so the
  // simulation isn't reheated on every render.
  const graphData = useMemo(() => {
    // Real-connection overlay (0026): completed sessions + accepted
    // connections between people, thickness = interaction count.
    const realLinks = showReal
      ? visibleEdges
          .filter((e) => REAL_LINK_TYPES.has(e.type))
          .map((e) => ({ source: e.source, target: e.target, value: e.weight || 1, type: e.type }))
      : [];
    if (view === 'people') {
      const people = visibleNodes.filter((n) => n.kind === 'person');
      // skill id -> people who touch it (teach or learn)
      const bySkill = new Map();
      for (const e of visibleEdges) {
        if (REAL_LINK_TYPES.has(e.type)) continue;
        const personId = kindById.get(e.source) === 'person' ? e.source : e.target;
        const skillId = personId === e.source ? e.target : e.source;
        if (!bySkill.has(skillId)) bySkill.set(skillId, []);
        bySkill.get(skillId).push(personId);
      }
      const pairValue = new Map(); // "a|b" -> shared skill count
      for (const arr of bySkill.values()) {
        const uniq = [...new Set(arr)];
        for (let i = 0; i < uniq.length; i++) {
          for (let j = i + 1; j < uniq.length; j++) {
            const key = uniq[i] < uniq[j] ? `${uniq[i]}|${uniq[j]}` : `${uniq[j]}|${uniq[i]}`;
            pairValue.set(key, (pairValue.get(key) || 0) + 1);
          }
        }
      }
      const links = [...pairValue.entries()].map(([key, value]) => {
        const [source, target] = key.split('|');
        return { source, target, value, type: 'peer' };
      });
      return { nodes: people.map((n) => ({ ...n })), links: [...links, ...realLinks] };
    }
    return {
      nodes: visibleNodes.map((n) => ({ ...n })),
      links: [
        ...visibleEdges
          .filter((e) => !REAL_LINK_TYPES.has(e.type))
          .map((e) => ({ source: e.source, target: e.target, type: e.type, value: 1 })),
        ...realLinks,
      ],
    };
  }, [visibleNodes, visibleEdges, view, kindById, showReal]);

  // Degree (within the active view) drives node size.
  const degree = useMemo(() => {
    const d = new Map();
    for (const l of graphData.links) {
      const s = typeof l.source === 'object' ? l.source.id : l.source;
      const tt = typeof l.target === 'object' ? l.target.id : l.target;
      d.set(s, (d.get(s) || 0) + 1);
      d.set(tt, (d.get(tt) || 0) + 1);
    }
    return d;
  }, [graphData]);

  // Neighbour set for hover highlighting, derived from the active links.
  const neighbours = useMemo(() => {
    if (!hovered) return null;
    const set = new Set([hovered]);
    for (const l of graphData.links) {
      const s = typeof l.source === 'object' ? l.source.id : l.source;
      const tt = typeof l.target === 'object' ? l.target.id : l.target;
      if (s === hovered) set.add(tt);
      if (tt === hovered) set.add(s);
    }
    return set;
  }, [hovered, graphData]);

  const peopleCount = visibleNodes.filter((n) => n.kind === 'person').length;
  const skillCount = visibleNodes.filter((n) => n.kind === 'skill').length;
  const realLinkCount = visibleEdges.filter((e) => REAL_LINK_TYPES.has(e.type)).length;
  // Measure the container so the canvas fills available width.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setGraphWidth(el.clientWidth || 900);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [loading, view]);

  // Configure d3 forces: stronger repulsion so clusters breathe, and link
  // distance that carries meaning in the people view (more shared skills =>
  // closer together).
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    fg.d3Force('charge')?.strength(-180);
    const link = fg.d3Force('link');
    if (link) {
      link.distance((l) => (view === 'people' ? Math.max(24, 110 / ((l.value || 1) + 0.5)) : 46));
    }
    fg.d3ReheatSimulation?.();
  }, [graphData, view]);

  const departments = useMemo(() => {
    const set = new Set();
    for (const n of visibleNodes) if (n.kind === 'person' && n.department) set.add(n.department);
    return [...set].sort();
  }, [visibleNodes]);

  return (
    <PageShell
      title={t('graph.pageTitle')}
      description={t('graph.pageDescription')}
    >
      {/* Filters */}
      <div className="flex flex-wrap items-end gap-4 rounded-xl border border-border bg-card p-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="kg-company" className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Building2 className="size-3.5" /> {t('graph.filter.company')}
          </label>
          <select
            id="kg-company"
            data-testid="kg-filter-company"
            value={company}
            disabled={!isPlatform}
            onChange={(e) => setCompany(e.target.value)}
            className={cn(
              'h-9 min-w-[12rem] rounded-lg border border-border bg-background px-3 text-sm',
              'focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
              !isPlatform && 'cursor-not-allowed opacity-70'
            )}
          >
            {isPlatform && <option value="">{t('graph.filter.allOrganizations')}</option>}
            {organizations.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
          {!isPlatform && (
            <span className="text-[11px] text-muted-foreground">{t('graph.filter.locked')}</span>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="kg-language" className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Languages className="size-3.5" /> {t('graph.filter.language')}
          </label>
          <select
            id="kg-language"
            data-testid="kg-filter-language"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className={cn(
              'h-9 min-w-[12rem] rounded-lg border border-border bg-background px-3 text-sm',
              'focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50'
            )}
          >
            <option value="">{t('graph.filter.allLanguages')}</option>
            {languages.map((l) => (
              <option key={l} value={l}>{langLabel(l)}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="kg-program" className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <GraduationCap className="size-3.5" /> {t('graph.filter.program')}
          </label>
          <select
            id="kg-program"
            data-testid="kg-filter-program"
            value={program}
            onChange={(e) => setProgram(e.target.value)}
            className={cn(
              'h-9 min-w-[12rem] rounded-lg border border-border bg-background px-3 text-sm',
              'focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50'
            )}
          >
            <option value="">{t('graph.filter.allPrograms')}</option>
            {programs.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>

        <Button
          variant="outline"
          onClick={() => loadGraph(company, language)}
          data-testid="kg-refresh"
        >
          <RefreshCw className="size-4" /> {t('graph.refresh')}
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>{t('graph.error.title')}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <Skeleton className="h-[520px] w-full rounded-xl" />
      ) : nodes.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-20 text-center">
          <Share2 className="size-10 text-muted-foreground" />
          <p className="font-semibold">{t('graph.empty.title')}</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            {t('graph.empty.description')}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {/* View toggle */}
          <div className="inline-flex w-fit overflow-hidden rounded-lg border border-border">
            <button
              type="button"
              data-testid="kg-view-bipartite"
              onClick={() => setView('bipartite')}
              className={cn('px-3 py-1.5 text-xs font-medium transition-colors',
                view === 'bipartite' ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-muted')}
            >
              {t('graph.view.bipartite')}
            </button>
            <button
              type="button"
              data-testid="kg-view-people"
              onClick={() => setView('people')}
              className={cn('px-3 py-1.5 text-xs font-medium transition-colors',
                view === 'people' ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-muted')}
            >
              {t('graph.view.people')}
            </button>
          </div>

          <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted">
            <input
              type="checkbox"
              className="accent-primary"
              data-testid="kg-toggle-real"
              checked={showReal}
              onChange={(e) => setShowReal(e.target.checked)}
            />
            {t('graph.view.realLinks')}
          </label>

          {/* Counts + legend */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2" data-testid="kg-node-count">
              <Badge variant="secondary">{t('graph.count.people', { count: peopleCount })}</Badge>
              {view === 'bipartite' && <Badge variant="secondary">{t('graph.count.skills', { count: skillCount })}</Badge>}
              <Badge variant="secondary">{t('graph.count.links', { count: graphData.links.length })}</Badge>
              {showReal && realLinkCount > 0 && (
                <Badge variant="secondary" data-testid="kg-real-count">
                  {t('graph.count.realLinks', { count: realLinkCount })}
                </Badge>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
              {view === 'bipartite' ? (
                <>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-0.5 w-5 rounded" style={{ background: EDGE_COLORS.can_teach }} /> {t('graph.legend.canTeach')}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-0.5 w-5 rounded" style={{ background: EDGE_COLORS.wants_to_learn }} /> {t('graph.legend.wantsToLearn')}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block size-2.5 rotate-45 rounded-[2px] bg-muted-foreground/60" /> {t('graph.legend.skill')}
                  </span>
                </>
              ) : (
                <span className="flex items-center gap-1.5">{t('graph.legend.peerLink')}</span>
              )}
              {showReal && (
                <>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-0.5 w-5 rounded" style={{ background: EDGE_COLORS.session }} /> {t('graph.legend.session')}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-0.5 w-5 rounded" style={{ background: EDGE_COLORS.connection }} /> {t('graph.legend.connection')}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Department legend */}
          {departments.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
              {departments.map((d) => (
                <span key={d} className="flex items-center gap-1.5">
                  <span className="inline-block size-2.5 rounded-full" style={{ background: deptColor(d) }} />
                  {d}
                </span>
              ))}
            </div>
          )}

          <div
            ref={containerRef}
            data-testid="knowledge-graph-canvas"
            className="overflow-hidden rounded-xl border border-border bg-card"
            style={{ height: GRAPH_HEIGHT }}
          >
            <ForceGraph2D
              ref={fgRef}
              width={graphWidth}
              height={GRAPH_HEIGHT}
              graphData={graphData}
              cooldownTicks={120}
              onEngineStop={() => fgRef.current?.zoomToFit(400, 40)}
              nodeRelSize={5}
              nodeVal={(n) => 1 + Math.min(degree.get(n.id) || 0, 10)}
              nodeLabel={(n) => (n.kind === 'person'
                ? `${n.label}${n.department ? ` · ${n.department}` : ''}${n.program ? ` · ${n.program}` : ''}`
                : n.label)}
              onNodeHover={(n) => setHovered(n ? n.id : null)}
              onNodeDragEnd={(n) => { n.fx = n.x; n.fy = n.y; }}
              linkColor={(l) => {
                const s = typeof l.source === 'object' ? l.source.id : l.source;
                const tt = typeof l.target === 'object' ? l.target.id : l.target;
                const active = !neighbours || (neighbours.has(s) && neighbours.has(tt));
                if (!active) return 'rgba(148,163,184,0.06)';
                return EDGE_COLORS[l.type] || 'rgba(148,163,184,0.4)';
              }}
              linkWidth={(l) => Math.min(1 + (l.value || 1) * 0.6, 5)}
              nodeCanvasObject={(node, ctx, globalScale) => {
                const deg = degree.get(node.id) || 0;
                const isPerson = node.kind === 'person';
                const r = (isPerson ? 4 + Math.min(deg, 8) * 0.7 : 3 + Math.min(deg, 6) * 0.5);
                const dim = neighbours && !neighbours.has(node.id);
                ctx.globalAlpha = dim ? 0.15 : 1;
                ctx.fillStyle = isPerson ? deptColor(node.department) : '#64748b';
                ctx.beginPath();
                if (isPerson) {
                  ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
                  ctx.fill();
                } else {
                  // diamond for skills
                  ctx.save();
                  ctx.translate(node.x, node.y);
                  ctx.rotate(Math.PI / 4);
                  ctx.globalAlpha = (dim ? 0.15 : 0.6);
                  ctx.fillRect(-r, -r, r * 2, r * 2);
                  ctx.restore();
                  ctx.globalAlpha = dim ? 0.15 : 1;
                }
                // Labels: people always; skills when zoomed in or hovered.
                const showLabel = isPerson || globalScale > 1.6 || (neighbours && neighbours.has(node.id));
                if (showLabel) {
                  const fontSize = Math.max(9, (isPerson ? 11 : 9) / Math.sqrt(globalScale));
                  ctx.font = `${isPerson ? '600' : '400'} ${fontSize}px sans-serif`;
                  ctx.textBaseline = 'middle';
                  ctx.fillStyle = '#0f172a';
                  ctx.fillText(node.label, node.x + r + 2, node.y);
                }
                ctx.globalAlpha = 1;
              }}
            />
          </div>

          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Info className="size-3.5" /> {t('graph.hoverHint')}
          </p>
        </div>
      )}
    </PageShell>
  );
}
