import { describe, expect, it } from 'vitest'
import { DEAL_STATUS_LABEL, dealStatus, localToday } from './deal-status'

const today = '2026-11-10'

describe('dealStatus', () => {
  it('sem previsão ou com a etapa fechada não há selo', () => {
    expect(dealStatus(null, 'open', today)).toBeNull()
    expect(dealStatus('2026-11-01', 'won', today)).toBeNull()
    expect(dealStatus('2026-11-01', 'lost', today)).toBeNull()
  })

  it('data passada está atrasada', () => {
    expect(dealStatus('2026-11-09', 'open', today)).toBe('overdue')
  })

  it('vence hoje e até 7 dias à frente é "vence logo"', () => {
    expect(dealStatus('2026-11-10', 'open', today)).toBe('soon')
    expect(dealStatus('2026-11-17', 'open', today)).toBe('soon')
  })

  it('depois de 7 dias está no prazo', () => {
    expect(dealStatus('2026-11-18', 'open', today)).toBe('on_track')
  })

  it('a virada de mês e de ano conta os dias certos', () => {
    expect(dealStatus('2027-01-03', 'open', '2026-12-28')).toBe('soon')
    expect(dealStatus('2027-01-05', 'open', '2026-12-28')).toBe('on_track')
  })
})

describe('textos e data local', () => {
  it('cada situação tem um rótulo', () => {
    expect(DEAL_STATUS_LABEL).toEqual({ overdue: 'Atrasada', soon: 'Vence logo', on_track: 'No prazo' })
  })

  it('localToday usa o calendário local, não o UTC', () => {
    expect(localToday(new Date(2026, 10, 10, 23, 30))).toBe('2026-11-10')
  })
})
