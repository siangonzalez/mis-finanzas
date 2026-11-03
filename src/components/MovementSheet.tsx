import { useState } from 'react'
import { categoriesFor, findCategory, type Kind } from '../data/categories'
import { deleteMovement, saveMovement, type Movement, type Recurrence } from '../data/db'
import { currentMonth, moneyInput, parseMoney, todayISO } from '../lib/format'

interface Props {
  movement: Movement | null
  month: string
  onClose: () => void
}

function defaultDate(month: string) {
  // Si estás viendo otro mes, el movimiento nuevo cae en ese mes.
  return month === currentMonth() ? todayISO() : `${month}-01`
}

export function MovementSheet({ movement, month, onClose }: Props) {
  const [kind, setKind] = useState<Kind>(movement?.kind ?? 'gasto')
  const [date, setDate] = useState(movement?.date ?? defaultDate(month))
  const [description, setDescription] = useState(movement?.description ?? '')
  const [category, setCategory] = useState(movement?.category ?? categoriesFor('gasto')[0].name)
  const [subcategory, setSubcategory] = useState(movement?.subcategory ?? categoriesFor('gasto')[0].subcategories[0])
  const [amount, setAmount] = useState(movement?.amount ?? 0)
  const [recurrence, setRecurrence] = useState<Recurrence>(movement?.recurrence ?? 'ocasional')

  const categories = categoriesFor(kind)
  const current = findCategory(kind, category)

  const changeKind = (k: Kind) => {
    setKind(k)
    const first = categoriesFor(k)[0]
    setCategory(first.name)
    setSubcategory(first.subcategories[0])
    setRecurrence(k === 'ingreso' ? 'fijo' : 'ocasional')
  }

  const changeCategory = (name: string) => {
    setCategory(name)
    setSubcategory(findCategory(kind, name).subcategories[0])
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!amount) return
    await saveMovement({
      id: movement?.id,
      date,
      kind,
      category,
      subcategory,
      description: description.trim() || subcategory,
      amount,
      recurrence,
      source: movement?.source ?? 'manual',
      createdAt: movement?.createdAt ?? Date.now(),
    })
    onClose()
  }

  const remove = async () => {
    if (movement?.id === undefined) return
    if (!confirm('¿Eliminar este movimiento?')) return
    await deleteMovement(movement.id)
    onClose()
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <form className="sheet" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <div className="sheet-head">
          <h2>{movement ? 'Editar movimiento' : 'Nuevo movimiento'}</h2>
          <button type="button" className="ghost" onClick={onClose}>Cerrar</button>
        </div>

        <div className="segmented">
          <button type="button" className={kind === 'gasto' ? 'on expense' : ''} onClick={() => changeKind('gasto')}>Gasto</button>
          <button type="button" className={kind === 'ingreso' ? 'on income' : ''} onClick={() => changeKind('ingreso')}>Ingreso</button>
        </div>

        <label className="amount-field">
          <span>Valor</span>
          <div>
            <b>$</b>
            <input
              inputMode="numeric"
              placeholder="0"
              autoFocus={!movement}
              value={moneyInput(amount)}
              onChange={(e) => setAmount(parseMoney(e.target.value))}
            />
          </div>
        </label>

        <label>
          <span>Descripción</span>
          <input placeholder="Ej: mercado del mes" value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>

        <span className="field-label">Categoría</span>
        <div className="chips">
          {categories.map((c) => (
            <button
              type="button"
              key={c.name}
              className={c.name === category ? 'chip on' : 'chip'}
              style={c.name === category ? { borderColor: c.color, background: `${c.color}22` } : undefined}
              onClick={() => changeCategory(c.name)}
            >
              {c.emoji} {c.name}
            </button>
          ))}
        </div>

        {current.subcategories.length > 1 && (
          <label>
            <span>Tipo</span>
            <select value={subcategory} onChange={(e) => setSubcategory(e.target.value)}>
              {current.subcategories.map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
        )}

        <div className="row">
          <label>
            <span>Fecha</span>
            <input type="date" value={date} required onChange={(e) => setDate(e.target.value)} />
          </label>
          <label>
            <span>Se repite</span>
            <select value={recurrence} onChange={(e) => setRecurrence(e.target.value as Recurrence)}>
              <option value="ocasional">Ocasional</option>
              <option value="fijo">Fijo cada mes</option>
            </select>
          </label>
        </div>

        <button className="primary" disabled={!amount}>Guardar</button>
        {movement && <button type="button" className="danger" onClick={remove}>Eliminar</button>}
      </form>
    </div>
  )
}
