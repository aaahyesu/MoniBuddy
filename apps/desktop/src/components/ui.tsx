import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/cn";

type Props = {
  children: ReactNode;
  className?: string;
  wide?: boolean;
};

/** ADRIFT-inspired pixel panel: sharp white border + translucent black */
export function ShellCard({ children, className, wide }: Props) {
  return (
    <div className="grid min-h-screen place-items-center p-5">
      <div
        className={cn(
          "grid w-full gap-4 border border-white bg-black/80 p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.15)] backdrop-blur-[2px]",
          wide ? "max-w-[520px]" : "max-w-[420px]",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

export function Brand({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="grid gap-2 text-center">
      <div className="relative inline-block justify-self-center text-[clamp(1.4rem,4vw,1.85rem)] font-bold uppercase tracking-[0.06em] text-white [text-shadow:0_3px_0_rgba(255,255,255,0.35),0_6px_0_rgba(255,255,255,0.18),0_9px_0_rgba(255,255,255,0.08)]">
        {title}
      </div>
      {subtitle ? (
        <p className="m-0 text-[0.78rem] leading-relaxed tracking-wide text-mute">
          {subtitle}
        </p>
      ) : null}
      <div className="mt-1 h-px w-full bg-white opacity-85" />
    </div>
  );
}

export function Btn({
  children,
  className,
  variant = "default",
  size = "md",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "ghost";
  size?: "md" | "lg";
}) {
  return (
    <button
      type={type}
      className={cn(
        "cursor-pointer border text-center uppercase tracking-wide transition disabled:cursor-not-allowed disabled:opacity-40",
        size === "md" && "px-4 py-2.5 text-[0.78rem]",
        size === "lg" && "w-full px-4 py-3.5 text-[0.85rem] font-bold",
        variant === "default" &&
          "border-white bg-transparent text-white hover:bg-white/10",
        variant === "primary" &&
          "border-white bg-white font-bold text-black hover:bg-[#e8e8e8]",
        variant === "ghost" &&
          "border-transparent bg-transparent text-mute normal-case tracking-normal hover:text-white",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="grid gap-2 text-left text-[0.72rem] uppercase tracking-wider text-mute">
      {label}
      {children}
    </label>
  );
}

export const inputClass =
  "w-full border border-white/70 bg-black/50 px-3 py-2.5 text-[0.9rem] text-white outline-none placeholder:text-white/35 focus:border-white focus:bg-black/70";

export function SectionLabel({
  children,
  tone = "pink",
}: {
  children: ReactNode;
  tone?: "pink" | "purple" | "orange";
}) {
  const dot =
    tone === "pink"
      ? "bg-[#ff66aa]"
      : tone === "purple"
        ? "bg-[#b388ff]"
        : "bg-[#ff9944]";
  return (
    <div className="flex items-center gap-2 text-[0.72rem] font-bold uppercase tracking-wider text-white">
      <span className={cn("inline-block size-2 shrink-0", dot)} />
      {children}
    </div>
  );
}
