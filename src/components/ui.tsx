import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { useId } from 'react'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'outline' | 'quiet' | 'danger' | 'accent'
  size?: 'sm' | 'md' | 'lg'
  block?: boolean
  loading?: boolean
}

export function Button({ variant = 'outline', size = 'md', block, loading, className, children, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={`btn btn--${variant} btn--${size}${block ? ' btn--block' : ''}${className ? ` ${className}` : ''}`}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <span className="btn__spinner" aria-hidden="true" />}
      {children}
    </button>
  )
}

export function Field({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: string
  hint?: string
  children: ReactNode
  htmlFor?: string
}) {
  return (
    <div className="field">
      <label className="field__label eyebrow" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && <p className="field__hint">{hint}</p>}
    </div>
  )
}

export function TextField({ label, hint, ...rest }: { label: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId()
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <input id={id} className="input" {...rest} />
    </Field>
  )
}

export function TextAreaField({
  label,
  hint,
  ...rest
}: { label: string; hint?: string } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId()
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <textarea id={id} className="input input--area" {...rest} />
    </Field>
  )
}

export function SelectField({
  label,
  hint,
  children,
  ...rest
}: { label: string; hint?: string; children: ReactNode } & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId()
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <div className="select">
        <select id={id} {...rest}>
          {children}
        </select>
      </div>
    </Field>
  )
}

/**
 * A panel is a torn-off section of the strip: perforated at the top edge, never
 * a floating rounded card. The whole app is one long ticket roll.
 */
export function Panel({
  eyebrow,
  title,
  actions,
  children,
  tight,
}: {
  eyebrow?: string
  title?: string
  actions?: ReactNode
  children: ReactNode
  tight?: boolean
}) {
  return (
    <section className={`panel${tight ? ' panel--tight' : ''}`}>
      {(title || actions) && (
        <header className="panel__head">
          <div>
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            {title && <h2 className="panel__title display">{title}</h2>}
          </div>
          {actions && <div className="panel__actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  )
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: 'go' | 'stamp' | 'amber' }) {
  return (
    <div className={`stat${tone ? ` stat--${tone}` : ''}`}>
      <span className="stat__value numeral">{value}</span>
      <span className="stat__label eyebrow">{label}</span>
    </div>
  )
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'go' | 'stamp' | 'amber' }) {
  return <span className={`badge badge--${tone}`}>{children}</span>
}

export function Empty({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty__title display">{title}</p>
      {body && <p className="empty__body muted">{body}</p>}
      {action && <div className="empty__action">{action}</div>}
    </div>
  )
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'error'; children: ReactNode }) {
  return (
    <p className={`notice notice--${tone}`} role={tone === 'error' ? 'alert' : undefined}>
      {children}
    </p>
  )
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
  label: string
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="segmented__item"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function Spinner({ label }: { label?: string }) {
  return (
    <p className="spinner" role="status">
      <span className="spinner__mark" aria-hidden="true" />
      {label}
    </p>
  )
}
