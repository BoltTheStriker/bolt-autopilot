"use client";

// Animation primitives, timed like strikefinance.org: 0.5–0.8s ease-out, elements staggered
// 0.1–0.3s apart, rising a little and sharpening from a blur. MotionConfig honours the
// visitor's "reduce motion" setting, which turns all of this into plain fades.
import { motion, MotionConfig, type HTMLMotionProps } from "motion/react";
import { Fragment } from "react";

export const EASE = [0.22, 1, 0.36, 1] as const; // smooth ease-out (quart-like)

export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

type Rise = { delay?: number; y?: number; blur?: number; duration?: number } & Omit<HTMLMotionProps<"div">, "initial" | "animate" | "transition">;

/** Plays once on page load: rise + unblur + fade. `delay` is in seconds. */
export function FadeUp({ delay = 0, y = 24, blur = 10, duration = 0.8, ...rest }: Rise) {
  return (
    <motion.div
      initial={{ opacity: 0, y, filter: `blur(${blur}px)` }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ duration, delay, ease: EASE }}
      {...rest}
    />
  );
}

/** Same motion, but triggered when the element scrolls into view (once). */
export function InView({ delay = 0, y = 28, blur = 8, duration = 0.8, ...rest }: Rise) {
  return (
    <motion.div
      initial={{ opacity: 0, y, filter: `blur(${blur}px)` }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, margin: "0px 0px -12% 0px" }}
      transition={{ duration, delay, ease: EASE }}
      {...rest}
    />
  );
}

/** Headline that rises in word by word. Pieces are [text, className] pairs so words can carry styles (italic, gradient). */
export function SplitWords({
  pieces,
  delay = 0,
  stagger = 0.08,
  className = "",
}: {
  pieces: [string, string?][];
  delay?: number;
  stagger?: number;
  className?: string;
}) {
  const words = pieces.flatMap(([text, cls]) => text.split(" ").filter(Boolean).map((w) => [w, cls ?? ""] as const));
  return (
    <span className={className}>
      {words.map(([w, cls], i) => (
        // The space must sit outside the inline-block, or the browser drops it.
        <Fragment key={i}>
          <motion.span
            className={`inline-block ${cls}`}
            initial={{ opacity: 0, y: "0.45em", filter: "blur(12px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: 0.9, delay: delay + i * stagger, ease: EASE }}
          >
            {w}
          </motion.span>
          {i < words.length - 1 && " "}
        </Fragment>
      ))}
    </span>
  );
}

/** Pops in after load (floating cards around the mascot). */
export function PopIn({ delay = 0, ...rest }: { delay?: number } & Omit<HTMLMotionProps<"div">, "initial" | "animate" | "transition">) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.88, y: 12, filter: "blur(6px)" }}
      animate={{ opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }}
      transition={{ type: "spring", stiffness: 220, damping: 22, delay }}
      {...rest}
    />
  );
}
