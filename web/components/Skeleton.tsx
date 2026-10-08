/** Placeholder rows shown while a search is running. Purely visual, so hidden from screen readers. */
export function Skeleton() {
  return (
    <div className="skeleton" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div className="skeleton-row" key={i}>
          <span className="skeleton-bar skeleton-title" />
          <span className="skeleton-bar skeleton-text" />
        </div>
      ))}
    </div>
  );
}
