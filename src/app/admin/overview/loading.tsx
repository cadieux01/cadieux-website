// Instant skeleton shown during navigation to /admin/overview while the
// client page mounts and fetches. Mirrors the header + KPI tile grid so
// the layout doesn't jump when real data arrives. Server component — pure
// markup, no client JS.

const BG = "rgb(6,4,2)";
const BORDER = "rgba(251,243,212,0.16)";
const BLOCK = "rgba(251,243,212,0.05)";

function Block({ height, width }: { height: number | string; width?: number | string }) {
  return (
    <div
      style={{
        height,
        width: width ?? "100%",
        background: BLOCK,
        border: `1px solid ${BORDER}`,
        borderRadius: 10,
      }}
    />
  );
}

export default function OverviewLoading() {
  return (
    <main className="min-h-screen" style={{ background: BG }}>
      <div style={{ padding: "2rem clamp(1rem, 4vw, 1.5rem) 4rem" }}>
        <div style={{ marginBottom: "1.5rem" }}>
          <Block height={36} width={260} />
        </div>
        <div style={{ marginBottom: "1.5rem" }}>
          <Block height={40} width={200} />
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
            gap: "0.75rem",
          }}
        >
          {Array.from({ length: 7 }).map((_, i) => (
            <Block key={i} height={110} />
          ))}
        </div>
      </div>
    </main>
  );
}
