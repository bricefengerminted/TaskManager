import type { DocStatus } from '@shared/types';

export const DOC_STATUS_META: Record<DocStatus, { icon: string; label: string; className: string }> = {
  done: { icon: '✅', label: 'Done', className: 'bg-green-50 text-green-700 border-green-200' },
  draft: { icon: '📝', label: 'Draft', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  review: { icon: '📄', label: 'Published — tick task', className: 'bg-sky-50 text-sky-700 border-sky-200' },
  due_soon: { icon: '⏳', label: 'Due soon', className: 'bg-yellow-50 text-yellow-800 border-yellow-200' },
  overdue: { icon: '🔴', label: 'Overdue', className: 'bg-red-50 text-red-700 border-red-200' },
  missing: { icon: '⚪', label: 'Missing', className: 'bg-slate-50 text-slate-600 border-slate-200' },
  waived: { icon: '➖', label: 'Not required', className: 'bg-slate-50 text-slate-400 border-slate-200' },
  cant_date: { icon: '❓', label: "Can't date", className: 'bg-purple-50 text-purple-700 border-purple-200' },
  inactive: { icon: '·', label: 'Later', className: 'bg-white text-slate-300 border-slate-100' },
};

export const FLAG_LABELS: Record<string, string> = {
  no_hub: 'No hub page',
  roadmap_item_missing: 'Gone from roadmap',
  awaiting_decision: 'Awaiting decision',
  go_not_on_roadmap: 'Go, not on roadmap',
  revisit_due: 'Revisit due',
  link_mismatch: 'Link mismatch',
};

export function DocStatusChip({ status, compact = false, title }: { status: DocStatus; compact?: boolean; title?: string }) {
  const meta = DOC_STATUS_META[status];
  return (
    <span
      title={title ?? meta.label}
      className={`inline-flex items-center gap-1 border rounded-full text-xs ${compact ? 'px-1.5 py-0.5' : 'px-2 py-0.5'} ${meta.className}`}
    >
      <span aria-hidden="true">{meta.icon}</span>
      {compact ? <span className="sr-only">{meta.label}</span> : <span>{meta.label}</span>}
    </span>
  );
}

export function FlagChips({ flags }: { flags: string[] }) {
  if (flags.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {flags.map((f) => (
        <span key={f} className="text-[11px] bg-orange-50 text-orange-700 border border-orange-200 rounded px-1.5 py-0.5">
          {FLAG_LABELS[f] ?? f}
        </span>
      ))}
    </span>
  );
}
