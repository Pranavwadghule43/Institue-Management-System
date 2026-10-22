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

const store = loadSource('src/data/store.ts');
const { validInstituteSlot, formatInstituteSlot, addMonthsClamped } = loadSource('src/lib/schedule.ts');

test('enquiry validation, staff history, and one-time admission conversion', () => {
  assert.throws(() => store.createEnquiry({ name: '', phone: '123', fatherName: '', email: '', address: '', aadhaar: '', reference: '', courseId: 'C1', subtypeId: '' }, 'U2'));
  const enquiry = store.createEnquiry({ name: 'Test Student', phone: '9876543210', fatherName: 'Parent', email: '', address: 'Test address', aadhaar: '', reference: 'Walk-in', courseId: 'C1', subtypeId: '' }, 'U2');
  assert.equal(enquiry.status, 'New');
  assert.equal(enquiry.aadhaar, '');
  store.updateEnquiry(enquiry.id, 'Follow-Up', 'Called parent', 'U1');
  assert.equal(enquiry.activity.length, 2);
  assert.equal(enquiry.handledBy, 'U1');
  const result = store.admitStudent({ name: enquiry.name, fatherName: enquiry.fatherName, gender: 'Male', dob: new Date('2000-01-01'), phone: enquiry.phone, email: '', address: enquiry.address, aadhaar: '', courseId: 'C1', batchId: 'B1', enquiryId: enquiry.id, courseFee: 7500, discount: 0, initial: 500, installments: 8, firstDue: new Date('2026-11-01'), mode: 'Cash' }, 'U2');
  assert.equal(enquiry.status, 'Converted');
  assert.equal(enquiry.studentId, result.student.id);
  assert.equal(enquiry.activity.length, 3);
  assert.equal(enquiry.activity[2].by, 'U2');
  assert.equal(result.student.installments.length, 9);
  assert.equal(result.student.installments.reduce((sum, row) => sum + row.amount, 0), 7500);
  assert.equal(store.balanceFor(result.student), 7000);
  const countAfterAdmission = store.db.students.length;
  assert.throws(() => store.admitStudent({ ...result.student, initial: 0, installments: 8, firstDue: new Date('2026-11-01'), mode: 'Cash' }, 'U2'), /already converted/);
  assert.equal(store.db.students.length, countAfterAdmission);
  assert.throws(() => store.updateEnquiry(enquiry.id, 'Pending', '', 'U2'), /Converted enquiries/);
  store.collectFee(result.student.id, 7000, 'Cash', '', '', 'U2');
  assert.equal(store.balanceFor(result.student), 0);
  assert.equal(store.nextDue(result.student), null);
  assert.throws(() => store.collectFee(result.student.id, 1, 'Cash', '', '', 'U2'));
});

test('course time slots respect 8 AM to 9 PM and allow variable duration', () => {
  assert.equal(validInstituteSlot('08:00', '09:00'), true);
  assert.equal(validInstituteSlot('19:30', '21:00'), true);
  assert.equal(validInstituteSlot('07:59', '09:00'), false);
  assert.equal(validInstituteSlot('20:00', '21:01'), false);
  assert.equal(validInstituteSlot('10:00', '10:00'), false);
  assert.equal(formatInstituteSlot('08:00', '09:30'), '8:00 AM – 9:30 AM');
  assert.equal(addMonthsClamped(new Date(2026, 0, 31), 1).getDate(), 28);
});
