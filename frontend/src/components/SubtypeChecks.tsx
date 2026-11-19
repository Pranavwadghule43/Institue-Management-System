// 16 Nov (client): a student / enquiry can take several sub-types of the course, picked with checkboxes.
import { useQuery } from '../api/client';
import type { Subtype, SubtypeRef } from '../api/types';

export function SubtypeChecks({ courseId, value, onChange, error, label = 'Course sub-types', options }: {
  courseId: string | number | null | undefined; value: number[]; onChange: (ids: number[]) => void; error?: string; label?: string;
  options?: { data?: SubtypeRef[]; error?: Error; reload: () => void };
}) {
  const query = useQuery<Subtype[]>(courseId && !options ? `/courses/${courseId}/subtypes` : null, { active: true });
  const { data: subtypes, error: loadError, reload } = options ?? query;
  if (!courseId) return null;
  const toggle = (id: number, on: boolean) => onChange(on ? [...value.filter((x) => x !== id), id] : value.filter((x) => x !== id));
  return (
    <fieldset className={`field span-2 subtype-checks ${error ? 'has-error' : ''}`} style={{ gridColumn: '1 / -1' }}>
      <legend className="field__label">{label} <span className="muted" style={{ fontWeight: 400 }}>— tick all that apply</span></legend>
      {loadError ? <button type="button" className="btn btn-ghost btn-sm" onClick={reload}>Could not load sub-types. Retry</button>
        : subtypes === undefined ? <span className="muted" style={{ fontSize: 13 }}>Loading…</span>
        : subtypes.length === 0 ? <span className="muted" style={{ fontSize: 13 }}>This course has no sub-types.</span>
          : (
            <div className="subtype-checks__list">
              {subtypes.map((s) => (
                <label key={s.id} className={`check subtype-checks__item ${value.includes(s.id) ? 'is-on' : ''}`}>
                  <input type="checkbox" checked={value.includes(s.id)} onChange={(e) => toggle(s.id, e.target.checked)} /> {s.name}
                </label>
              ))}
            </div>
          )}
      {error && <span className="field__error" role="alert">{error}</span>}
    </fieldset>
  );
}

/** Only ids that are still offered (an inactive sub-type can't be saved). */
export const activeOnly = (ids: number[], offered?: { id: number }[]) => (offered ? ids.filter((id) => offered.some((s) => s.id === id)) : ids);
