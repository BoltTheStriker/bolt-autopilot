"use client";

// Share a result: the card image, a link whose preview on X is that card, a post on X and a PNG download.
// The demo's card travels in the link; a real account's card is read from the Bolt server by share id.
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";

const HOST = "https://autopilot.boltstriker.io";

/** setup: the demo's rules for a "start with my setup" link (a real account's link uses its share id). */
export type ShareSource = { kind: "demo"; d: string; setup: string; text: string } | { kind: "real"; getId: () => Promise<string>; text: string };

export function ShareModal({ open, source, onClose }: { open: boolean; source: ShareSource | null; onClose: () => void }) {
  const [query, setQuery] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [setupCopied, setSetupCopied] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // The demo's query is known at once; a real account asks the server for its share id first.
  const demoQuery = source?.kind === "demo" ? `d=${source.d}` : null;
  useEffect(() => {
    if (!open || source?.kind !== "real") return;
    let alive = true;
    source.getId().then(
      (id) => alive && setQuery(`id=${id}`),
      (e: { status?: number }) =>
        alive &&
        setError(
          e?.status && [401, 404, 405].includes(e.status)
            ? "Real-result cards switch on with the server update that's rolling out. The demo card works now."
            : "Couldn't make your share link right now. Try again in a minute.",
        ),
    );
    return () => {
      alive = false;
    };
  }, [open, source]);

  const q = demoQuery ?? query;
  const link = q ? `${HOST}/share?${q}` : null;
  const image = q ? `/api/autopilot-card?${q}` : null;
  const post = link && source ? `https://x.com/intent/post?text=${encodeURIComponent(source.text)}&url=${encodeURIComponent(link)}` : null;
  // "Start with my setup": the rules for a friend (a demo's travel in the link; a real account's are looked up by id).
  const setupLink = source?.kind === "demo" ? `${HOST}/app?setup=${source.setup}` : query ? `${HOST}/app?setup=${query.slice(3)}` : null;
  const copySetup = async () => {
    if (!setupLink) return;
    try {
      await navigator.clipboard.writeText(setupLink);
      setSetupCopied(true);
      setTimeout(() => setSetupCopied(false), 1800);
    } catch {
      setError("Couldn't copy here. Long-press the link to copy it.");
    }
  };

  const close = () => {
    setQuery(null);
    setError("");
    setCopied(false);
    setLoaded(false);
    onClose();
  };
  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Couldn't copy here. Long-press the link to copy it.");
    }
  };

  return (
    <AnimatePresence>
      {open && source && (
        <motion.div className="fixed inset-0 z-[90] grid place-items-center bg-black/70 p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close}>
          <motion.div
            initial={{ y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 16, opacity: 0 }}
            className="w-full max-w-2xl rounded-3xl border border-white/10 bg-[#111413] p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="font-display text-2xl font-semibold">Share your result</h2>
              <button onClick={close} aria-label="Close" className="grid size-8 place-items-center rounded-full text-soft hover:bg-white/10">
                ✕
              </button>
            </div>
            <p className="mt-1 text-sm text-muted">
              {source.kind === "demo" ? "Your demo card, clearly marked as pretend money." : "Your return and rules only: no balances, no wallet address. Numbers come from the Bolt server."}
            </p>

            <div className="relative mt-5 aspect-[1200/630] w-full overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
              {image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={image} alt="Your result card" className={`h-full w-full transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`} onLoad={() => setLoaded(true)} onError={() => setError("The card didn't load. Try again in a minute.")} />
              )}
              {!loaded && !error && <div className="absolute inset-0 animate-pulse bg-white/[0.04]" />}
            </div>

            {error && <p className="mt-4 rounded-xl border border-neg/30 bg-neg/10 px-3 py-2 text-sm text-neg">{error}</p>}

            <div className="mt-5 flex flex-wrap gap-2">
              <a
                href={post ?? undefined}
                target="_blank"
                rel="noreferrer"
                aria-disabled={!post}
                className={`rounded-full bg-mint px-5 py-2.5 text-sm font-semibold text-ink ${post ? "hover:bg-mint-2" : "pointer-events-none opacity-50"}`}
              >
                Post on X
              </a>
              <a href={image ? `${image}&download=1` : undefined} aria-disabled={!image} className={`glass rounded-full px-5 py-2.5 text-sm ${image ? "" : "pointer-events-none opacity-50"}`}>
                Download image
              </a>
              <button onClick={() => void copy()} disabled={!link} className="glass rounded-full px-5 py-2.5 text-sm disabled:opacity-50">
                {copied ? "Link copied" : "Copy link"}
              </button>
            </div>

            <div className="mt-5 rounded-2xl border border-mint/20 bg-mint/[0.04] p-4">
              <p className="font-display font-semibold">Share your setup</p>
              <p className="mt-0.5 text-xs text-muted">
                A link that starts a friend with your rules; they choose their own budget.{" "}
                {source.kind === "real" ? "Your verified result goes with it. No balances, no wallet." : "Marked as a demo setup."}
              </p>
              <div className="mt-3 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-xl bg-white/[0.04] px-3 py-2 font-mono text-[11px] text-soft">{setupLink ?? "…"}</code>
                <button onClick={() => void copySetup()} disabled={!setupLink} className="shrink-0 rounded-full bg-mint px-4 py-2 text-xs font-semibold text-ink transition hover:bg-mint-2 disabled:opacity-50">
                  {setupCopied ? "Copied" : "Copy setup link"}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
