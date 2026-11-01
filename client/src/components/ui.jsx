import { useEffect } from 'react';
import { Loader2, X, TriangleAlert, Info } from 'lucide-react';

const cx = (...a) => a.filter(Boolean).join(' ');
export { cx };

const BTN = {
  primary: 'bg-lime text-bg hover:bg-[#9be565] active:bg-[#76c845] font-semibold',
  brand: 'bg-brand text-white hover:bg-[#2fba37] font-semibold',
  ghost: 'bg-raised text-text hover:bg-[#23503f] border border-line',
  quiet: 'text-sage hover:text-text hover:bg-raised',
  danger: 'bg-danger text-bg hover:bg-[#f2837d] font-semibold',
  dangerGhost: 'text-danger border border-danger/50 hover:bg-danger/10',
};
export function Button({ variant = 'primary', size = 'md', busy, icon: Icon, children, className, disabled, ...p }) {
  const sz = size === 'sm' ? 'h-9 px-3 text-sm gap-1.5' : size === 'lg' ? 'h-14 px-6 text-lg gap-2' : 'h-11 px-4 gap-2';
  return (
    <button {...p} disabled={disabled || busy} className={cx('inline-flex items-center justify-center rounded-xl transition-colors disabled:opacity-45 disabled:cursor-not-allowed select-none whitespace-nowrap', sz, BTN[variant], className)}>
      {busy ? <Loader2 className="size-4 animate-spin" /> : Icon ? <Icon className="size-[1.1em]" /> : null}
      {children}
    </button>
  );
}

export const Card = ({ className, children, ...p }) => <div {...p} className={cx('rounded-2xl bg-surface border border-line/70 p-4', className)}>{children}</div>;

export function Field({ label, hint, error, children }) {
  return (
    <label className="block">
      {label && <span className="block text-sm font-medium text-sage mb-1.5">{label}</span>}
      {children}
      {hint && !error && <span className="block text-xs text-sage/80 mt-1">{hint}</span>}
      {error && <span className="block text-xs text-danger mt-1">{error}</span>}
    </label>
  );
}
export const inputCls = 'w-full h-11 rounded-xl bg-bg border border-line px-3 text-text placeholder:text-sage/50 focus:border-lime focus:outline-none';
export const Input = ({ className, ...p }) => <input {...p} className={cx(inputCls, className)} />;

export function Toggle({ checked, onChange, label, hint, disabled }) {
  return (
    <label className={cx('flex items-start justify-between gap-4 py-2', disabled && 'opacity-50')}>
      <span><span className="block text-text">{label}</span>{hint && <span className="block text-xs text-sage mt-0.5">{hint}</span>}</span>
      <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
        className={cx('relative shrink-0 mt-0.5 h-7 w-12 rounded-full transition-colors', checked ? 'bg-brand' : 'bg-line')}>
        <span className={cx('absolute top-0.5 left-0.5 size-6 rounded-full bg-text transition-transform', checked && 'translate-x-5')} />
      </button>
    </label>
  );
}

export function Slider({ label, value, min, max, step = 1, unit = '', onChange, hint, disabled }) {
  return (
    <div className="py-2">
      <div className="flex justify-between text-sm"><span className="text-text">{label}</span><span className="font-display text-lg text-lime leading-none">{value}{unit}</span></div>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} className="w-full mt-2 h-8" aria-label={label} />
      {hint && <div className="text-xs text-sage">{hint}</div>}
    </div>
  );
}

export function Segmented({ value, onChange, options, className }) {
  return (
    <div className={cx('grid gap-1 p-1 rounded-xl bg-bg border border-line', className)} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0,1fr))` }} role="tablist">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={value === o.value} onClick={() => onChange(o.value)}
          className={cx('h-9 rounded-lg text-sm font-medium transition-colors', value === o.value ? 'bg-raised text-lime' : 'text-sage hover:text-text')}>{o.label}</button>
      ))}
    </div>
  );
}

export const Badge = ({ tone = 'neutral', children, className }) => (
  <span className={cx('inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold', className,
    { neutral: 'bg-raised text-sage', good: 'bg-brand/25 text-lime', bad: 'bg-danger/20 text-danger', info: 'bg-info/15 text-info' }[tone])}>{children}</span>
);

export function Avatar({ src, name = '?', size = 36, ring }) {
  const s = { width: size, height: size };
  return src
    ? <img src={src} alt="" referrerPolicy="no-referrer" style={s} className={cx('rounded-full object-cover bg-raised shrink-0', ring && 'ring-2', ring)} />
    : <span style={{ ...s, fontSize: size * 0.42 }} className={cx('rounded-full bg-raised text-lime font-display font-bold grid place-items-center shrink-0', ring && 'ring-2', ring)}>{name.slice(0, 1).toUpperCase()}</span>;
}

export const Spinner = ({ label = 'Loading' }) => <div className="grid place-items-center py-16 text-sage gap-2" role="status"><Loader2 className="size-7 animate-spin text-lime" /><span className="text-sm">{label}</span></div>;

export function Banner({ tone = 'info', children, onClose, className }) {
  const t = { info: 'bg-info/10 border-info/40 text-info', warn: 'bg-[#f2c14e]/10 border-[#f2c14e]/40 text-[#f2c14e]', bad: 'bg-danger/10 border-danger/50 text-danger', good: 'bg-brand/15 border-brand/50 text-lime' }[tone];
  const Icon = tone === 'bad' || tone === 'warn' ? TriangleAlert : Info;
  return (
    <div role="status" className={cx('flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm', t, className)}>
      <Icon className="size-4 mt-0.5 shrink-0" /><div className="flex-1 text-text/95">{children}</div>
      {onClose && <button onClick={onClose} aria-label="Dismiss"><X className="size-4" /></button>}
    </div>
  );
}

export function Sheet({ open, onClose, title, children, tall }) {
  useEffect(() => {
    if (!open) return;
    const k = (e) => e.key === 'Escape' && onClose?.();
    addEventListener('keydown', k); return () => removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div role="dialog" aria-modal="true" aria-label={title} className={cx('sheet-in w-full sm:max-w-lg bg-surface border border-line rounded-t-3xl sm:rounded-3xl flex flex-col safe-bottom', tall ? 'max-h-[92dvh]' : 'max-h-[85dvh]')}>
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <h2 className="font-display text-2xl font-bold">{title}</h2>
          {onClose && <button onClick={onClose} aria-label="Close" className="p-2 -mr-2 text-sage hover:text-text"><X className="size-5" /></button>}
        </div>
        <div className="px-5 pb-4 scroll-y">{children}</div>
      </div>
    </div>
  );
}

export function Confirm({ open, title, body, confirmLabel = 'Confirm', danger, onConfirm, onClose, busy }) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <p className="text-sage mb-4">{body}</p>
      <div className="flex gap-2 justify-end"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant={danger ? 'danger' : 'primary'} busy={busy} onClick={onConfirm}>{confirmLabel}</Button></div>
    </Sheet>
  );
}

export function Toasts({ toasts }) {
  return (
    <div className="fixed z-[60] top-0 inset-x-0 safe-top px-3 pt-2 pointer-events-none flex flex-col items-center gap-2" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={cx('sheet-in pointer-events-auto max-w-md w-full rounded-xl px-4 py-3 text-sm shadow-xl border',
          { info: 'bg-surface border-line', good: 'bg-[#1d5a28] border-brand', warn: 'bg-[#4a3d12] border-[#f2c14e]/60', danger: 'bg-[#5a1f1c] border-danger' }[t.kind] || 'bg-surface border-line')}>{t.msg}</div>
      ))}
    </div>
  );
}

export const Progress = ({ value, tone = 'lime' }) => (
  <div className="h-2 rounded-full bg-bg overflow-hidden"><div className={cx('h-full rounded-full transition-[width] duration-500', tone === 'danger' ? 'bg-danger' : 'bg-lime')} style={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }} /></div>
);

export const Empty = ({ title, children }) => <div className="text-center py-8 text-sage"><div className="font-display text-xl text-text mb-1">{title}</div><div className="text-sm">{children}</div></div>;
export const PageShell = ({ children, className }) => <div className={cx('min-h-dvh safe-top', className)}>{children}</div>;
