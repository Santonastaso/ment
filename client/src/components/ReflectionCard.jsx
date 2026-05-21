import React from 'react';

export default function ReflectionCard({ session }) {
  const mentor = session.mentor;
  return (
    <div className="card p-5 border-l-4 border-green-400">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <p className="font-medium text-foreground text-sm">{session.title}</p>
          <p className="text-xs text-gray-500">with {mentor?.name} · {mentor?.department}</p>
        </div>
        {session.scheduled_at && (
          <span className="text-xs text-gray-400 flex-shrink-0">
            {new Date(session.scheduled_at).toLocaleDateString(undefined, { dateStyle: 'medium' })}
          </span>
        )}
      </div>
      <p className="text-sm text-gray-600 italic">"{session.reflection}"</p>
    </div>
  );
}
