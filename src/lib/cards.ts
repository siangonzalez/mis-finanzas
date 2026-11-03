import type { CardSummary } from '../import/statements'

// ¿Ya pagaste la tarjeta o la cuota del crédito? El extracto dice cuánto debías
// a la fecha de corte; aquí se buscan los pagos que hiciste después, en tus
// alertas y extractos (por ejemplo, "Pagaste $190.715 a Compania de
// Financiamiento Tuy"), o el "Ya pagué" que marques a mano.

export interface PaymentLike {
  date: string
  amount: number
  kind: 'gasto' | 'ingreso'
  merchant: string
  status?: string
  deleted?: boolean
}

export interface ManualPayment {
  date: string
  amount: number
}

// Cómo aparece cada banco cuando le pagas desde otra cuenta.
const PAYEE: Record<string, RegExp> = {
  Tuya: /TUY|CARULLA|COMPA[NÑ]IA DE FINANCIAMIENTO/i,
  Davivienda: /DAVIVIENDA/i,
  Bancolombia: /PAGO A LA TARJETA BANCOLOMBIA|ABONO TARJETA|T\.?\s?CR[EÉ]D/i,
}

export interface CardPaid {
  paid: number // lo pagado después del corte
  lastDate: string
  covered: boolean // cubre al menos el pago mínimo o la cuota
  manual: boolean
}

export function cardPaid(card: CardSummary & { manualPayment?: ManualPayment }, items: PaymentLike[]): CardPaid {
  const re = PAYEE[card.bank]
  const found = re
    ? items.filter(
        (i) =>
          !i.deleted && i.kind === 'gasto' && i.status !== 'ignorado' && i.status !== 'duplicado' &&
          i.date > card.cutDate && re.test(i.merchant),
      )
    : []
  const manual = card.manualPayment && card.manualPayment.date > card.cutDate ? card.manualPayment : undefined
  const paid = found.reduce((s, i) => s + i.amount, 0) + (manual?.amount ?? 0)
  const lastDate = [...found.map((i) => i.date), manual?.date ?? ''].sort().pop() ?? ''
  // Un 2 % de margen: a veces el pago queda unos pesos por debajo del mínimo.
  return { paid, lastDate, covered: paid > 0 && paid >= card.minPayment * 0.98, manual: Boolean(manual) }
}
