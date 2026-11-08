import { useLiveQuery } from 'dexie-react-hooks'
import { getSetting, movementsInMonth, setSetting } from '../data/db'
import { currentMonth, money, todayISO } from '../lib/format'
import { honorariosIn, pilaDue, pilaEstimate, pilaPayments, type PilaConfig } from '../lib/pila'

// La planilla empieza en pausa: sin avisos hasta que la actives.
export async function loadPila(): Promise<PilaConfig> {
  return { active: (await getSetting('pila.active')) === '1', dueDay: Number(await getSetting('pila.dueDay')) || 0 }
}

function shortDate(d: string) {
  const [y, m, day] = d.split('-').map(Number)
  return new Date(y, m - 1, day).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })
}

export function PilaSettings() {
  const pila = useLiveQuery(loadPila, [])
  const month = currentMonth()
  const movements = useLiveQuery(() => movementsInMonth(month), [month]) ?? []
  if (!pila) return null
  const honorarios = honorariosIn(movements, month)

  return (
    <section className="card">
      <h3>Seguridad social (planilla)</h3>
      {pila.active ? (
        <>
          <p className="muted small">
            Activa: la app te avisa en el Resumen cuando se acerca la fecha límite y la da por pagada cuando ve el pago (por ejemplo,
            "Aportes en línea") en tus alertas o extractos.
          </p>
          <label className="amount-field">
            <span>Día del mes en que vence (según los dos últimos dígitos de tu cédula)</span>
            <input
              inputMode="numeric" placeholder="Ej: 14" value={pila.dueDay || ''}
              onChange={(e) => setSetting('pila.dueDay', String(Math.min(31, Number(e.target.value.replace(/\D/g, '')) || 0)))}
            />
          </label>
          <div className="stack">
            <button className="ghost" onClick={() => setSetting('pila.active', '0')}>Pausar (no estoy cotizando)</button>
          </div>
        </>
      ) : (
        <>
          <p className="muted small">
            En pausa: no hay recordatorios ni avisos de mora. Cuando recibas honorarios, el Diagnóstico te dice cuánto sería el aporte
            aproximado de ese mes, por si lo quieres apartar.
            {honorarios > 0 && ` Este mes van ${money(honorarios)} en honorarios: el aporte sería cerca de ${money(pilaEstimate(honorarios))}.`}
          </p>
          <div className="stack">
            <button className="ghost" onClick={() => setSetting('pila.active', '1')}>Activar recordatorios</button>
          </div>
        </>
      )}
    </section>
  )
}

// Tarjeta en el Resumen cuando la planilla está activa y vence pronto o ya venció sin pago.
export function PilaReminder({ onOpen }: { onOpen: () => void }) {
  const pila = useLiveQuery(loadPila, [])
  const month = currentMonth()
  const movements = useLiveQuery(() => movementsInMonth(month), [month]) ?? []
  if (!pila?.active || !pila.dueDay) return null
  const { due, days } = pilaDue(todayISO(), pila.dueDay)
  if (days > 7 || pilaPayments(movements, month).length) return null

  return (
    <button className={`card debt-reminder ${days < 0 ? 'alert' : ''}`} onClick={onOpen}>
      <span>
        <span className="muted small">Planilla de seguridad social</span>
        <b>Vence el {shortDate(due)}</b>
      </span>
      <span className="small">
        {days < 0 ? '⚠️ Venció, ¿ya pagaste?' : days === 0 ? '⏰ Vence hoy' : `⏰ Vence en ${days} día${days > 1 ? 's' : ''}`} ›
      </span>
    </button>
  )
}
