// Instant skeleton for /admin/orders — a stack of table-row placeholders.

const BG = "rgb(29,29,31)";
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

export default function OrdersLoading() {
  return (
    <main className="min-h-screen" style={{ background: BG }}>
      <div style={{ padding: "2rem clamp(1rem, 4vw, 1.5rem) 4rem" }}>
        <div style={{ marginBottom: "1.5rem" }}>
          <Block height={36} width={200} />
        </div>
        <div style={{ marginBottom: "1.25rem" }}>
          <Block height={44} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {Array.from({ length: 10 }).map((_, i) => (
            <Block key={i} height={56} />
          ))}
        </div>
      </div>
    </main>
  );
}
