"use client";

import { useEffect, useRef, useState } from "react";

/** Share sheet for a demo result: the PnL card, plus post / download / copy / native share. */
export function ShareModal({ image, link, text, filename, onClose }: { image: string; link: string; text: string; filename: string; onClose: () => void }) {
  const [note, setNote] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [canNativeShare, setCanNativeShare] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Escape closes; focus starts on the close button; the page behind doesn't scroll.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const t = setTimeout(() => setCanNativeShare(typeof navigator !== "undefined" && "share" in navigator && "canShare" in navigator), 0);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      clearTimeout(t);
    };
  }, [onClose]);

  const flash = (msg: string) => {
    setNote(msg);
    setTimeout(() => setNote(""), 2200);
  };
  const blob = async () => (await fetch(image)).blob();

  async function copyImage() {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob() })]);
      flash("Image copied: paste it into your post");
    } catch {
      flash("This browser can't copy images. Use Download instead.");
    }
  }
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      flash("Link copied");
    } catch {
      flash(link);
    }
  }
  async function nativeShare() {
    try {
      const file = new File([await blob()], filename, { type: "image/png" });
      const data: ShareData = navigator.canShare?.({ files: [file] }) ? { files: [file], text: `${text} ${link}` } : { text, url: link };
      await navigator.share(data);
    } catch {}
  }

  const btn = "flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold transition";
  return (
    <div role="dialog" aria-modal="true" aria-label="Share your result" className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-6" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-t-3xl border border-white/10 bg-[#0d100f] p-5 shadow-2xl sm:rounded-3xl sm:p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold">Share your result</h2>
          <button ref={closeRef} onClick={onClose} aria-label="Close" className="grid size-9 place-items-center rounded-full text-soft hover:bg-white/10 hover:text-white">
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </div>

        <div className="relative mt-4 aspect-[1200/630] w-full overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
          {!loaded && <div className="absolute inset-0 animate-pulse bg-white/[0.04]" />}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image} alt="Your demo result card" className={`h-full w-full object-cover transition-opacity ${loaded ? "opacity-100" : "opacity-0"}`} onLoad={() => setLoaded(true)} />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <a
            href={`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(link)}`}
            target="_blank"
            rel="noreferrer"
            className={`${btn} col-span-2 bg-mint text-ink hover:bg-mint-2 sm:col-span-1`}
          >
            <svg viewBox="0 0 24 24" className="size-4" fill="currentColor"><path d="M17.7 3h3.1l-6.8 7.8L22 21h-6.3l-4.9-6.4L5.2 21H2.1l7.3-8.3L1.8 3h6.4l4.4 5.8L17.7 3Zm-1.1 16.2h1.7L7.3 4.7H5.5l11.1 14.5Z" /></svg>
            Post on X
          </a>
          <a href={`${image}${image.includes("?") ? "&" : "?"}download=1`} download={filename} className={`${btn} glass hover:bg-white/10`}>
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12m0 0 5-5m-5 5-5-5M4 21h16" /></svg>
            Download
          </a>
          <button onClick={copyImage} className={`${btn} glass hover:bg-white/10`}>
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="8" y="8" width="13" height="13" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></svg>
            Copy image
          </button>
          <button onClick={copyLink} className={`${btn} glass hover:bg-white/10`}>
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" /><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" /></svg>
            Copy link
          </button>
          {canNativeShare && (
            <button onClick={nativeShare} className={`${btn} glass hover:bg-white/10 sm:col-span-4`}>
              <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" /></svg>
              Share…
            </button>
          )}
        </div>
        <p className="mt-3 min-h-5 text-center text-xs text-mint" aria-live="polite">{note}</p>
        <p className="text-center text-[11px] text-white/35">Demo · fake money. Your wallet address isn&apos;t shown on the card.</p>
      </div>
    </div>
  );
}
