export default function Loading() {
  return (
    <div className="mx-auto max-w-7xl px-5 py-12 md:px-8">
      <div className="mb-6 h-10 w-1/2 shimmer" />
      <div className="grid gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="border border-border bg-surface/60 p-4"
          >
            <div className="h-3 w-20 shimmer" />
            <div className="mt-3 h-8 w-32 shimmer" />
            <div className="mt-3 h-3 w-3/4 shimmer" />
          </div>
        ))}
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="h-72 border border-border bg-surface/60 p-5">
          <div className="h-3 w-24 shimmer" />
          <div className="mt-4 space-y-2">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="h-3 w-full shimmer" />
            ))}
          </div>
        </div>
        <div className="h-72 border border-border bg-surface/60 p-5">
          <div className="h-3 w-24 shimmer" />
          <div className="mt-4 space-y-2">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="h-3 w-full shimmer" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
