// Estado de carregamento — skeletons sem shimmer obrigatório (RFC seção 6).
// Estado base sempre visível: nada começa em opacity:0.

function Line({ width }: { width: string }) {
  return <div className="skeleton" style={{ height: 13, width, marginBottom: 14 }} />;
}

export function LoadingState({ cards = 4 }: { cards?: number }) {
  return (
    <div className="page" aria-busy="true" aria-label="Carregando">
      <div className="hero" style={{ display: 'block' }}>
        <div className="skeleton" style={{ height: 22, width: 120, marginBottom: 18 }} />
        <div className="skeleton" style={{ height: 34, width: '60%', marginBottom: 22 }} />
        <div className="skeleton" style={{ height: 14, width: '40%' }} />
      </div>

      <div className="body-grid">
        <div className="panel description">
          <div className="skeleton" style={{ height: 17, width: 110, marginBottom: 20 }} />
          <Line width="100%" />
          <Line width="96%" />
          <Line width="92%" />
          <Line width="70%" />
          <Line width="88%" />
          <Line width="50%" />
        </div>

        <div className="feature-list">
          {Array.from({ length: cards }, (_, i) => (
            <div key={i} className="skeleton skeleton-card" />
          ))}
        </div>
      </div>
    </div>
  );
}
