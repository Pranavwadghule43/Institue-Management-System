import { useEffect, useState } from 'react';
import { FolderOpen, Pencil, Plus } from 'lucide-react';
import { errText, useApp } from '../../app/AppContext';
import { Drawer, Empty, Field, LoadError, Menu, MoneyInput, PageHeader, SkeletonRows, Switch } from '../../components/ui';
import { api, useQuery, write } from '../../api/client';
import type { Service, ServiceCategory } from '../../api/types';
import { money, n } from '../../lib/format';

export default function ServiceMaster() {
  const { toast } = useApp();
  const [cat, setCat] = useState<number | ''>('');
  const [edit, setEdit] = useState<Service | 'new' | null>(null);
  const [newCat, setNewCat] = useState(false);
  const { data: categories } = useQuery<ServiceCategory[]>('/service-categories');
  const { data: services, error, loading, reload } = useQuery<Service[]>('/services', { category_id: cat });
  const total = categories?.reduce((t, c) => t + c.services, 0) ?? 0;

  const toggle = async (s: Service, v: boolean) => {
    try {
      await write(api(`/services/${s.id}/${v ? 'activate' : 'deactivate'}`, { method: 'POST' }));
      toast('success', v ? 'Service activated' : 'Service deactivated', s.name);
    } catch (e) {
      toast('error', errText(e));
    }
  };

  return (
    <>
      <PageHeader
        title="Service master"
        sub="Categories and current prices. Bills default to these rates; only Admin can override."
        crumbs={[['Services'], ['Service master']]}
        actions={<button className="btn btn-primary" onClick={() => setEdit('new')} disabled={!categories?.some((c) => c.is_active)}><Plus /> Add service</button>}
      />
      <div className="two-col" style={{ gridTemplateColumns: '260px minmax(0,1fr)' }}>
        <section className="panel">
          <div className="panel__head">
            <h2>Categories</h2>
            <button className="icon-btn sm" aria-label="Add category" onClick={() => setNewCat(true)}><Plus /></button>
          </div>
          <div style={{ padding: 8 }} className="settings-nav">
            <button className={!cat ? 'is-active' : ''} onClick={() => setCat('')}>
              <FolderOpen /> All services <span className="muted" style={{ marginLeft: 'auto' }}>{total}</span>
            </button>
            {categories?.map((c) => (
              <button key={c.id} className={cat === c.id ? 'is-active' : ''} onClick={() => setCat(c.id)} style={!c.is_active ? { opacity: 0.6 } : undefined}>
                <FolderOpen /> {c.name}
                <span className="muted" style={{ marginLeft: 'auto' }}>{c.services}</span>
              </button>
            ))}
            {categories && !categories.length && <p className="muted" style={{ padding: 8, fontSize: 13 }}>Add a category first.</p>}
          </div>
        </section>
        <section className="panel">
          {error ? <LoadError error={error} retry={reload} /> : loading ? <SkeletonRows rows={6} cols={3} /> : !services!.length ? (
            <Empty icon={<FolderOpen />} title="No services yet" body="Add the services you offer with their current prices." />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Service</th><th className="ta-r">Price</th><th>Active</th><th /></tr></thead>
                <tbody>
                  {services!.map((s) => (
                    <tr key={s.id} style={!s.is_active ? { opacity: 0.6 } : undefined}>
                      <td><div style={{ fontWeight: 600 }}>{s.name}</div><div className="muted" style={{ fontSize: 12 }}>{s.category.name}{s.code && ` · ${s.code}`}</div></td>
                      <td className="ta-r num" style={{ fontWeight: 700 }}>{money(s.price)}</td>
                      <td><Switch on={s.is_active} label={`${s.name} active`} onChange={(v) => toggle(s, v)} /></td>
                      <td className="ta-r"><Menu><button className="menu__item" onClick={() => setEdit(s)}><Pencil /> Edit service & price</button></Menu></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
      <ServiceDrawer service={edit} categories={(categories ?? []).filter((c) => c.is_active)} defaultCat={cat} onClose={() => setEdit(null)} />
      <CategoryDrawer open={newCat} onClose={() => setNewCat(false)} />
    </>
  );
}

function ServiceDrawer({ service, categories, defaultCat, onClose }: { service: Service | 'new' | null; categories: ServiceCategory[]; defaultCat: number | ''; onClose: () => void }) {
  const { toast } = useApp();
  const isNew = service === 'new';
  const [f, setF] = useState({ name: '', category_id: '' as number | '', price: '' as number | '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (service && service !== 'new') setF({ name: service.name, category_id: service.category.id, price: n(service.price) });
    else setF({ name: '', category_id: defaultCat || categories[0]?.id || '', price: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service]);
  const save = async () => {
    setBusy(true);
    try {
      const body = { name: f.name, category_id: Number(f.category_id), price: String(f.price) };
      if (isNew) await write(api('/services', { method: 'POST', body }));
      else await write(api(`/services/${(service as Service).id}`, { method: 'PATCH', body }));
      toast('success', isNew ? 'Service added' : 'Service updated', f.name);
      onClose();
    } catch (e) {
      toast('error', errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer open={!!service} onClose={onClose} title={isNew ? 'Add service' : (service as Service | null)?.name ?? ''} sub="Changing the price affects new bills only — existing bills keep their rate."
      foot={<><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || !f.name.trim() || !f.category_id || f.price === ''} onClick={save}>{busy && <span className="spinner" />}Save</button></>}>
      <div className="stack" style={{ gap: 18 }}>
        <Field label="Service name" required htmlFor="sname"><input id="sname" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Category" required htmlFor="scat">
          <select id="scat" className="select" value={f.category_id} onChange={(e) => setF({ ...f, category_id: Number(e.target.value) })}>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Current price" required hint={service && service !== 'new' ? `Was ${money(service.price)}` : undefined} htmlFor="sp"><MoneyInput id="sp" value={f.price} onChange={(v) => setF({ ...f, price: v })} xl /></Field>
      </div>
    </Drawer>
  );
}

function CategoryDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useApp();
  const [name, setName] = useState('');
  const { data: categories } = useQuery<ServiceCategory[]>(open ? '/service-categories' : null);
  const add = async () => {
    try {
      await write(api('/service-categories', { method: 'POST', body: { name } }));
      toast('success', 'Category added', name.trim());
      setName('');
    } catch (e) {
      toast('error', errText(e));
    }
  };
  return (
    <Drawer open={open} onClose={onClose} title="Service categories" foot={<button className="btn btn-secondary" onClick={onClose}>Done</button>}>
      <div className="stack">
        {categories?.map((c) => (
          <div className="row-between" key={c.id}>
            <span>{c.name} {!c.is_active && <span className="muted">(inactive)</span>}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => write(api(`/service-categories/${c.id}/${c.is_active ? 'deactivate' : 'activate'}`, { method: 'POST' })).catch((e) => toast('error', errText(e)))}>
              {c.is_active ? 'Deactivate' : 'Activate'}
            </button>
          </div>
        ))}
        <Field label="New category" htmlFor="cat-name"><input id="cat-name" className="input" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && add()} /></Field>
        <button className="btn btn-primary" onClick={add} disabled={!name.trim()}><Plus /> Add category</button>
      </div>
    </Drawer>
  );
}
