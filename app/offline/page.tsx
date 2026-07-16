export default function OfflineRoute() {
  return (
    <main className="app-shell">
      <section className="glass" style={{ borderRadius: 28, padding: 24 }}>
        <p className="chip">Offline</p>
        <h1>RoofMeasure is available locally.</h1>
        <p>
          Saved projects and reports still work offline. Satellite tiles and live address search return
          when your connection does.
        </p>
      </section>
    </main>
  );
}
