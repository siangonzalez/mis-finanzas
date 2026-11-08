import type { TaxYear } from '../lib/tax'
import { money } from '../lib/format'

function shortDate(d: string) {
  const [y, m, day] = d.split('-').map(Number)
  return new Date(y, m - 1, day).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })
}

const STATUS = {
  supera: 'Según la app, superas al menos un tope: tendrías que declarar.',
  cerca: 'Estás cerca de un tope. Revísalo antes de diciembre.',
  lejos: 'Según la app, todavía estás lejos de los topes.',
}

// Topes para declarar renta por el año en curso, con lo que hay en la app.
export function TaxCard({ tax }: { tax: TaxYear }) {
  const withheld = tax.withheld.reduce((s, w) => s + w.amount, 0)
  return (
    <section className={`card finding ${tax.status === 'supera' ? 'alerta' : tax.status === 'cerca' ? 'atencion' : ''}`}>
      <span className="small muted">Declaración de renta</span>
      <h3>Renta {tax.year}</h3>
      <p className="small">
        {STATUS[tax.status]} Se declara entre agosto y octubre de {tax.year + 1}, según los dos últimos dígitos de tu cédula. Basta con
        superar uno solo de estos topes.
      </p>
      <ul className="tax-list">
        {tax.checks.map((c) => {
          const share = c.estimated / c.limit
          return (
            <li key={c.key}>
              <div className="bar-label small">
                <b>{c.label}</b>
                <span>{Math.round(share * 100)} %</span>
              </div>
              <div className="bar-track">
                <div className={`bar-fill ${share >= 1 ? 'over' : share >= 0.8 ? 'warn' : 'ok'}`} style={{ width: `${Math.min(100, share * 100)}%` }} />
              </div>
              <p className="muted small">
                {c.estimated !== c.value ? `Llevas ${money(c.value)} · a diciembre ${money(c.estimated)}` : `Llevas ${money(c.value)}`} · tope {money(c.limit)}
              </p>
              <p className="muted small">
                {c.note}
              </p>
            </li>
          )
        })}
      </ul>
      {withheld > 0 && (
        <>
          <p className="small" style={{ marginTop: 10 }}>
            Te pagaron {money(withheld)} menos en cuentas de cobro, posiblemente por retención en la fuente. Pide el certificado a cada
            cliente: esa retención se resta del impuesto.
          </p>
          <ul className="finding-items">
            {tax.withheld.map((w, i) => (
              <li key={i} className="small"><span>{w.client}</span><b>{money(w.amount)}</b></li>
            ))}
          </ul>
        </>
      )}
      <p className="muted small" style={{ marginTop: 10 }}>
        {tax.firstDate ? `La app tiene tus movimientos desde el ${shortDate(tax.firstDate)}: lo anterior no se cuenta, súmalo con tus extractos. ` : 'Aún no hay movimientos de este año. '}
        Topes con la UVT de {tax.uvtYear} ({money(tax.uvt)}). Es una guía, no reemplaza a un contador.
      </p>
    </section>
  )
}
