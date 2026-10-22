import { errorMessage } from '../lib/errors.mjs';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { Share2, RefreshCw, Search, Plus, Minus, Scan, X, Expand, Shrink } from 'lucide-react';
import api from '../api/index.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useT } from '../i18n/index.jsx';
import { languageName } from '../lib/languages.js';
import { PageShell } from '../components/PageShell.jsx';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { pmTranslate } from '../components/admin/adminPm.js';

const GRAPH_HEIGHT = 640;

// The largest departments get the brand palette, in order; the long tail
// shares one quiet colour, so the picture reads at a glance instead of as a
// rainbow of near-identical greens.
const DEPARTMENT_PALETTE = ['#1e1b3a', '#ff6b57', '#2fbf9e', '#5a5870', '#8e89c4', '#1f7f69', '#c93f2d', '#ff9d8f'];
const OTHER_DEPARTMENT = '#c9c6dc';
const SKILL_COLOR = '#8e89c4';

// Links are quiet until something is in focus; then the focused node's links
// take their meaning colour.
const EDGE_COLORS = {
  can_teach: '#2fbf9e',
  wants_to_learn: '#ff6b57',
  session: '#1e1b3a',
  connection: '#8e89c4',
  peer: '#5a5870',
};
const QUIET_LINK = 'rgba(90, 88, 112, 0.14)';
const FADED_LINK = 'rgba(90, 88, 112, 0.04)';
const REAL_LINK = 'rgba(30, 27, 58, 0.55)';

// Links backed by aggregate interaction counts (minimum five participants).
const REAL_LINK_TYPES = new Set(['session', 'connection']);
const endId = end => (typeof end === 'object' ? end.id : end);

// Keeps nodes from sitting on top of each other.
function collideForce(radius) {
  let nodes = [];
  function force() {
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const min = radius(a) + radius(b) + 2;
        const dist = Math.hypot(dx, dy) || 0.01;
        if (dist < min) {
          const push = (min - dist) / dist / 2;
          a.x -= dx * push; a.y -= dy * push;
          b.x += dx * push; b.y += dy * push;
        }
      }
    }
  }
  force.initialize = next => { nodes = next; };
  return force;
}

export default function KnowledgeGraph() {
  const { user } = useAuth();
  const { t: translate, lang } = useT();
  const t = useCallback((key, vars) => pmTranslate(translate, key, vars), [translate]);
  const isPlatform = user?.admin_scope === 'platform';

  const [graph, setGraph] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [company, setCompany] = useState('');
  const [language, setLanguage] = useState('');
  const [hovered, setHovered] = useState(null);
  // Both views contain department aggregates only; the second focuses on
  // aggregate session/connection links between departments.
  const [view, setView] = useState('bipartite');
  const [showReal, setShowReal] = useState(true);
  const [skill, setSkill] = useState('');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [departmentFocus, setDepartmentFocus] = useState('');
  const autoFit = useRef(true);
  const [graphWidth, setGraphWidth] = useState(900);
  // Full screen: the panels and the graph together, the graph as tall as the screen.
  const [fullScreen, setFullScreen] = useState(false);
  const [graphHeight, setGraphHeight] = useState(GRAPH_HEIGHT);
  const shellRef = useRef(null);

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
      setError(errorMessage(e, t, t('graph.error.loadFailed')));
      setGraph(null);
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [t]);

  useEffect(() => { loadGraph(company, language); }, [company, language, loadGraph]);

  const organizations = graph?.meta?.organizations || [];
  const languages = graph?.meta?.languages || [];

  // The database names the pooled group "Other departments"; show it in the reader's language.
  const nodes = useMemo(() => (graph?.nodes || []).map(n => (n.kind === 'department' && n.label === 'Other departments'
    ? { ...n, label: t('graph.otherDepartments') } : n)), [graph, t]);
  const edges = graph?.edges || [];

  const visibleNodes = useMemo(() => {
    if (!skill) return nodes;
    const related = new Set(edges.filter(e => e.source === skill || e.target === skill).flatMap(e => [e.source, e.target]));
    related.add(skill);
    return nodes.filter(n => related.has(n.id));
  }, [nodes, edges, skill]);
  const visibleEdges = useMemo(() => {
    const keep = new Set(visibleNodes.map((n) => n.id));
    return edges.filter((e) => keep.has(e.source) && keep.has(e.target));
  }, [edges, visibleNodes]);

  const kindById = useMemo(() => new Map(nodes.map((n) => [n.id, n.kind])), [nodes]);
  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  // The endpoint returns department and skill aggregates, never member nodes.
  const { graphData } = useMemo(() => {
    const realLinks = showReal
      ? visibleEdges
          .filter((e) => REAL_LINK_TYPES.has(e.type))
          .map((e) => ({ source: e.source, target: e.target, value: e.count || 1, type: e.type }))
      : [];
    let candidateNodes = view === 'people' ? visibleNodes.filter(n => n.kind === 'department') : visibleNodes;
    let links;
    if (view === 'people') {
      links = realLinks;
    } else {
      links = [
        ...visibleEdges
          .filter((e) => !REAL_LINK_TYPES.has(e.type))
          .map((e) => ({ source: e.source, target: e.target, type: e.type, value: e.count || 1 })),
        ...realLinks,
      ];
    }
    const linked = new Set(links.flatMap(l => [l.source, l.target]));
    const kept = candidateNodes.filter(n => linked.has(n.id));
    return {
      graphData: { nodes: kept.map((n) => ({ ...n })), links },
    };
  }, [visibleNodes, visibleEdges, view, kindById, showReal]);

  // Degree (within the active view) drives node size.
  const degree = useMemo(() => {
    const d = new Map();
    for (const l of graphData.links) {
      const s = endId(l.source);
      const tt = endId(l.target);
      d.set(s, (d.get(s) || 0) + 1);
      d.set(tt, (d.get(tt) || 0) + 1);
    }
    return d;
  }, [graphData]);
  const radius = useCallback((node) => {
    const deg = degree.get(node.id) || 0;
    return node.kind === 'department' ? 5 + Math.min(Math.sqrt(deg) * 1.6, 9) : 4 + Math.min(Math.sqrt(deg) * 1.1, 6);
  }, [degree]);

  // Largest fields first and in colour; the pooled "other" group goes last, in grey.
  const departmentList = useMemo(() => {
    const other = t('graph.otherDepartments');
    const fields = graphData.nodes.filter(n => n.kind === 'department')
      .sort((a, b) => (a.label === other) - (b.label === other) || b.count - a.count || a.label.localeCompare(b.label));
    return fields.map((n, index) => ({ name: n.label, id: n.id, count: n.count,
      color: n.label === other ? OTHER_DEPARTMENT : DEPARTMENT_PALETTE[index] || OTHER_DEPARTMENT }));
  }, [graphData, t]);
  const departmentColor = useMemo(() => new Map(departmentList.map(d => [d.name, d.color])), [departmentList]);

  // What is in focus: the hovered node, else the selected one; plus a
  // department, when one is picked in the list.
  const focusId = (hovered && kindById.get(hovered) === 'skill' ? hovered : null) || selectedId;
  const focusSet = useMemo(() => {
    if (!focusId && !departmentFocus) return null;
    const set = new Set();
    const seeds = focusId ? [focusId] : graphData.nodes.filter(n => n.kind === 'department' && n.label === departmentFocus).map(n => n.id);
    for (const id of seeds) set.add(id);
    for (const l of graphData.links) {
      const s = endId(l.source);
      const tt = endId(l.target);
      if (seeds.includes(s)) set.add(tt);
      if (seeds.includes(tt)) set.add(s);
    }
    return set;
  }, [focusId, departmentFocus, graphData]);

  // Labels: the best-connected nodes always, everything else on zoom or focus.
  const labelled = useMemo(() => {
    const ranked = [...graphData.nodes].sort((a, b) => (degree.get(b.id) || 0) - (degree.get(a.id) || 0));
    return new Set([
      ...ranked.filter(n => n.kind === 'department').slice(0, 6).map(n => n.id),
      ...ranked.filter(n => n.kind === 'skill').slice(0, 4).map(n => n.id),
    ]);
  }, [graphData, degree]);

  // These are department-level counts only; no person IDs are available here.
  const relations = useMemo(() => {
    const map = new Map();
    const add = (id, key, item) => {
      if (!map.has(id)) map.set(id, { taughtBy: [], wantedBy: [] });
      map.get(id)[key].push(item);
    };
    for (const e of visibleEdges) {
      if (e.type === 'can_teach') add(e.target, 'taughtBy', { department: nodeById.get(e.source)?.label, count: e.count });
      if (e.type === 'wants_to_learn') add(e.target, 'wantedBy', { department: nodeById.get(e.source)?.label, count: e.count });
    }
    return map;
  }, [visibleEdges, nodeById]);
  const skillGaps = useMemo(() => [...relations.entries()]
    .filter(([id, r]) => kindById.get(id) === 'skill' && r.wantedBy.length > 0 && r.taughtBy.length > 0)
    .map(([id, r]) => ({ id, label: nodeById.get(id)?.label || id,
      wanted: r.wantedBy.reduce((sum, row) => sum + row.count, 0),
      taught: r.taughtBy.reduce((sum, row) => sum + row.count, 0) }))
    .sort((a, b) => (b.wanted - b.taught) - (a.wanted - a.taught) || b.wanted - a.wanted)
    .slice(0, 8), [relations, kindById, nodeById]);
  const departmentPairs = useMemo(() => {
    return visibleEdges.filter(e => REAL_LINK_TYPES.has(e.type)).map(e => ({
      a: nodeById.get(e.source)?.label, b: nodeById.get(e.target)?.label, count: e.count, type: e.type,
    })).filter(e => e.a && e.b).sort((a, b) => b.count - a.count).slice(0, 8);
  }, [visibleEdges, nodeById]);

  const peopleCount = nodes.filter(n => n.kind === 'department').reduce((sum, n) => sum + n.count, 0);
  const skillCount = graphData.nodes.filter((n) => n.kind === 'skill').length;
  const realLinkCount = visibleEdges.filter((e) => REAL_LINK_TYPES.has(e.type)).length;
  const selected = selectedId && kindById.get(selectedId) === 'skill' ? nodeById.get(selectedId) : null;
  const needle = query.trim().toLocaleLowerCase();
  const searchResults = needle
    ? [...departmentList.filter(d => d.name.toLocaleLowerCase().includes(needle)).map(d => ({ id: `department:${d.name}`, kind: 'department', label: d.name, color: d.color })),
      ...graphData.nodes.filter(n => n.kind === 'skill' && (n.label || '').toLocaleLowerCase().includes(needle))].slice(0, 8)
    : [];
  const pickResult = (result) => {
    if (result.kind === 'department') { setSelectedId(null); setDepartmentFocus(result.label); } else focusNode(result.id);
    setQuery('');
  };

  function focusNode(id) {
    const node = graphData.nodes.find(n => n.id === id);
    if (!node) return;
    setSelectedId(id);
    setDepartmentFocus('');
    autoFit.current = false;
    // Picked from the lists under the graph: bring the graph into view.
    containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    if (Number.isFinite(node.x) && Number.isFinite(node.y)) {
      fgRef.current?.centerAt(node.x, node.y, 500);
      fgRef.current?.zoom(2.4, 500);
    }
  }
  function clearFocus() { setSelectedId(null); setHovered(null); setDepartmentFocus(''); }
  function resetGraph() {
    setCompany(''); setLanguage(''); setSkill('');
    setQuery(''); clearFocus(); setShowReal(true);
    for (const node of graphData.nodes) { delete node.fx; delete node.fy; }
    autoFit.current = true;
    fgRef.current?.d3ReheatSimulation();
    fitView();
  }
  const zoomBy = factor => { const fg = fgRef.current; if (fg) fg.zoom(fg.zoom() * factor, 300); };
  // Fit frames the connected core: a few small clusters at the edge otherwise
  // shrink the whole picture to a dot in the middle.
  const fitView = (ms = 500) => {
    const core = node => (degree.get(node.id) || 0) >= 2;
    fgRef.current?.zoomToFit(ms, 50, graphData.nodes.some(core) ? core : undefined);
  };
  const toggleFullScreen = () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else shellRef.current?.requestFullscreen?.();
  };
  useEffect(() => {
    const onChange = () => {
      const active = document.fullscreenElement === shellRef.current;
      setFullScreen(active);
      setGraphHeight(active ? Math.max(GRAPH_HEIGHT, window.innerHeight - 32) : GRAPH_HEIGHT);
      setTimeout(() => fitView(400), 150);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  });

  useEffect(() => { autoFit.current = true; setSelectedId(null); setHovered(null); }, [graphData]);
  useEffect(() => {
    const onKey = event => { if (event.key === 'Escape') clearFocus(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
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

  // Forces: moderate repulsion, short links, and no overlapping nodes. In the
  // people view more shared skills pull people closer.
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    fg.d3Force('charge')?.strength(-70).distanceMax(320);
    const link = fg.d3Force('link');
    if (link) link.distance((l) => (view === 'people' ? 72 : 46));
    fg.d3Force('collide', collideForce(radius));
    fg.d3ReheatSimulation?.();
  }, [graphData, view, radius]);

  const selectFilter = (id, value, onChange, options, allLabel, extra = {}) => (
    <select id={id} value={value} onChange={e => onChange(e.target.value)} className="filter-control kg-select" {...extra}>
      {allLabel !== null && <option value="">{allLabel}</option>}
      {options.map(option => <option key={option.value ?? option} value={option.value ?? option}>{option.label ?? option}</option>)}
    </select>
  );
  // Departments are present only when their aggregate count meets the minimum.
  const groupChips = (groups, empty) => {
    return groups.length
      ? <ul className="kg-chips">{groups.map(({ department, count }) => <li key={department}><span>{department} · {count}</span></li>)}</ul>
      : <p className="kg-muted">{empty}</p>;
  };

  return (
    <PageShell className="admin-page kg-page"
      title={t('graph.pageTitle')}
      description={t('graph.pageDescription')}
      action={<div className="kg-header-actions">
        <div className="kg-segmented" role="group" aria-label={t('graph.view.label')}>
          <button type="button" data-testid="kg-view-bipartite" aria-pressed={view === 'bipartite'} onClick={() => setView('bipartite')} data-control-radius-exempt>{t('graph.view.bipartite')}</button>
          <button type="button" data-testid="kg-view-people" aria-pressed={view === 'people'} onClick={() => setView('people')} data-control-radius-exempt>{t('graph.view.people')}</button>
        </div>
        <Button variant="outline" size="sm" onClick={() => loadGraph(company, language)} data-testid="kg-refresh"><RefreshCw className="size-4" /> {t('graph.refresh')}</Button>
      </div>}
    >
      {error && (
        <Alert variant="destructive">
          <AlertTitle>{t('graph.error.title')}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* The picture in four numbers. */}
      <div className="kg-stats" data-testid="kg-node-count">
        <div><span>{t('graph.stats.people')}</span><strong>{peopleCount}</strong></div>
        <div><span>{t('graph.stats.skills')}</span><strong>{view === 'bipartite' ? skillCount : '—'}</strong></div>
        <div data-testid="kg-real-count"><span>{t('graph.stats.real')}</span><strong>{realLinkCount}</strong></div>
        <div className="is-gap"><span>{t('graph.stats.gap')}</span>{skillGaps[0]
          ? <button type="button" onClick={() => focusNode(skillGaps[0].id)}><strong>{skillGaps[0].label}</strong><small>{t('graph.insights.gapCounts', { wanted: skillGaps[0].wanted, taught: skillGaps[0].taught })}</small></button>
          : <strong>—</strong>}</div>
      </div>

      <div ref={shellRef} className={cn('kg-layout', selected && 'has-selection', fullScreen && 'is-full-screen')} style={{ '--kg-height': `${graphHeight}px` }}>
        {/* Explore: search, filters, departments. */}
        <aside className="kg-panel" aria-label={t('graph.panel.explore')}>
          {/* Scrolls inside the rounded panel, so the scrollbar stays clear of its corners. */}
          <div className="kg-panel-scroll">
          <div className="kg-search">
            <Search className="size-4" aria-hidden="true" />
            <input type="search" value={query} placeholder={t('graph.searchAggregate')} aria-label={t('graph.searchAggregate')}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && searchResults[0]) pickResult(searchResults[0]); }} />
          </div>
          {query.trim() && <ul className="kg-results" aria-label={t('graph.accessibleList')}>
            {searchResults.length === 0 && <li className="kg-muted">{t('graph.noResults')}</li>}
            {searchResults.map(n => <li key={n.id}><button type="button" onClick={() => pickResult(n)}>
              <span className={cn('kg-mark', n.kind === 'skill' && 'is-skill')} style={n.kind === 'department' ? { background: n.color } : undefined} />
              <span>{n.label}</span><small>{t(`graph.kind.${n.kind}`)}</small>
            </button></li>)}
          </ul>}

          {departmentList.length > 0 && <>
            <h3>{t('graph.panel.departments')}</h3>
            <ul className="kg-departments">
              {departmentList.map(d => <li key={d.name}>
                <button type="button" aria-pressed={departmentFocus === d.name} onClick={() => { setSelectedId(null); setDepartmentFocus(departmentFocus === d.name ? '' : d.name); }}>
                  <span className="kg-mark" style={{ background: d.color }} /><span>{d.name}</span><small>{d.count}</small>
                </button>
              </li>)}
            </ul>
          </>}
          <h3>{t('graph.panel.filters')}</h3>
          <div className="kg-filters">
            <label htmlFor="kg-company">{t('graph.filter.company')}</label>
            {selectFilter('kg-company', isPlatform ? company : (organizations[0]?.id || ''), setCompany,
              organizations.map(o => ({ value: o.id, label: o.name })), isPlatform ? t('graph.filter.allOrganizations') : null,
              { 'data-testid': 'kg-filter-company', disabled: !isPlatform })}
            <label htmlFor="kg-language">{t('graph.filter.language')}</label>
            {selectFilter('kg-language', language, setLanguage, languages.map(l => ({ value: l, label: languageName(l, lang) })), t('graph.filter.allLanguages'), { 'data-testid': 'kg-filter-language' })}
            <label htmlFor="kg-skill">{t('graph.filter.skill')}</label>
            {selectFilter('kg-skill', skill, setSkill, nodes.filter(n => n.kind === 'skill').map(n => ({ value: n.id, label: n.label })).sort((a, b) => a.label.localeCompare(b.label)), t('graph.filter.all'))}
          </div>
          <label className="kg-toggle">
            <input type="checkbox" data-testid="kg-toggle-real" checked={showReal} onChange={(e) => setShowReal(e.target.checked)} />
            {t('graph.view.realLinks')}
          </label>
          <Button variant="outline" size="sm" className="w-full" onClick={resetGraph}>{t('graph.reset')}</Button>

          </div>
        </aside>

        {/* The graph. */}
        <section className="kg-stage">
          {loading ? (
            <Skeleton className="h-[640px] w-full rounded-[var(--panel-radius)]" />
          ) : error ? null : graphData.nodes.length === 0 ? (
            <div className="kg-empty">
              <Share2 className="size-10 text-muted-foreground" />
              <p className="font-semibold">{t('graph.empty.title')}</p>
              <p className="max-w-sm text-sm text-muted-foreground">{t('graph.empty.description')}</p>
            </div>
          ) : (
            <div ref={containerRef} data-testid="knowledge-graph-canvas" className="kg-canvas" style={{ height: graphHeight }}>
              <ForceGraph2D
                ref={fgRef}
                width={graphWidth}
                height={graphHeight}
                graphData={graphData}
                warmupTicks={40}
                cooldownTicks={180}
                onEngineStop={() => { if (autoFit.current) { fitView(); autoFit.current = false; } }}
                nodeLabel={() => ''}
                onNodeHover={(n) => setHovered(n ? n.id : null)}
                onNodeClick={(n) => { if (n.kind === 'department') { setSelectedId(null); setDepartmentFocus(n.label); } else focusNode(n.id); }}
                onBackgroundClick={clearFocus}
                onNodeDragEnd={(n) => { n.fx = n.x; n.fy = n.y; }}
                linkColor={(l) => {
                  const s = endId(l.source);
                  const tt = endId(l.target);
                  if (focusSet) {
                    const touches = focusId ? (s === focusId || tt === focusId) : (focusSet.has(s) && focusSet.has(tt));
                    return touches ? (EDGE_COLORS[l.type] || QUIET_LINK) : FADED_LINK;
                  }
                  return REAL_LINK_TYPES.has(l.type) ? REAL_LINK : QUIET_LINK;
                }}
                linkWidth={(l) => (REAL_LINK_TYPES.has(l.type) ? Math.min(1.5 + (l.value || 1) * 0.5, 4) : (focusSet ? 1.2 : 0.7))}
                nodePointerAreaPaint={(node, color, ctx) => {
                  ctx.fillStyle = color;
                  ctx.beginPath();
                  ctx.arc(node.x, node.y, radius(node) + 2, 0, 2 * Math.PI);
                  ctx.fill();
                }}
                nodeCanvasObject={(node, ctx, globalScale) => {
                  const r = radius(node);
                  const isDepartment = node.kind === 'department';
                  const inFocus = !focusSet || focusSet.has(node.id);
                  ctx.globalAlpha = inFocus ? 1 : 0.12;
                  ctx.beginPath();
                  if (isDepartment) {
                    ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
                  } else {
                    ctx.moveTo(node.x, node.y - r); ctx.lineTo(node.x + r, node.y);
                    ctx.lineTo(node.x, node.y + r); ctx.lineTo(node.x - r, node.y); ctx.closePath();
                  }
                  ctx.fillStyle = isDepartment ? (departmentColor.get(node.label) || OTHER_DEPARTMENT) : SKILL_COLOR;
                  ctx.fill();
                  ctx.lineWidth = 1.5 / globalScale;
                  ctx.strokeStyle = '#ffffff';
                  ctx.stroke();
                  if (node.id === selectedId) {
                    ctx.beginPath();
                    ctx.arc(node.x, node.y, r + 3.5 / globalScale + 1, 0, 2 * Math.PI);
                    ctx.lineWidth = 2 / globalScale;
                    ctx.strokeStyle = '#ff6b57';
                    ctx.stroke();
                  }
                  // Labels stay one size on screen, with a white halo.
                  const showLabel = inFocus && (labelled.has(node.id) || globalScale > 2.2 || (focusSet && focusSet.has(node.id)));
                  if (showLabel) {
                    const fontSize = (isDepartment ? 12 : 11) / globalScale;
                    ctx.font = `${isDepartment ? 600 : 500} ${fontSize}px 'Inter Variable', Inter, sans-serif`;
                    ctx.textBaseline = 'middle';
                    ctx.lineJoin = 'round';
                    ctx.lineWidth = 3 / globalScale;
                    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
                    ctx.strokeText(node.label, node.x + r + 4 / globalScale, node.y);
                    ctx.fillStyle = isDepartment ? '#1e1b3a' : '#5a5870';
                    ctx.fillText(node.label, node.x + r + 4 / globalScale, node.y);
                  }
                  ctx.globalAlpha = 1;
                }}
              />
              <div className="kg-zoom" role="group" aria-label={t('graph.zoom')}>
                <button type="button" onClick={() => zoomBy(1.4)} aria-label={t('graph.zoomIn')} title={t('graph.zoomIn')}><Plus /></button>
                <button type="button" onClick={() => zoomBy(1 / 1.4)} aria-label={t('graph.zoomOut')} title={t('graph.zoomOut')}><Minus /></button>
                <button type="button" onClick={() => fitView()} aria-label={t('graph.fit')} title={t('graph.fit')}><Scan /></button>
                <button type="button" onClick={toggleFullScreen} aria-pressed={fullScreen} aria-label={t(fullScreen ? 'graph.exitFullScreen' : 'graph.fullScreen')} title={t(fullScreen ? 'graph.exitFullScreen' : 'graph.fullScreen')}>{fullScreen ? <Shrink /> : <Expand />}</button>
              </div>
              <div className="kg-legend">
                {view === 'bipartite' ? <>
                  <span><i className="kg-line" style={{ background: EDGE_COLORS.can_teach }} />{t('graph.legend.canTeach')}</span>
                  <span><i className="kg-line" style={{ background: EDGE_COLORS.wants_to_learn }} />{t('graph.legend.wantsToLearn')}</span>
                  <span><i className="kg-mark is-skill" />{t('graph.legend.skill')}</span>
                </> : <span>{t('graph.legend.peerLink')}</span>}
                {showReal && <span><i className="kg-line is-thick" style={{ background: EDGE_COLORS.session }} />{t('graph.legend.real')}</span>}
                <span className="kg-muted">{t('graph.legend.size')}</span>
              </div>
              {/* What is selected, as a card over the graph so the graph keeps its width. */}
              {selected && selected.kind === 'skill' && <aside className="kg-detail-card" aria-label={t('graph.details')} aria-live="polite">
                <div className="kg-detail-head">
                  <span className={cn('kg-mark is-large', selected.kind === 'skill' && 'is-skill')} />
                  <div><h2>{selected.label}</h2><p>{t('graph.kind.skill')}</p></div>
                  <button type="button" className="kg-close" onClick={clearFocus} aria-label={t('graph.close')}><X /></button>
                </div>
                <h3>{t('graph.details.taughtBy', { count: (relations.get(selected.id)?.taughtBy || []).reduce((sum, row) => sum + row.count, 0) })}</h3>{groupChips(relations.get(selected.id)?.taughtBy || [], t('graph.details.nobody'))}
                <h3>{t('graph.details.wantedBy', { count: (relations.get(selected.id)?.wantedBy || []).reduce((sum, row) => sum + row.count, 0) })}</h3>{groupChips(relations.get(selected.id)?.wantedBy || [], t('graph.details.nobody'))}
              </aside>}
            </div>
          )}
        </section>

      </div>

      {/* Where to start: the biggest skill gaps and the best-connected people. */}
      <div className="kg-insights">
        <section className="kg-card" aria-label={t('graph.insights.gaps')}>
          <h3>{t('graph.insights.gaps')}</h3>
          {skillGaps.length ? <ol className="kg-ranked">{skillGaps.map(g => <li key={g.id}><button type="button" onClick={() => focusNode(g.id)}>
            <span className="kg-ranked-label">{g.label}</span>
            <span className="kg-bar" aria-hidden="true">
              <i className="is-wanted" style={{ width: `${(g.wanted / Math.max(...skillGaps.map(x => x.wanted), 1)) * 100}%` }} />
              <i className="is-taught" style={{ width: `${(g.taught / Math.max(...skillGaps.map(x => x.wanted), 1)) * 100}%` }} />
            </span>
            <small>{t('graph.insights.gapCounts', { wanted: g.wanted, taught: g.taught })}</small>
          </button></li>)}</ol> : <p className="kg-muted">{t('graph.details.none')}</p>}
        </section>
        <section className="kg-card is-pairs" aria-label={t('graph.insights.pairs')}>
          <h3>{t('graph.insights.pairs')}</h3>
          {departmentPairs.length ? <ol className="kg-ranked">{departmentPairs.map(pair => <li key={`${pair.a}-${pair.b}-${pair.type}`}><div className="kg-ranked-row">
            <span className="kg-ranked-label">
              <i className="kg-mark" style={{ background: departmentColor.get(pair.a) || OTHER_DEPARTMENT }} />{pair.a === pair.b ? t('graph.insights.within', { department: pair.a }) : `${pair.a} ↔ ${pair.b}`}
            </span>
            <span className="kg-bar" aria-hidden="true"><i className="is-links" style={{ width: `${(pair.count / departmentPairs[0].count) * 100}%` }} /></span>
            <small>{t('graph.insights.pairCount', { count: pair.count })}</small>
          </div></li>)}</ol> : <p className="kg-muted">{t('graph.insights.noPairs')}</p>}
        </section>
      </div>
      <p className="kg-hint">{t('graph.hoverHint')}</p>
    </PageShell>
  );
}
