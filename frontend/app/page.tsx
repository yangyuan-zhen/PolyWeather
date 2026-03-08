export default function HomePage() {
  return (
    <main className="h-screen w-screen overflow-hidden bg-black">
      <iframe
        title="PolyWeather Legacy Dashboard"
        src="/legacy/index.html?v=legacy-v3"
        className="h-full w-full border-0"
      />
    </main>
  );
}
