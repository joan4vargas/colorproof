"""Gera os PDFs de teste das cores spot (src/lib/pdf/__fixtures__).

spot-cmyk.pdf: spots cujo alternativo é DeviceCMYK (reportlab, função de tinta tipo 4).
spot-lab.pdf : um spot cujo alternativo é Lab (escrito à mão, função tipo 2), como o
               Illustrator e o InDesign gravam o Pantone.
Os valores são inventados para o teste; NÃO são valores oficiais da Pantone.

Requer: pip install reportlab
Uso:    python scripts/gerar-fixtures-spot.py
"""
from pathlib import Path
from reportlab.lib.colors import CMYKColor, CMYKColorSep
from reportlab.pdfgen import canvas

OUT = Path(__file__).resolve().parent.parent / "src/lib/pdf/__fixtures__"

c = canvas.Canvas(str(OUT / "spot-cmyk.pdf"), pagesize=(200, 100), invariant=1, pageCompression=0)
c.setFillColor(CMYKColorSep(0.0, 0.9, 0.8, 0.0, spotName="PANTONE TESTE A C", density=1)); c.rect(0, 50, 50, 50, stroke=0, fill=1)
c.setFillColor(CMYKColorSep(0.9, 0.5, 0.0, 0.0, spotName="PANTONE TESTE B C", density=1)); c.rect(50, 50, 50, 50, stroke=0, fill=1)
c.setFillColor(CMYKColorSep(0.0, 0.9, 0.8, 0.0, spotName="PANTONE TESTE A C", density=0.5)); c.rect(100, 50, 50, 50, stroke=0, fill=1)
c.setFillColor(CMYKColor(0.2, 0.2, 0.2, 0.2)); c.rect(150, 50, 50, 50, stroke=0, fill=1)
c.save()

objs = []
def o(s): objs.append(s)
o("<< /Type /Catalog /Pages 2 0 R >>")
o("<< /Type /Pages /Kids [3 0 R] /Count 1 >>")
o("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R /Resources << /ColorSpace << /CS0 5 0 R >> >> >>")
o(None)
o("[ /Separation /PANTONE#20LAB#20TESTE#20C [ /Lab << /WhitePoint [0.9642 1 0.8249] /Range [-128 127 -128 127] >> ] 6 0 R ]")
o("<< /FunctionType 2 /Domain [0 1] /C0 [100 0 0] /C1 [45 70 40] /N 1 >>")
content = b"/CS0 cs 1 scn 0 50 50 50 re f 0.5 scn 50 50 50 50 re f"
out = b"%PDF-1.4\n"; offs = []
for i, s in enumerate(objs, 1):
    offs.append(len(out))
    body = (b"<< /Length %d >>\nstream\n" % len(content) + content + b"\nendstream") if i == 4 else s.encode()
    out += b"%d 0 obj\n" % i + body + b"\nendobj\n"
x = len(out)
out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1)
for f in offs: out += b"%010d 00000 n \n" % f
out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, x)
(OUT / "spot-lab.pdf").write_bytes(out)
print("ok")
