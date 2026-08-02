export const createMinimalPdf = (): Uint8Array<ArrayBuffer> => {
    const contentStream = 'BT /F1 12 Tf 72 720 Td (Hello PDF world.) Tj ET';
    const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
        `<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream`,
        '<< /Title (Adapter Test) /Author (Test Author) >>',
    ];

    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    objects.forEach((object, index) => {
        offsets.push(pdf.length);
        pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });

    const xrefOffset = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n`;
    pdf += '0000000000 65535 f \n';
    for (const offset of offsets.slice(1)) {
        pdf += `${offset.toString().padStart(10, '0')} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 6 0 R >>\n`;
    pdf += `startxref\n${xrefOffset}\n%%EOF`;

    const encoded = new TextEncoder().encode(pdf);
    return new Uint8Array(encoded.buffer as ArrayBuffer);
};