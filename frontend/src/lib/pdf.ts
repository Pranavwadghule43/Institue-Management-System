/* Real PDF files for receipts and bills, rendered from the same template components as the print view.
   html2canvas draws each page with the browser's own text shaping (Marathi renders correctly); jsPDF wraps the
   pages into an A5 PDF (receipt landscape, bill portrait). Both libraries load only when a PDF is requested. */
import type { ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

export async function docToPdf(node: ReactNode, fileName: string): Promise<File> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:-10000px;top:0;background:#fff';
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    flushSync(() => root.render(node));
    await Promise.all([...host.querySelectorAll('img')].map((img) => (img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; }))));
    await document.fonts?.ready;
    let pdf: InstanceType<typeof jsPDF> | null = null;
    for (const el of host.querySelectorAll<HTMLElement>('.doc')) {
      const landscape = el.classList.contains('doc--receipt');
      const canvas = await html2canvas(el, { scale: 3, backgroundColor: '#ffffff', logging: false });
      const [pw, ph] = landscape ? [210, 148] : [148, 210];
      if (!pdf) pdf = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'mm', format: 'a5', compress: true });
      else pdf.addPage('a5', landscape ? 'landscape' : 'portrait');
      const margin = 4;
      const w = pw - 2 * margin;
      const h = Math.min(ph - 2 * margin, (w * canvas.height) / canvas.width);
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', margin, margin, w, h);
    }
    if (!pdf) throw new Error('Nothing to export');
    return new File([pdf.output('blob')], fileName, { type: 'application/pdf' });
  } finally {
    root.unmount();
    host.remove();
  }
}

export function saveFile(file: File) {
  const url = URL.createObjectURL(file);
  Object.assign(document.createElement('a'), { href: url, download: file.name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
