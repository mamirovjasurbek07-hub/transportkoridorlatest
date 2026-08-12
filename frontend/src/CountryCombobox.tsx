import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search, X } from 'lucide-react'
import type { Country } from './types'

interface Props {
  countries: Country[]
  value: string
  onChange: (code: string) => void
  placeholder?: string
  emptyLabel?: string
  disabled?: boolean
}

const apostrophes = /[\u02BB\u02BC\u2018\u2019`\u00B4]/g

function normalize(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(apostrophes, '').replace(/[^a-zA-Z0-9]+/g, ' ').trim().toLowerCase()
}

export function countryLabel(country: Country): string {
  const name = country.name.replace(apostrophes, "'").toUpperCase()
  return `${country.alpha2.toUpperCase()} - ${String(country.numeric).padStart(3, '0')} - ${name}`
}

export default function CountryCombobox({ countries, value, onChange, placeholder = 'Davlat kodi, raqami yoki nomini yozing', emptyLabel = 'Davlat tanlanmagan', disabled }: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const selected = countries.find((country) => country.alpha2 === value)
  const filtered = useMemo(() => {
    const needle = normalize(query)
    if (!needle) return countries
    return countries.filter((country) => normalize(`${country.alpha2} ${country.alpha3} ${country.numeric} ${country.name}`).includes(needle))
  }, [countries, query])

  useEffect(() => {
    const close = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const show = () => { if (disabled) return; setOpen(true); setQuery(''); setTimeout(() => inputRef.current?.focus(), 0) }
  const choose = (code: string) => { onChange(code); setOpen(false); setQuery('') }
  return <div className={`country-combobox ${open ? 'open' : ''}`} ref={rootRef}>
    <button type="button" className="country-combobox-trigger" disabled={disabled} onClick={show} aria-expanded={open}>
      <span>{selected ? countryLabel(selected) : emptyLabel}</span><ChevronDown/>
    </button>
    {open && <div className="country-combobox-menu">
      <div className="country-search"><Search/><input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={placeholder} onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false); if (event.key === 'Enter' && filtered[0]) choose(filtered[0].alpha2) }}/>{query && <button type="button" onClick={() => setQuery('')}><X/></button>}</div>
      <div className="country-options" role="listbox">
        {!query && <button type="button" className={`country-clear-option ${!value ? 'selected' : ''}`} onClick={() => choose('')}><span>{emptyLabel}</span>{!value && <Check/>}</button>}
        {filtered.map((country) => <button type="button" role="option" aria-selected={country.alpha2 === value} className={country.alpha2 === value ? 'selected' : ''} key={`${country.numeric}-${country.alpha2}`} onClick={() => choose(country.alpha2)}><i>{country.flag}</i><span>{countryLabel(country)}</span>{country.alpha2 === value && <Check/>}</button>)}
        {!filtered.length && <div className="country-empty">Mos davlat topilmadi</div>}
      </div>
    </div>}
  </div>
}
