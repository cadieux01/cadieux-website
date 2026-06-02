// Instant skeleton for /admin/products — a grid of product cards.

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

export default function ProductsLoading() {
  return (
    <main className="min-h-screen" style={{ background: BG }}>
      <div style={{ padding: "2rem clamp(1rem, 4vw, 1.5rem) 4rem" }}>
        <div style={{ marginBottom: "1.5rem" }}>
          <Block height={36} width={220} />
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
            gap: "1rem",
          }}
        >
          {Array.from({ length: 8 }).map((_, i) => (
            <Block key={i} height={200} />
          ))}
        </div>
      </div>
    </main>
  );
}
