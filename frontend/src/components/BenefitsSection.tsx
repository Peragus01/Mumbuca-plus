/** Illustrative perks of the Mumbuca+ proposal (static content, no backend, no real business names). */
const BENEFITS = [
  { icon: '🍽️', title: 'Gastronomia', perk: 'cashback de 5%' },
  { icon: '🏨', title: 'Hospedagem', perk: 'cashback de 5%' },
  { icon: '🎬', title: 'Cultura e cinema', perk: 'ingresso com desconto' },
  { icon: '🛍️', title: 'Comércio local', perk: 'cashback de 5%' },
] as const;

export function BenefitsSection() {
  return (
    <section className="benefits" aria-labelledby="benefits-title">
      <h2 id="benefits-title" className="card__title">
        Benefícios em Maricá
      </h2>
      <ul className="benefits__grid">
        {BENEFITS.map((b) => (
          <li key={b.title} className="benefit">
            <span className="benefit__icon" aria-hidden="true">
              {b.icon}
            </span>
            <span className="benefit__title">{b.title}</span>
            <span className="benefit__perk">{b.perk}</span>
            <span className="benefit__tag">exemplo</span>
          </li>
        ))}
      </ul>
      <p className="benefits__note muted small">Benefícios ilustrativos da proposta Mumbuca+.</p>
    </section>
  );
}
