import { useState } from 'react';
import { FolderOpen, Pencil, Plus } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { Drawer, Field, Menu, MoneyInput, PageHeader, Switch } from '../../components/ui';
import { db, touch, useStore } from '../../data/store';
import type { Service } from '../../data/types';
import { money } from '../../lib/format';

export default function ServiceMaster() {
  useStore();
  const { user, toast } = useApp();
  const [cat, setCat] = useState('');
  const [edit, setEdit] = useState<Service | null>(null);
  const [price, setPrice] = useState<number | ''>('');
  const list = db.services.filter((s) => !cat || s.categoryId === cat);

  const open = (s: Service) => {
    setEdit(s);
    setPrice(s.price);
  };

  return (
    <>
      <PageHeader
        title="Service master"
        sub="Categories and current prices. Bills default to these rates; only Admin can override."
        crumbs={[['Services'], ['Service master']]}
        actions={
          <button className="btn btn-primary" onClick={() => toast('info', 'Add service', 'Opens the same editor for a new service.')}>
            <Plus /> Add service
          </button>
        }
      />
      <div className="two-col" style={{ gridTemplateColumns: '260px minmax(0,1fr)' }}>
        <section className="panel">
          <div className="panel__head">
            <h2>Categories</h2>
            <button className="icon-btn sm" aria-label="Add category" onClick={() => toast('info', 'Add category')}>
              <Plus />
            </button>
          </div>
          <div style={{ padding: 8 }} className="settings-nav">
            <button className={!cat ? 'is-active' : ''} onClick={() => setCat('')}>
              <FolderOpen /> All services <span className="muted" style={{ marginLeft: 'auto' }}>{db.services.length}</span>
            </button>
            {db.serviceCategories.map((c) => (
              <button key={c.id} className={cat === c.id ? 'is-active' : ''} onClick={() => setCat(c.id)}>
                <FolderOpen /> {c.name}
                <span className="muted" style={{ marginLeft: 'auto' }}>{db.services.filter((s) => s.categoryId === c.id).length}</span>
              </button>
            ))}
          </div>
        </section>
        <section className="panel">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Service</th>
                  <th className="ta-r">Price</th>
                  <th>Active</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((s) => (
                  <tr key={s.id} style={!s.active ? { opacity: 0.6 } : undefined}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{s.name}</div>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {db.serviceCategories.find((c) => c.id === s.categoryId)?.name}
                      </div>
                    </td>
                    <td className="ta-r num" style={{ fontWeight: 700 }}>
                      {money(s.price)}
                    </td>
                    <td>
                      <Switch
                        on={s.active}
                        label={`${s.name} active`}
                        onChange={(v) => {
                          s.active = v;
                          touch();
                          toast('success', v ? 'Service activated' : 'Service deactivated', s.name);
                        }}
                      />
                    </td>
                    <td className="ta-r">
                      <Menu>
                        <button className="menu__item" onClick={() => open(s)}>
                          <Pencil /> Edit price & documents
                        </button>
                      </Menu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <Drawer
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.name ?? ''}
        sub="Changing the price affects new bills only — existing bills keep their rate."
        foot={
          <>
            <button className="btn btn-secondary" onClick={() => setEdit(null)}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              disabled={!price}
              onClick={() => {
                if (!edit) return;
                const before = edit.price;
                edit.price = Number(price);
                if (before !== edit.price)
                  db.audit.unshift({ id: `S${Date.now()}`, at: new Date(), actor: user.id, action: 'SERVICE_RATE_UPDATED', entity: 'Service', entityId: edit.id, summary: `${edit.name} price updated`, ip: '192.168.1.11', before: { price: money(before) }, after: { price: money(edit.price) } });
                touch();
                toast('success', 'Service updated', edit.name);
                setEdit(null);
              }}
            >
              Save changes
            </button>
          </>
        }
      >
        {edit && (
          <div className="stack" style={{ gap: 18 }}>
            <Field label="Current price" required hint={`Was ${money(edit.price)}`} htmlFor="sp">
              <MoneyInput id="sp" value={price} onChange={setPrice} xl />
            </Field>
          </div>
        )}
      </Drawer>
    </>
  );
}
