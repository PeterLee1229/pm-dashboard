import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

/** Only reports "loading" as true once it has persisted past `delay` ms, to avoid flicker on fast responses. */
export function useDelayedLoading(loading: boolean, delay = 300): boolean {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!loading) { setShow(false); return; }
    const timer = setTimeout(() => setShow(true), delay);
    return () => clearTimeout(timer);
  }, [loading, delay]);

  return loading && show;
}

export function Skeleton({ width = "100%", height = 14, radius = 6, style }: {
  width?: number | string; height?: number | string; radius?: number; style?: CSSProperties;
}) {
  return <div className="skeleton" style={{ width, height, borderRadius: radius, ...style }} />;
}

export function KanbanSkeleton() {
  const cardsPerColumn = [3, 2, 1, 2];
  return (
    <div className="board">
      {cardsPerColumn.map((count, col) => (
        <div key={col} className="column">
          <div className="column-header">
            <div className="column-title-row">
              <Skeleton width={14} height={14} radius={4} />
              <Skeleton width={56} height={12} />
            </div>
          </div>
          <div className="task-list">
            {Array.from({ length: count }).map((_, i) => (
              <div key={i} className="task-card" style={{ cursor: "default" }}>
                <Skeleton width={48} height={16} radius={99} style={{ marginBottom: 10 }} />
                <Skeleton width="82%" height={13} style={{ marginBottom: 8 }} />
                <Skeleton width="45%" height={10} style={{ marginBottom: 14 }} />
                <Skeleton width="100%" height={4} radius={99} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div style={{ background: "#161b27", borderRadius: 12, border: "1px solid #ffffff08", overflow: "hidden" }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{
          display: "flex", alignItems: "center", gap: 12, padding: "14px 20px",
          borderBottom: i < rows - 1 ? "1px solid #ffffff06" : "none",
        }}>
          <Skeleton width={28} height={28} radius={99} />
          <div style={{ flex: 1 }}>
            <Skeleton width="35%" height={12} style={{ marginBottom: 6 }} />
            <Skeleton width="65%" height={11} />
          </div>
          <Skeleton width={40} height={10} />
        </div>
      ))}
    </div>
  );
}

export function CardListSkeleton({ cards = 3 }: { cards?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {Array.from({ length: cards }).map((_, i) => (
        <div key={i} style={{ background: "#161b27", borderRadius: 12, border: "1px solid #ffffff08", overflow: "hidden" }}>
          <div style={{ padding: "16px 20px", background: "#1a2030" }}>
            <Skeleton width="28%" height={15} style={{ marginBottom: 12 }} />
            <Skeleton width="100%" height={6} radius={99} />
          </div>
          <div style={{ padding: "14px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
            <Skeleton width="88%" height={12} />
            <Skeleton width="64%" height={12} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ icon = "📭", title, description, actionLabel, onAction }: {
  icon?: string; title: string; description?: string; actionLabel?: string; onAction?: () => void;
}) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">{icon}</div>
      <p className="empty-state-title">{title}</p>
      {description && <p className="empty-state-desc">{description}</p>}
      {actionLabel && onAction && (
        <button className="empty-state-action" onClick={onAction}>{actionLabel}</button>
      )}
    </div>
  );
}

/** Renders skeleton while loading (after the delay threshold), the empty state when data is empty, or children otherwise. */
export function LoadingEmptyGate({ loading, isEmpty, skeleton, empty, delay = 300, children }: {
  loading: boolean; isEmpty: boolean; skeleton: ReactNode; empty: ReactNode; delay?: number; children: ReactNode;
}) {
  const showSkeleton = useDelayedLoading(loading, delay);
  if (loading) return showSkeleton ? <>{skeleton}</> : null;
  if (isEmpty) return <>{empty}</>;
  return <>{children}</>;
}
