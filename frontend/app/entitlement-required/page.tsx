import Link from "next/link";

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
          maxWidth: 480,
          border: "1px solid rgba(68, 92, 140, 0.45)",
          borderRadius: 16,
          padding: 24,
          background: "rgba(9, 18, 36, 0.88)",
          boxShadow: "0 20px 50px rgba(0, 0, 0, 0.35)",
          textAlign: "center",
        }}
      >
        <h1
          style={{
            margin: 0,
            fontSize: 22,
            lineHeight: 1.3,
            fontWeight: 800,
          }}
        >
          需要登录方可访问此页面
        </h1>
        <p style={{ marginTop: 12, color: "#9fb2da", lineHeight: 1.6 }}>
          本页面需要登录权限。请登录后重试。
          <br />
          Sign in required to access this page.
        </p>
        <div style={{ marginTop: 20, display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          <Link
            href={`/auth/login?next=${encodeURIComponent(nextPath)}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              minHeight: 40,
              padding: "8px 20px",
              borderRadius: 12,
              background: "linear-gradient(135deg, #2563EB, #4F46E5)",
              color: "#fff",
              fontWeight: 700,
              textDecoration: "none",
              fontSize: 14,
            }}
          >
            去登录 / Sign in
          </Link>
          <Link
            href="/"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              minHeight: 40,
              padding: "8px 20px",
              borderRadius: 12,
              border: "1px solid rgba(68, 92, 140, 0.45)",
              background: "rgba(68, 92, 140, 0.2)",
              color: "#d6e2ff",
              fontWeight: 600,
              textDecoration: "none",
              fontSize: 14,
            }}
          >
            返回首页 / Back to Home
          </Link>
        </div>
        <p
          style={{
            marginTop: 20,
            fontSize: 12,
            color: "#7891b5",
            lineHeight: 1.5,
          }}
        >
          传统令牌模式仍支持 <code style={{ background: "rgba(255,255,255,0.06)", padding: "2px 6px", borderRadius: 4 }}>?access_token=&lt;your-token&gt;</code>
          <br />
          <span style={{ marginTop: 4, display: "inline-block" }}>
            请求路径 / Requested path: <code>{nextPath}</code>
          </span>
        </p>
      </section>
    </main>
  );
}
