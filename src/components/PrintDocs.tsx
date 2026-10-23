/* Printable fee receipt and service bill, laid out from the institute's two-sided paper templates
   (FEE RECEIPT BOTH.pdf, SERVICE BILL BOTH SIDE.pdf). Front and back print as separate pages for duplex. */
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import logo from '../assets/logo.png';
import watermark from '../assets/logo-watermark.png';
import type { Bill, Receipt } from '../api/types';
import { date, money } from '../lib/format';
import { docToPdf } from '../lib/pdf';

export interface InstituteHead { name: string | null; tagline: string | null; address: string | null; phone: string | null }

/** What the printer sees: rendered straight under <body>, outside the app layout (sidebar, 1280px min-width),
    so each page is exactly the A5 template. Hidden on screen; print.css hides the app while printing. */
export const PrintArea = ({ children }: { children: ReactNode }) => createPortal(<div className="print-root">{children}</div>, document.body);

function Head({ inst, compact }: { inst: InstituteHead; compact?: boolean }) {
  return (
    <header className={`doc__head ${compact ? 'compact' : ''}`}>
      <img src={logo} alt="" />
      <div className="doc__brand">
        <h1>{(inst.name ?? 'Updaate Computers').toUpperCase()}</h1>
        {inst.tagline && <p className="doc__tagline">{inst.tagline}</p>}
        {inst.address && <p className="doc__addr">{compact ? inst.address : `Address : ${inst.address}`}</p>}
        {inst.phone && <p className="doc__mob">Mob. {inst.phone}</p>}
      </div>
    </header>
  );
}

const Watermark = () => <img className="doc__watermark" src={watermark} alt="" aria-hidden />;
const Stamp = ({ status }: { status: 'paid' | 'reversed' | 'cancelled' | null }) =>
  status ? <div className={`doc__stamp ${status}`}>{status.toUpperCase()}</div> : null;
const dd = (d: string | null | undefined) => (d ? date(d) : '');

/* ------------------------------ Fee receipt ------------------------------ */

export interface ReceiptPrintData {
  receiptNo: string; issuedAt: string; joiningDate?: string | null; studentName: string; studentCode: string; amountInWords: string;
  amount: string; installments: { due_date: string; amount: string }[]; course: string; totalCourseFee: string; paymentMode: string;
  courseExpiry?: string | null; balance: string; nextPaymentDate: string; inst: InstituteHead; status: 'paid' | 'reversed';
}

export const RECEIPT_TERMS = [
  'प्रवेश घेताना ज्या तारखेस फीचे पैसे भरले त्याच प्रमाणे दर महिन्याचे फीचे पैसे त्या महिन्याच्या त्याच तारखेस भरावे. लागतील व न भरल्यास परीक्षेस कोर्सला उशीर होऊ शकतो.',
  'एकदा घेतलेला प्रवेश रद्द होणार नाही, व भरलेली फी कोणत्याही कारणास्तव कोणाच्याही सांगण्यावरून परत केली जाणार नाही.',
  'एकदा घेतलेल्या कोर्समध्ये बदल होत नाही.',
  'प्रवेश घेताना ठरवून दिल्याप्रमाणे रक्कम भरावी. ठरलेल्या वेळेप्रमाणे रक्कम न भरल्यास व MSBTE ने फोटो नाकारल्यास परीक्षेस उशीर होऊ शकतो.',
  'यावर्षी घेतलेला प्रवेश याच वर्षी पूर्ण करावा. पुढच्या वर्षी त्या कोर्सला ग्राह्य धरले जाणार नाही.',
  'क्लासला सुट्ट्या केल्यास निकालासाठी क्लास जबाबदार राहणार नाही.',
  'आपला कोर्स वेळेत पूर्ण करावा व कोर्सचे प्रमाणपत्र वेळेत घेऊन जावे.',
  'कोणत्याही कोर्सच्या व परीक्षेच्या वेळापत्रकात बदल होत नाहीत.',
  'क्लासमध्ये कोणतीही गैरसोय व गैरवर्तन केल्याचे आढळल्यास क्लास प्रमुख यांच्याशी संपर्क साधावा.',
  'विद्यार्थ्यांनी क्लासला सुट्ट्या केल्यामुळे Discount दिलेल्या कोर्समधील कालावधीपेक्षा जास्त वेळ क्लास करावा लागल्यास दरमहा १०००/- रु फी आकारण्यात येईल.',
  'निकालासाठी पावती, स्क्रीन शॉट, हॉल तिकीट व मोबाईलमध्ये आलेला मेसेज जपून ठेवावा. सर्टिफिकेट घेते वेळी फोटो व हॉल तिकीट घेऊन यावे.',
  'MS-CIT कोर्सचे Provisional Certificate १ दिवसापर्यंत मिळते. Original Certificate २-३ महिन्यांपर्यंत मिळेल.',
  'आपला कोर्स पूर्ण झाल्यावर त्या कोर्सचे सर्टिफिकेटसाठी क्लास प्रमुख श्री नितीन कांबळे सर यांच्याकडे रितसर नाव नोंदणी करणे आवश्यक आहे, नाव नोंदणी शिवाय सर्टिफिकेट मिळणार नाही.',
  'कोणत्याही कोर्सला नापास झाल्यास पुनर्परीक्षेस लागणारी फी त्याच ८ दिवसात भरावी, उशीर झाल्यास क्लास जबाबदार राहणार नाही.',
];
const MARATHI_DIGITS = '०१२३४५६७८९';
const mr = (n: number) => String(n).replace(/\d/g, (d) => MARATHI_DIGITS[Number(d)]);

export function FeeReceiptPrint({ r }: { r: ReceiptPrintData }) {
  const boxes = Array.from({ length: 8 }, (_, i) => r.installments[i]);
  return (
    <div className="doc-set">
      <article className="doc doc--receipt">
        <Watermark />
        <Head inst={r.inst} />
        <div className="doc__rule" />
        <div className="doc__body">
          <div className="doc__row3">
            <span><b>Receipt No :</b> {r.receiptNo}</span>
            <span><b>Date :</b> {dd(r.issuedAt)}</span>
            <span><b>Joining Date</b> {dd(r.joiningDate)}</span>
          </div>
          <div className="doc__fill"><b>Received with Thanks From</b><span>{r.studentName} ({r.studentCode})</span></div>
          <div className="doc__fill"><b>The Sum Of Rs. (In Words)</b><span>{r.amountInWords}</span></div>
          <div className="doc__inst">
            <b>Fee Installments :</b>
            <div className="doc__boxes">
              {boxes.map((x, i) => (
                <div className="doc__box" key={i}>
                  <span className={x ? '' : 'ph'}>{x ? dd(x.due_date) : 'Date'}</span>
                  <span className={x ? '' : 'ph'}>{x ? money(x.amount) : 'Rs.'}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="doc__split">
            <div>
              <small className="doc__label">AMOUNT RECEIVED</small>
              <div className="doc__big">{money(r.amount)}</div>
            </div>
            <div className="doc__side">
              <span><b>Balance :</b> {money(r.balance)}</span>
              <span><b>Next Due :</b> {/^\d{4}-/.test(r.nextPaymentDate) ? dd(r.nextPaymentDate) : r.nextPaymentDate}</span>
            </div>
          </div>
          <div className="doc__row2">
            <span><b>Course Name :</b> {r.course}</span>
            <span><b>Total Course Fee</b> {money(r.totalCourseFee)}</span>
          </div>
          <div className="doc__row2">
            <span><b>Payment Mode :</b> {r.paymentMode}</span>
            <span><b>Course Expire Date :</b> {dd(r.courseExpiry)}</span>
          </div>
        </div>
        <Stamp status={r.status === 'reversed' ? 'reversed' : null} />
      </article>

      <article className="doc doc--receipt doc--back">
        <h2 className="doc__terms-title">नियम व अटी</h2>
        <ol className="doc__terms">
          {RECEIPT_TERMS.map((t, i) => <li key={i}><span>{mr(i + 1)})</span> {t}</li>)}
        </ol>
        <p className="doc__terms-sign"><b>क्लास प्रमुख : श्री नितीन कांबळे सर</b><br /><b>मोबाईल : 7888 2 80 80 7 / 86 90 32 80 80</b></p>
      </article>
    </div>
  );
}

/* ------------------------------ Service bill ------------------------------ */

export interface BillPrintData {
  billNo: string; date: string; customerName: string; mobile: string; work: string; portalUser?: string; portalPassword?: string;
  items: { name: string; qty: number; rate: number | string; amount: number | string }[]; subtotal: number | string; discount: number | string;
  total: number | string; inst: InstituteHead; status: 'paid' | 'cancelled' | null; paidNote?: string;
}

const SERVICES_AVAILABLE = [
  ['Xerox', 'Color Print', 'Photo Print', 'Aadhar Card Print', 'Passport Size Photo', 'Document Scanning', 'Document Lamination', 'Resume / Biodata', 'Eng / Mar Typing', 'PPT Presentation', 'Light Bill'],
  ['New Pancard', 'Shop Act Licence', 'Udyog Adhar', 'Food Licence', 'Police Verification', 'Driving Licence', 'Voter ID', '7 / 12, 8 A', 'Money Transfer', 'Mobile Recharge'],
  ['Online Admission Form', 'Scholarship Form', 'Govt. Job Application Form', 'Private Job Application Form', 'Police, Talathi Recruitment Form', 'Zilla Parishad Recruitment Form', 'Railway, Banking, SSC,', 'UPSC, MPSC & Other Exam Form', 'ITI Admission Form', 'PF Service', 'E Shram Card'],
];
const COURSES_OFFERED = [
  ['MS-CIT', 'Advance Excel', 'Tally Prime GST', 'Advance Tally GST'],
  ['English Typing', 'Marathi Typing', 'Hindi Typing', 'Data Entry'],
  ['Photo Editing', 'Graphic Design', 'Video Editing', 'MS-Office'],
];

const Fill = ({ label, children }: { label: string; children: ReactNode }) => <div className="doc__fill"><b>{label}</b><span>{children}</span></div>;

export function ServiceBillPrint({ b }: { b: BillPrintData }) {
  return (
    <div className="doc-set">
      <article className="doc doc--bill">
        <Watermark />
        <Head inst={b.inst} compact />
        <div className="doc__rule" />
        <div className="doc__body">
          <div className="doc__row2">
            <span><b>Receipt No :</b> {b.billNo}</span>
            <span><b>Date</b> {dd(b.date)}</span>
          </div>
          <div className="doc__gap" />
          <Fill label="Customer Name -">{b.customerName}</Fill>
          <Fill label="Customer Mobile No -">{b.mobile}</Fill>
          <Fill label="Work -">{b.work}</Fill>
          <Fill label="User Name Custom Type:">{b.portalUser}</Fill>
          <Fill label="Password Custom Type:">{b.portalPassword}</Fill>
          <table className="doc__table">
            <thead>
              <tr><th>Sr No</th><th>Particulars</th><th className="ta-c">QTY</th><th className="ta-r">Rate</th><th className="ta-r">Amount</th></tr>
            </thead>
            <tbody>
              {b.items.map((i, k) => (
                <tr key={k}><td>{k + 1}</td><td>{i.name}</td><td className="ta-c">{i.qty}</td><td className="ta-r">{money(i.rate)}</td><td className="ta-r">{money(i.amount)}</td></tr>
              ))}
            </tbody>
          </table>
          <div className="doc__total">
            {Number(b.discount) > 0 && (
              <>
                <span>Subtotal</span><strong>{money(b.subtotal)}</strong>
                <span>Discount</span><strong>− {money(b.discount)}</strong>
              </>
            )}
            <span className="grand">Total Bill</span><strong className="grand">{money(b.total)}</strong>
          </div>
          {b.paidNote && <p className="doc__note">{b.paidNote}</p>}
        </div>
        <Stamp status={b.status} />
      </article>

      <article className="doc doc--bill doc--back">
        <h2 className="doc__services-title">Services Available with US</h2>
        <div className="doc__cols">
          {SERVICES_AVAILABLE.map((col, i) => <ul key={i}>{col.map((s) => <li key={s}>{s}</li>)}</ul>)}
        </div>
        <p className="doc__courses-title">आमच्याकडे सरकारमान्यता प्राप्त घेतले जाणारे कॉम्प्युटर कोर्स</p>
        <div className="doc__cols doc__cols--courses">
          {COURSES_OFFERED.map((col, i) => <ul key={i}>{col.map((s) => <li key={s}>- {s}</li>)}</ul>)}
        </div>
        <div className="doc__backfoot">
          <span>Thank You! You Are Our Happy Customer</span>
          <div className="doc__qr"><div className="doc__qrbox" /><span>Scan Location</span></div>
        </div>
      </article>
    </div>
  );
}

/* ------------------------------ API -> template data, and PDF files ------------------------------ */

export function receiptPrintData(r: Receipt): ReceiptPrintData {
  const s = r.snapshot;
  return {
    receiptNo: r.receipt_no, issuedAt: s.issued_at, joiningDate: s.joining_date, studentName: s.student.name, studentCode: s.student.code,
    amountInWords: s.amount_in_words, amount: s.payment.amount, installments: s.installments ?? [],
    course: `${s.course.code} — ${s.course.name}${s.course_subtype ? ` (${s.course_subtype})` : ''}`, totalCourseFee: s.total_course_fee ?? s.net_fee,
    paymentMode: `${s.payment.mode_label}${s.payment.reference ? ` · ${s.payment.reference}` : ''}`, courseExpiry: s.course_expiry_date,
    balance: s.balance, nextPaymentDate: s.next_payment_date, inst: s.institute, status: r.status === 'Reversed' ? 'reversed' : 'paid',
  };
}

export function billPrintData(b: Bill, portal: { user?: string; pass?: string } = {}): BillPrintData {
  return {
    billNo: b.code, date: b.created_at, customerName: b.customer.name, mobile: b.customer.mobile,
    work: b.job.application_name || b.items.map((i) => i.name).join(', '), portalUser: portal.user, portalPassword: portal.pass,
    items: b.items.map((i) => ({ name: i.name, qty: i.quantity, rate: i.rate, amount: i.line_amount })), subtotal: b.subtotal, discount: b.discount,
    total: b.grand_total, inst: b.institute, status: b.status === 'Paid' ? 'paid' : b.status === 'Cancelled' ? 'cancelled' : null,
    paidNote: b.payment && b.paid_at ? `Paid in full by ${b.payment.mode_label}.` : undefined,
  };
}

export const receiptPdf = (r: Receipt) => docToPdf(<FeeReceiptPrint r={receiptPrintData(r)} />, `Receipt-${r.receipt_no}.pdf`);
export const billPdf = (b: BillPrintData) => docToPdf(<ServiceBillPrint b={b} />, `Bill-${b.billNo}.pdf`);
