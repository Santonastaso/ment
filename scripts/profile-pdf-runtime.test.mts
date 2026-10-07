import { assertEquals } from 'jsr:@std/assert@1';

Deno.test('the Edge Function PDF parser extracts CV text', async () => {
  const text = 'Synthetic CV Analyst London';
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;

  const { getDocument } = await import('npm:pdfjs-dist@4.7.76/legacy/build/pdf.mjs');
  const document = await getDocument({ data: new TextEncoder().encode(pdf) }).promise;
  const page = await document.getPage(1);
  const content = await page.getTextContent();
  assertEquals(content.items.map(item => 'str' in item ? item.str : '').join(' '), text);
  await document.destroy();
});
