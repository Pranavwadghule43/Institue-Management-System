const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const esbuild = require('esbuild');

function loadSource(source) {
  const filename = path.join(process.cwd(), source);
  const result = esbuild.buildSync({ entryPoints: [filename], bundle: true, platform: 'node', format: 'cjs', write: false });
  const compiled = new Module(filename, module);
  compiled.filename = filename;
  compiled.paths = module.paths;
  compiled._compile(result.outputFiles[0].text, filename);
  return compiled.exports;
}

// Business rules live in the FastAPI backend (backend/tests). These cover the UI-side preview helpers only.
const { validInstituteSlot, formatInstituteSlot, addMonthsClamped, eligibleTimeSlots } = loadSource('src/lib/schedule.ts');

test('course time slots respect 8 AM to 9 PM and allow variable duration', () => {
  assert.equal(validInstituteSlot('08:00', '09:00'), true);
  assert.equal(validInstituteSlot('19:30', '21:00'), true);
  assert.equal(validInstituteSlot('07:59', '09:00'), false);
  assert.equal(validInstituteSlot('20:00', '21:01'), false);
  assert.equal(validInstituteSlot('10:00', '10:00'), false);
  assert.equal(formatInstituteSlot('08:00', '09:30'), '8:00 AM – 9:30 AM');
  assert.equal(addMonthsClamped(new Date(2026, 0, 31), 1).getDate(), 28);
});

test('batch choices keep course-wide slots and match any selected subtype of the course', () => {
  const slots = [
    { id: 1, course_id: 10, course_subtype_id: null },
    { id: 2, course_id: 10, course_subtype_id: 4 },
    { id: 3, course_id: 10, course_subtype_id: 5 },
    { id: 4, course_id: 20, course_subtype_id: null },
  ];
  assert.deepEqual(eligibleTimeSlots(slots, 10, []).map((slot) => slot.id), [1]);
  assert.deepEqual(eligibleTimeSlots(slots, 10, [5]).map((slot) => slot.id), [1, 3]);
  assert.deepEqual(eligibleTimeSlots(slots, 10, [4, 5]).map((slot) => slot.id), [1, 2, 3]);
  assert.deepEqual(eligibleTimeSlots(slots, 20, [4, 5]).map((slot) => slot.id), [4]);
  assert.equal(eligibleTimeSlots(undefined, 10, [4]), undefined);
});

// 19 Nov: bills and receipts open the chat for the registered number the same way the fee reminder does.
const { waLink, waNumber } = loadSource('src/lib/whatsapp.ts');

test('WhatsApp numbers follow the fee-reminder rules and open the exact chat', () => {
  assert.deepEqual(waNumber('98765 43210'), { local: '9876543210', problem: null });
  assert.deepEqual(waNumber('+91 98765 43210'), { local: '9876543210', problem: null });
  assert.deepEqual(waNumber('09876543210'), { local: '9876543210', problem: null });
  assert.equal(waNumber('').problem, 'missing');
  assert.equal(waNumber(null).problem, 'missing');
  assert.equal(waNumber('12345').problem, 'invalid');
  assert.equal(waNumber('5876543210').problem, 'invalid');
  assert.equal(waNumber('name 9876543210').problem, 'invalid');
  assert.equal(waLink('9876543210', 'Bill SB-1'), 'https://wa.me/919876543210?text=Bill%20SB-1');
});

const { admissionPrice } = loadSource('src/lib/admissionPricing.ts');
const { evenPlan, planError } = loadSource('src/components/PlanEditor.tsx');

test('admission pricing counts each configured subtype once and falls back to the course', () => {
  const first = { id: 1, fee: '4000.15' };
  const second = { id: 2, fee: '6000.20' };
  const blank = { id: 3, fee: null };
  assert.deepEqual(admissionPrice('7500.00', [blank]), { usesSubtypeFees: false, feePaise: 750000 });
  assert.deepEqual(admissionPrice('7500.00', [first, second, blank, first]), { usesSubtypeFees: true, feePaise: 1000035 });
  assert.deepEqual(admissionPrice('7500.00', [{ id: 4, fee: '0.00' }, blank]), { usesSubtypeFees: true, feePaise: 0 });
});

test('installment splitting and comparisons retain paise', () => {
  const rows = evenPlan(2, '2026-12-01', 7250.15);
  assert.deepEqual(rows.map((row) => row.amount), [3600, 3650.15]);
  assert.equal(planError(rows, 7250.15, '2026-11-19'), null);
  assert.equal(planError([{ due: '2026-12-01', amount: 0.1 }, { due: '2026-12-02', amount: 0.2 }], 0.3, '2026-11-19'), null);
});
