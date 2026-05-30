import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Share2, ShieldAlert, RefreshCw, Building2, Languages, Info } from 'lucide-react';
import api from '../api/index.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useT } from '../i18n/index.jsx';
import { PageShell } from '../components/PageShell.jsx';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

const WIDTH = 1000;
const HEIGHT = 720;

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
};

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

// Deterministic Fruchterman–Reingold force layout. Runs synchronously so the
// graph settles to a stable position (good for screenshots) without animation
// jank or extra dependencies.
function computeLayout(nodes, edges, iterations = 320) {
  const N = nodes.length;
  if (N === 0) return [];
  const idx = new Map(nodes.map((n, i) => [n.id, i]));
  const pos = nodes.map((n, i) => {
    const angle = i * 2.399963229; // golden angle for an even initial spread
    const r = Math.sqrt((i + 1) / N) * Math.min(WIDTH, HEIGHT) * 0.42;
    return {
      x: WIDTH / 2 + Math.cos(angle) * r,
      y: HEIGHT / 2 + Math.sin(angle) * r,
      dx: 0,
      dy: 0,
    };
  });
  const links = edges
    .map((e) => ({ s: idx.get(e.source), t: idx.get(e.target) }))
    .filter((l) => l.s != null && l.t != null);

  const area = WIDTH * HEIGHT;
  const k = Math.sqrt(area / N);
  let temp = WIDTH * 0.12;

  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < N; i++) { pos[i].dx = 0; pos[i].dy = 0; }

    // Repulsion (every pair).
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        let ddx = pos[i].x - pos[j].x;
        let ddy = pos[i].y - pos[j].y;
        let dist = Math.sqrt(ddx * ddx + ddy * ddy) || 0.01;
        const rep = (k * k) / dist;
        const fx = (ddx / dist) * rep;
        const fy = (ddy / dist) * rep;
        pos[i].dx += fx; pos[i].dy += fy;
        pos[j].dx -= fx; pos[j].dy -= fy;
      }
    }

    // Attraction along edges.
    for (const l of links) {
      let ddx = pos[l.s].x - pos[l.t].x;
      let ddy = pos[l.s].y - pos[l.t].y;
      let dist = Math.sqrt(ddx * ddx + ddy * ddy) || 0.01;
      const att = (dist * dist) / k;
      const fx = (ddx / dist) * att;
      const fy = (ddy / dist) * att;
      pos[l.s].dx -= fx; pos[l.s].dy -= fy;
      pos[l.t].dx += fx; pos[l.t].dy += fy;
    }

    for (let i = 0; i < N; i++) {
      // Gentle gravity to keep disconnected pieces in frame.
      const gx = (WIDTH / 2 - pos[i].x) * 0.018;
      const gy = (HEIGHT / 2 - pos[i].y) * 0.018;
      let ddx = pos[i].dx + gx;
      let ddy = pos[i].dy + gy;
      const d = Math.sqrt(ddx * ddx + ddy * ddy) || 0.01;
      const lim = Math.min(d, temp);
      pos[i].x += (ddx / d) * lim;
      pos[i].y += (ddy / d) * lim;
      pos[i].x = Math.max(28, Math.min(WIDTH - 28, pos[i].x));
      pos[i].y = Math.max(28, Math.min(HEIGHT - 28, pos[i].y));
    }
    temp *= 0.985;
  }

  return nodes.map((n, i) => ({ ...n, x: pos[i].x, y: pos[i].y }));
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
  const [orgType, setOrgType] = useState(null);
  const [savingMode, setSavingMode] = useState(false);
  const [hovered, setHovered] = useState(null);

  const reqId = useRef(0);

  const loadPrivacy = useCallback(async () => {
    try {
      const res = await api.get('/admin/privacy-status');
      setOrgType(res.data?.orgType || 'intra');
    } catch {
      /* non-fatal: the banner just won't show the mode */
    }
  }, []);

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

  useEffect(() => { loadPrivacy(); }, [loadPrivacy]);
  useEffect(() => { loadGraph(company, language); }, [company, language, loadGraph]);

  const organizations = graph?.meta?.organizations || [];
  const languages = graph?.meta?.languages || [];

  const nodes = graph?.nodes || [];
  const edges = graph?.edges || [];

  const degree = useMemo(() => {
    const d = new Map();
    for (const e of edges) {
      d.set(e.source, (d.get(e.source) || 0) + 1);
      d.set(e.target, (d.get(e.target) || 0) + 1);
    }
    return d;
  }, [edges]);

  // Layout is recomputed only when the set of node/edge ids changes.
  const signature = useMemo(
    () => `${nodes.map((n) => n.id).join('|')}__${edges.map((e) => `${e.source}>${e.target}`).join('|')}`,
    [nodes, edges]
  );
  const laidOut = useMemo(() => computeLayout(nodes, edges), [signature]); // eslint-disable-line react-hooks/exhaustive-deps
  const posById = useMemo(() => new Map(laidOut.map((n) => [n.id, n])), [laidOut]);

  // Neighbour set for hover highlighting.
  const neighbours = useMemo(() => {
    if (!hovered) return null;
    const set = new Set([hovered]);
    for (const e of edges) {
      if (e.source === hovered) set.add(e.target);
      if (e.target === hovered) set.add(e.source);
    }
    return set;
  }, [hovered, edges]);

  const peopleCount = nodes.filter((n) => n.kind === 'person').length;
  const skillCount = nodes.filter((n) => n.kind === 'skill').length;
  const inter = orgType === 'inter';

  const departments = useMemo(() => {
    const set = new Set();
    for (const n of nodes) if (n.kind === 'person' && n.department) set.add(n.department);
    return [...set].sort();
  }, [nodes]);

  async function switchMode(next) {
    if (!isPlatform || savingMode || next === orgType) return;
    setSavingMode(true);
    try {
      const res = await api.put('/admin/org-privacy', { type: next });
      setOrgType(res.data?.type || next);
      await loadGraph(company, language);
    } catch (e) {
      setError(e.response?.data?.error || t('graph.error.modeChangeFailed'));
    } finally {
      setSavingMode(false);
    }
  }

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

        <Button
          variant="outline"
          size="lg"
          onClick={() => loadGraph(company, language)}
          data-testid="kg-refresh"
        >
          <RefreshCw className="size-4" /> {t('graph.refresh')}
        </Button>
      </div>

      {/* Privacy / two-product affordance — reuses the org privacy toggle. */}
      <div
        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/40 px-4 py-3"
        data-testid="kg-privacy-affordance"
      >
        <div className="flex items-start gap-2.5">
          <ShieldAlert className={cn('mt-0.5 size-4 shrink-0', inter ? 'text-amber-500' : 'text-muted-foreground')} />
          <div className="text-sm">
            <span className="font-medium text-foreground">{t('graph.privacy.label')} </span>
            <span data-testid="kg-org-mode">{inter ? t('graph.privacy.inter') : t('graph.privacy.intra')}</span>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              {inter
                ? t('graph.privacy.interDesc')
                : t('graph.privacy.intraDesc')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isPlatform ? (
            <div className="inline-flex overflow-hidden rounded-lg border border-border">
              <button
                type="button"
                data-testid="kg-mode-intra"
                disabled={savingMode}
                onClick={() => switchMode('intra')}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50',
                  !inter ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-muted'
                )}
              >
                {t('graph.privacy.intraBtn')}
              </button>
              <button
                type="button"
                data-testid="kg-mode-inter"
                disabled={savingMode}
                onClick={() => switchMode('inter')}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50',
                  inter ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-muted'
                )}
              >
                {t('graph.privacy.interBtn')}
              </button>
            </div>
          ) : (
            <Link to="/admin" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              {t('graph.privacy.manageInAdmin')}
            </Link>
          )}
        </div>
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
          {/* Counts + legend */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2" data-testid="kg-node-count">
              <Badge variant="secondary">{t('graph.count.people', { count: peopleCount })}</Badge>
              <Badge variant="secondary">{t('graph.count.skills', { count: skillCount })}</Badge>
              <Badge variant="secondary">{t('graph.count.links', { count: edges.length })}</Badge>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-5 rounded" style={{ background: EDGE_COLORS.can_teach }} /> {t('graph.legend.canTeach')}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-5 rounded" style={{ background: EDGE_COLORS.wants_to_learn }} /> {t('graph.legend.wantsToLearn')}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block size-2.5 rotate-45 rounded-[2px] bg-muted-foreground/60" /> {t('graph.legend.skill')}
              </span>
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

          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <svg
              data-testid="knowledge-graph-svg"
              viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
              className="block h-auto w-full"
              role="img"
              aria-label={t('graph.svgAria')}
              onMouseLeave={() => setHovered(null)}
            >
              {/* Edges */}
              <g>
                {edges.map((e, i) => {
                  const a = posById.get(e.source);
                  const b = posById.get(e.target);
                  if (!a || !b) return null;
                  const active = !neighbours || (neighbours.has(e.source) && neighbours.has(e.target));
                  return (
                    <line
                      key={`${e.source}-${e.target}-${e.type}-${i}`}
                      data-testid="kg-edge"
                      data-type={e.type}
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      stroke={EDGE_COLORS[e.type] || '#94a3b8'}
                      strokeWidth={active ? 1.4 : 0.8}
                      strokeOpacity={neighbours ? (active ? 0.85 : 0.05) : 0.35}
                    />
                  );
                })}
              </g>

              {/* Nodes */}
              <g>
                {laidOut.map((n) => {
                  const deg = degree.get(n.id) || 0;
                  const dim = neighbours && !neighbours.has(n.id);
                  const isPerson = n.kind === 'person';
                  const r = isPerson ? 7 + Math.min(deg, 8) : 4 + Math.min(deg, 6) * 0.7;
                  const fill = isPerson ? deptColor(n.department) : 'var(--muted-foreground, #64748b)';
                  const showLabel = isPerson || deg >= 4 || (neighbours && neighbours.has(n.id));
                  return (
                    <g
                      key={n.id}
                      data-testid="kg-node"
                      data-kind={n.kind}
                      transform={`translate(${n.x} ${n.y})`}
                      style={{ cursor: 'pointer', opacity: dim ? 0.18 : 1, transition: 'opacity 120ms' }}
                      onMouseEnter={() => setHovered(n.id)}
                    >
                      {isPerson ? (
                        <circle r={r} fill={fill} stroke="var(--card, #fff)" strokeWidth={1.5} />
                      ) : (
                        <rect
                          x={-r}
                          y={-r}
                          width={r * 2}
                          height={r * 2}
                          transform="rotate(45)"
                          fill={fill}
                          fillOpacity={0.55}
                          stroke="var(--card, #fff)"
                          strokeWidth={1}
                        />
                      )}
                      {showLabel && (
                        <text
                          x={r + 3}
                          y={3}
                          fontSize={isPerson ? 11 : 9}
                          fontWeight={isPerson ? 600 : 400}
                          fill="var(--foreground, #0f172a)"
                          style={{ paintOrder: 'stroke', pointerEvents: 'none' }}
                          stroke="var(--card, #fff)"
                          strokeWidth={3}
                          strokeLinejoin="round"
                        >
                          {n.label}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            </svg>
          </div>

          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Info className="size-3.5" /> {t('graph.hoverHint')}
          </p>
        </div>
      )}
    </PageShell>
  );
}
