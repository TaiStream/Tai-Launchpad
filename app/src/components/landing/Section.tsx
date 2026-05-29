import { ReactNode } from "react";

export default function Section({
  id,
  anchor,
  label,
  children,
  noBorder = false,
}: {
  id?: string;
  anchor: string;
  label?: string;
  children: ReactNode;
  noBorder?: boolean;
}) {
  return (
    <section
      id={id}
      className={`scroll-mt-20 ${noBorder ? "" : "border-b border-border"}`}
    >
      <div className="mx-auto max-w-[1240px] px-6 py-24 md:py-32">
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
