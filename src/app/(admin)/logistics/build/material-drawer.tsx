'use client';

/**
 * `הוספת חומר — <משימה>`
 *
 * The one thing this screen writes. Everything else it shows is read from the
 * warehouse and the רכש list and computed at load.
 *
 * The form asks where the thing is coming from, and offers exactly three
 * answers, because those are the three that exist: it is on a shelf, it is on
 * the shopping list, or nobody has dealt with it yet. The third is a real
 * answer and not a missing one — a task needing something nobody has thought
 * about is the state this screen exists to make visible.
 */

import { useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Drawer } from '@/components/ui/drawer';
import { Field, Segmented, Select, TextInput } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { Banner } from '@/components/ui/banner';
import { useToast } from '@/components/ui/toaster';
import { isBlank } from '@/lib/text/normalize';
import { CONDITION_LABELS, STATUS_LABELS } from '@/lib/logistics/labels';
import type { ItemCondition, AcquisitionStatus } from '@/db/schema/logistics';
import { addMaterialAction } from './actions';
import styles from './build.module.css';

export interface StockOption {
  id: string; name: string; locationText: string | null; condition: ItemCondition;
}
export interface OrderOption {
  id: string; name: string; status: AcquisitionStatus;
}

type Source = 'stock' | 'order' | 'unknown';
type Refusal = { where: 'name' | 'quantity' | 'link' | 'form'; message: string };

export function MaterialDrawer({
  taskId, taskTitle, stock, orders, closeHref,
}: {
  taskId: string;
  taskTitle: string;
  stock: readonly StockOption[];
  orders: readonly OrderOption[];
  closeHref: string;
}) {
  const router = useRouter();
  const { show } = useToast();

  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [source, setSource] = useState<Source>('unknown');
  const [stockId, setStockId] = useState('');
  const [orderId, setOrderId] = useState('');
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);

  function errorFor(where: Refusal['where']): string | undefined {
    return refusal?.where === where ? refusal.message : undefined;
  }

  /* Choosing a row fills the name box when it is still empty — the thing is
     usually called what it is called in the warehouse, and a lead who wants
     it called something else can simply type over it. Nothing is overwritten. */
  function pickStock(id: string) {
    setStockId(id);
    const chosen = stock.find((one) => one.id === id);
    if (chosen !== undefined && isBlank(name)) setName(chosen.name);
  }

  function pickOrder(id: string) {
    setOrderId(id);
    const chosen = orders.find((one) => one.id === id);
    if (chosen !== undefined && isBlank(name)) setName(chosen.name);
  }

  async function save(event?: FormEvent) {
    event?.preventDefault();
    setRefusal(null);

    if (isBlank(name)) {
      setRefusal({ where: 'name', message: 'לחומר חייב להיות שם, אחרת אי אפשר לדעת מה צריך' });
      return;
    }
    const needed = Number(quantity.trim());
    if (!Number.isInteger(needed) || needed < 1) {
      setRefusal({ where: 'quantity', message: 'הכמות הדרושה חייבת להיות מספר שלם, אחד או יותר' });
      return;
    }
    if (source === 'stock' && isBlank(stockId)) {
      setRefusal({ where: 'link', message: 'צריך לבחור את הפריט במחסן' }); return;
    }
    if (source === 'order' && isBlank(orderId)) {
      setRefusal({ where: 'link', message: 'צריך לבחור את הפריט ברשימת הרכש' }); return;
    }

    setPending(true);
    try {
      const result = await addMaterialAction({
        taskId,
        name,
        quantityNeeded: needed,
        inventoryItemId: source === 'stock' ? stockId : null,
        acquisitionItemId: source === 'order' ? orderId : null,
      });
      if (!result.ok) { setRefusal({ where: 'form', message: result.error }); return; }

      show({ message: `${name.trim()} נוסף ל${taskTitle}`, tone: 'ok' });
      router.push(closeHref);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <Drawer
      title={`הוספת חומר — ${taskTitle}`}
      subtitle="מה שהמשימה הזו דורשת כדי שאפשר יהיה לבצע אותה"
      closeHref={closeHref}
      width={500}
      phone="full"
      footer={(
        <>
          <Button tone="primary" onClick={() => { void save(); }} disabled={pending}>
            הוספת החומר
          </Button>
          <Button onClick={() => { router.push(closeHref); }} disabled={pending}>ביטול</Button>
        </>
      )}
    >
      <form className={styles.form} onSubmit={save}>
        <Field id="material-name" label="מה צריך" required error={errorFor('name')}>
          <TextInput id="material-name" value={name} onChange={setName} />
        </Field>

        <Field id="material-quantity" label="כמה צריך" required error={errorFor('quantity')}>
          <input
            className={styles.plainInput}
            id="material-quantity"
            type="number" min="1" step="1" inputMode="numeric"
            value={quantity}
            onChange={(event) => { setQuantity(event.target.value); }}
          />
        </Field>

        <Field
          id="material-source"
          label="מאיפה זה מגיע"
          as="group"
          hint="שלוש התשובות שקיימות. ״עוד לא ידוע״ היא תשובה, לא חוסר — משימה שצריכה משהו שאיש לא טיפל בו היא בדיוק מה שהמסך הזה נועד להראות."
        >
          <Segmented
            id="material-source"
            name="material-source"
            value={source}
            onChange={(value) => { setSource(value as Source); }}
            options={[
              { value: 'stock', label: 'מהמחסן' },
              { value: 'order', label: 'מרשימת הרכש' },
              { value: 'unknown', label: 'עוד לא ידוע' },
            ]}
          />
        </Field>

        {source === 'stock' && (
          <Field id="material-stock" label="איזה פריט במחסן" required error={errorFor('link')}>
            <Select
              id="material-stock"
              value={stockId}
              emptyLabel="—"
              onChange={pickStock}
              options={stock.map((item) => ({
                value: item.id,
                label: item.locationText === null
                  ? `${item.name} · ${CONDITION_LABELS[item.condition]}`
                  : `${item.name} · ${item.locationText} · ${CONDITION_LABELS[item.condition]}`,
              }))}
            />
          </Field>
        )}

        {source === 'order' && (
          <Field id="material-order" label="איזה פריט ברכש" required error={errorFor('link')}>
            <Select
              id="material-order"
              value={orderId}
              emptyLabel="—"
              onChange={pickOrder}
              options={orders.map((order) => ({
                value: order.id,
                label: `${order.name} · ${STATUS_LABELS[order.status]}`,
              }))}
            />
          </Field>
        )}

        <Banner
          tone="neutral"
          headline="מצב החומר מחושב, לא נבחר."
          detail="״במחסן״, ״הושג״ או ״צריך להשיג״ נקבעים מהקישור שבחרתם ומהמצב של הפריט השני ברגע הצפייה. אין כאן שדה סטטוס — סטטוס שמור היה ממשיך להגיד ״במחסן״ גם אחרי שמישהו לקח את הפריט."
        />

        {refusal?.where === 'form' && (
          <p className={styles.formError} role="alert">{refusal.message}</p>
        )}
      </form>
    </Drawer>
  );
}
