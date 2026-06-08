import { ReactNode } from "react";

export default function Section({
  id,
  anchor,
  label,
  children,
  noBorder = false,
  glow = false,
}: {
  id?: string;
  anchor: string;
  label?: string;
  children: ReactNode;
  noBorder?: boolean;
  glow?: boolean;
}) {
  return (
    <section
      id={id}
      className={`relative scroll-mt-20 ${noBorder ? "" : "border-b border-border"}`}
    >
      {glow && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 overflow-hidden"
        >
          <div className="absolute right-[-8%] top-[-10%] h-[440px] w-[560px] rounded-full bg-amber/[0.045] blur-[150px]" />
        </div>
      )}
      <div className="relative mx-auto max-w-[1240px] px-6 py-24 md:py-32">
        <div className="mb-12 md:mb-16 flex items-baseline gap-5">
          {label && (
            <span className="font-display text-amber glow-amber text-4xl md:text-5xl leading-none tabular">
              {label}
            </span>
          )}
          <div className="flex items-baseline gap-3 text-xs md:text-sm">
            <span className="text-amber select-none">$</span>
            <code className="text-phosphor">{anchor}</code>
            <span className="cursor inline-block" aria-hidden />
          </div>
        </div>
        {children}
      </div>
    </section>
  );
}
