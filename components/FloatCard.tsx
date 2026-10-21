/** Glass notification card floating over the hero art. */
export function FloatCard({ className, icon, title, sub, value, valueClass = "text-mint" }: {
  className: string;
  icon: React.ReactNode;
  title: string;
  sub: string;
  value: React.ReactNode;
  valueClass?: string;
}) {
  return (
    <div className={`card absolute z-20 flex min-w-[200px] items-center gap-3 rounded-2xl px-3.5 py-3 backdrop-blur-xl ${className}`}>
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/6">{icon}</span>
      <div className="min-w-0">
        <p className="text-[11px] text-muted">{sub}</p>
        <p className="truncate text-sm font-medium">{title}</p>
      </div>
      <span className={`ml-auto pl-2 font-mono text-sm font-medium ${valueClass}`}>{value}</span>
    </div>
  );
}
