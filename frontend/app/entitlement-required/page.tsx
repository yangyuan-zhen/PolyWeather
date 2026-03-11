type Props = {
  searchParams?: Promise<{ next?: string }>;
};

export default async function EntitlementRequiredPage({ searchParams }: Props) {
  const params = (await searchParams) || {};
  const nextPath = params.next || "/";

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background:
          "radial-gradient(circle at 20% 20%, #13264f 0%, #071127 45%, #040812 100%)",
        color: "#d6e2ff",
        padding: "24px",
      }}
    >
      <section
        style={{
          width: "100%",
          maxWidth: 720,
          border: "1px solid rgba(68, 92, 140, 0.45)",
          borderRadius: 16,
          padding: 24,
          background: "rgba(9, 18, 36, 0.88)",
          boxShadow: "0 20px 50px rgba(0, 0, 0, 0.35)",
        }}
      >
        <h1 style={{ margin: 0, fontSize: 28, lineHeight: 1.2 }}>
          Entitlement Required
        </h1>
        <p style={{ marginTop: 12, color: "#9fb2da", lineHeight: 1.6 }}>
          This dashboard is protected. Append{" "}
          <code>?access_token=&lt;your-token&gt;</code> to the URL once, and
          the session cookie will be set automatically.
        </p>
        <p style={{ marginTop: 12, color: "#9fb2da", lineHeight: 1.6 }}>
          Requested path: <code>{nextPath}</code>
        </p>
      </section>
    </main>
  );
}
