import { useState } from 'react';
import { useApp } from '../../context/AppContext';

interface Props {
  projectId: string;
  onClose: () => void;
}

interface ParsedSlack {
  author: string;
  timestamp: string;
  body: string;
  title: string;
}

function parseSlackMessage(raw: string): ParsedSlack {
  // Slack copy format: "[timestamp] Author: message body"
  // Also handle plain text without the Slack format
  const slackPattern = /^\[?([^\]]+)\]?\s+([^:]+):\s+([\s\S]+)/;
  const match = raw.trim().match(slackPattern);

  if (match) {
    const [, timestamp, author, body] = match;
    const titleWords = body.trim().split(/\s+/).slice(0, 10).join(' ');
    const title = titleWords + (body.trim().split(/\s+/).length > 10 ? '...' : '');
    return { timestamp: timestamp.trim(), author: author.trim(), body: body.trim(), title };
  }

  // Fallback: use first line as title
  const lines = raw.trim().split('\n');
  const firstLine = lines[0].trim();
  return {
    timestamp: '',
    author: '',
    body: raw.trim(),
    title: firstLine.length > 80 ? firstLine.slice(0, 77) + '...' : firstLine,
  };
}

export function SlackPasteModal({ projectId, onClose }: Props) {
  const { createTask } = useApp();
  const [raw, setRaw] = useState('');
  const [parsed, setParsed] = useState<ParsedSlack | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState<'paste' | 'review'>('paste');

  const handleParse = () => {
    if (!raw.trim()) return;
    const p = parseSlackMessage(raw);
    setParsed(p);
    setTitle(p.title);
    const desc = [
      p.author ? `Reported by: ${p.author}` : '',
      p.timestamp ? `Slack timestamp: ${p.timestamp}` : '',
      '',
      p.body,
    ].filter(Boolean).join('\n');
    setDescription(desc.trim());
    setStep('review');
  };

  const handleCreate = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      await createTask(projectId, {
        title,
        description,
        status: 'todo',
        priority: 'medium',
        source: 'slack',
        slack_raw: raw,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h3 className="font-semibold text-slate-800">New Task from Slack</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              {step === 'paste' ? 'Paste a Slack message to auto-create a task' : 'Review and edit before saving'}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6">
          {step === 'paste' ? (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Paste Slack message
                </label>
                <textarea
                  value={raw}
                  onChange={(e) => setRaw(e.target.value)}
                  placeholder={'[10:32 AM] Jane Doe: Hey, we need to fix the search results pagination before the release. It\'s showing duplicates on page 2.'}
                  rows={6}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                  autoFocus
                />
                <p className="text-xs text-slate-400 mt-1">
                  Tip: In Slack, right-click a message → Copy text
                </p>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handleParse}
                  disabled={!raw.trim()}
                  className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white px-4 py-2 rounded-lg text-sm font-medium"
                >
                  Parse Message →
                </button>
                <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {parsed && (
                <div className="bg-slate-50 rounded-lg px-3 py-2 text-xs text-slate-500 border border-slate-200">
                  {parsed.author && <span><strong>From:</strong> {parsed.author} </span>}
                  {parsed.timestamp && <span><strong>at</strong> {parsed.timestamp}</span>}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Task Title *</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                />
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handleCreate}
                  disabled={saving || !title.trim()}
                  className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white px-4 py-2 rounded-lg text-sm font-medium"
                >
                  {saving ? 'Creating...' : 'Create Task'}
                </button>
                <button onClick={() => setStep('paste')} className="px-4 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100">
                  ← Back
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
