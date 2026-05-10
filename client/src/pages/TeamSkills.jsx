import React, { useEffect, useState } from 'react';
import api from '../api/index.js';

// Anonymized team skill-gaps view for managers.
// Two principles baked in:
//   1) No individual attribution. The server returns aggregate counts only.
//   2) Privacy gate. Below 3 direct reports the report is suppressed entirely
//      to prevent trivial de-anonymization.
export default function TeamSkills() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function load() {
      try {
        const res = await api.get('/team/skill-gaps');
        setData(res.data);
      } catch (e) {
        setError(e.response?.data?.error || 'Could not load team report.');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return <div className="card p-8 animate-pulse h-48 bg-gray-100" />;
  }
  if (error) {
    return (
      <div className="card p-6">
        <p className="text-rose-700">{error}</p>
      </div>
    );
  }

  const { reportCount, gated, gaps, strengths, message } = data || {};

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-navy">Team skill landscape</h1>
        <p className="text-gray-500 mt-1">
          An anonymized snapshot of where your direct reports are growing and
          what they collectively bring. Designed to help you plan L&D, never to
          identify individuals.
        </p>
      </div>

      <div className="card p-4 bg-blue-50/40 border-l-4 border-l-navy-light">
        <p className="text-sm text-navy">
          <strong>How this report stays private:</strong> only aggregate
          counts are shown, never names. Reports are suppressed entirely if you
          manage fewer than 3 people, since one or two reports could be
          trivially identified.
        </p>
      </div>

      {/* Empty / gated states */}
      {reportCount === 0 && (
        <div className="card p-8 text-center">
          <div className="text-3xl mb-2">👥</div>
          <p className="text-navy font-semibold">No direct reports linked</p>
          <p className="text-gray-500 text-sm mt-1">{message}</p>
        </div>
      )}

      {gated && (
        <div className="card p-8 text-center">
          <div className="text-3xl mb-2">🔒</div>
          <p className="text-navy font-semibold">Report suppressed for privacy</p>
          <p className="text-gray-500 text-sm mt-1 max-w-md mx-auto">{message}</p>
        </div>
      )}

      {/* Real report */}
      {!gated && reportCount > 0 && (
        <>
          <div className="card p-5">
            <p className="text-sm text-gray-500">Reporting on</p>
            <p className="text-3xl font-bold text-navy mt-1">
              {reportCount}<span className="text-lg text-gray-500 font-medium ml-2">direct reports</span>
            </p>
          </div>

          {/* Skill gaps */}
          <div className="card p-6">
            <h2 className="section-title mb-1">Top 5 gaps in your team</h2>
            <p className="text-xs text-gray-500 mb-4">
              The skills the highest share of your reports are looking to develop. Useful for prioritizing training, peer mentoring, or external workshops.
            </p>
            {gaps.length === 0 ? (
              <p className="text-sm text-gray-400 italic">No skill-gap data yet — your reports may not have completed onboarding.</p>
            ) : (
              <ul className="space-y-2">
                {gaps.map((g, i) => (
                  <SkillRow key={g.skill} rank={i + 1} item={g} reportCount={reportCount} tone="gap" />
                ))}
              </ul>
            )}
          </div>

          {/* Skill strengths */}
          <div className="card p-6">
            <h2 className="section-title mb-1">Top 5 strengths in your team</h2>
            <p className="text-xs text-gray-500 mb-4">
              The skills the highest share of your team already shares — useful for spotting internal mentors before looking outside.
            </p>
            {strengths.length === 0 ? (
              <p className="text-sm text-gray-400 italic">No can-teach data yet.</p>
            ) : (
              <ul className="space-y-2">
                {strengths.map((s, i) => (
                  <SkillRow key={s.skill} rank={i + 1} item={s} reportCount={reportCount} tone="strength" />
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function SkillRow({ rank, item, reportCount, tone }) {
  const barColor = tone === 'gap' ? 'bg-rose-300' : 'bg-emerald-400';
  const trackColor = 'bg-gray-100';
  const barWidth = Math.min(100, Math.max(8, item.share));
  return (
    <li className="flex items-center gap-3">
      <span className="w-6 text-right text-xs font-semibold text-gray-400">{rank}.</span>
      <span className="flex-1 min-w-0">
        <span className="text-sm font-medium text-navy">{item.skill}</span>
      </span>
      <div className={`flex-shrink-0 w-32 ${trackColor} rounded-full h-2 overflow-hidden`}>
        <div className={`${barColor} h-full rounded-full transition-all`} style={{ width: barWidth + '%' }} />
      </div>
      <span className="w-20 text-right text-xs text-gray-600 whitespace-nowrap">
        {item.count} of {reportCount} <span className="text-gray-400">({item.share}%)</span>
      </span>
    </li>
  );
}
