#!/usr/bin/env python3
"""生成超大 PDF 测试件（用于验证 moyu-file 协议 + pdf.js Range 流式读取）。

默认 300 页 × 约 935KB/页 ≈ 280MB，接近真实扫描版大书的体量。

用法:
    python scripts/gen_huge_pdf.py [输出路径] [页数]

验证方式（结果落在 user-data-dir 下的 test-result-crosswin.txt）:
    set MOYU_TEST_CROSSWIN=<pdf 绝对路径>
    墨鱼阅读器-0.1.0-portable.exe --user-data-dir=<临时目录>
    期望输出包含 CROSSWIN_OK 与 "container":"pdf"
"""
import os
import sys
import time

out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.getcwd(), 'test-huge.pdf')
pages = int(sys.argv[2]) if len(sys.argv) > 2 else 300

# 每页内容流：约 935KB 的合法文本绘制指令
filler = [
    f"(Line {i:05d} filler text for large pdf range-loading test - moyu reader) Tj 0 -0.5 Td"
    for i in range(1, 11000)
]
stream_body = ("BT /F1 9 Tf 20 820 Td 8 TL\n" + "\n".join(filler) + "\nET").encode('latin-1')

t0 = time.time()
offsets = {}
with open(out, 'wb') as f:
    f.write(b'%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')

    def obj(num, body):
        offsets[num] = f.tell()
        f.write(f'{num} 0 obj\n'.encode('latin-1'))
        f.write(body)
        f.write(b'\nendobj\n')

    kids = " ".join(f"{4 + 2 * i} 0 R" for i in range(pages))
    obj(1, b'<< /Type /Catalog /Pages 2 0 R >>')
    obj(2, f'<< /Type /Pages /Kids [{kids}] /Count {pages} /MediaBox [0 0 595 842] >>'.encode('latin-1'))
    obj(3, b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')

    for i in range(pages):
        page_num = 4 + 2 * i
        cont_num = 5 + 2 * i
        obj(page_num, f'<< /Type /Page /Parent 2 0 R /Contents {cont_num} 0 R >>'.encode('latin-1'))
        body = b'% page ' + str(i + 1).encode() + b'\n' + stream_body
        offsets[cont_num] = f.tell()
        f.write(f'{cont_num} 0 obj\n<< /Length {len(body)} >>\nstream\n'.encode('latin-1'))
        f.write(body)
        f.write(b'\nendstream\nendobj\n')

    maxnum = 5 + 2 * (pages - 1)
    xref_pos = f.tell()
    f.write(f'xref\n0 {maxnum + 1}\n'.encode('latin-1'))
    f.write(b'0000000000 65535 f \n')
    for n in range(1, maxnum + 1):
        f.write(f'{offsets.get(n, 0):010d} 00000 n \n'.encode('latin-1'))
    f.write(f'trailer\n<< /Size {maxnum + 1} /Root 1 0 R >>\nstartxref\n{xref_pos}\n%%EOF\n'.encode('latin-1'))

size_mb = os.path.getsize(out) / 1024 / 1024
print(f'{out}: {size_mb:.1f} MB, pages={pages}, {time.time() - t0:.1f}s')
