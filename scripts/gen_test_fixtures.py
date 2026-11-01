#!/usr/bin/env python3
"""生成阅读器排版验证样本（多格式）。

统一内容规格（跨格式可比）：标题层级 / 字号对照 / 中英混排 / 粗细倾斜 /
颜色 / 列表 / 引用 / 代码 / 表格 / 对齐 / 特殊符号 / 长段落换行。

输出结构:
    test-fixtures/
      ├── README.md
      ├── txt/    md/    epub/    docx/    fb2/    cbz/
      └── pdf/（由 scripts/make-test-pdf.cjs 用 Chromium 打印，本脚本只产出源 HTML）

用法: python scripts/gen_test_fixtures.py
"""
import os
import struct
import sys
import zipfile
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'test-fixtures')

TITLE = '排版验证样本'
SUBTITLE = '墨鱼阅读器 · 字体与排版校验'
AUTHOR = '墨鱼测试组'

# ---------- 统一文本内容 ----------
P_CN = ('阅读器的排版质量，最终体现在读者是否愿意长时间停留。字号的层级是否清晰、'
        '行距是否让人呼吸顺畅、段间距能否区隔语义、中文标点是否被正确压缩与避头尾处理，'
        '这些细节决定了一本书读起来是「舒服」还是「费劲」。本段为纯中文长段落，'
        '用于验证自动换行、行高、两端对齐与首行缩进在连续文本中的稳定性。')

P_EN = ('Typography is the craft of endowing human language with a durable visual form. '
        'A well-set paragraph keeps an even colour on the page, avoids rivers of white space, '
        'and lets the eye travel without friction from one line to the next.')

P_MIX = ('本项目使用 Electron 33 + React 18 构建，单文件安装包约 86.2 MB，'
         '支持 EPUB / PDF / TXT / Markdown / FB2 / CBZ 六种格式；'
         '价格 ¥199.00（含税），折扣 −15%，好评率 98.6%。')

LONG_CN = (
    '长段落换行验证。' + '在城市里读书是一件需要仪式感的事：找一个不被打扰的角落，把手机翻面扣在桌上，'
    '让光线从侧面落到纸页或屏幕上。电子阅读器要做的，是把这种仪式感的成本降到最低——'
    '打开即读，退出即走，位置不丢，设置记住。' * 3
)

URL = 'https://example.com/a/very/long/path/that/should/not/break/the/layout/but/must/wrap-somewhere'


def chapters():
    """返回 [(章标题, [(小节标题, [块...])])]，块为 (type, payload)。"""
    return [
        (f'第一章 排版基础', [
            ('表格', [
                ('table', [
                    ['格式', '引擎', '定位方式'],
                    ['EPUB', 'epub.js', 'CFI'],
                    ['PDF', 'pdf.js', '页码'],
                    ['TXT', '自研', '字符偏移'],
                ]),
            ]),
            ('字号对照', [
                ('h3', '超大标题 24px / 1.5em'),
                ('h4', '小标题 18px / 1.125em'),
                ('p', '正文基准 17px（阅读器默认），这是最常见的阅读字号。' + P_CN[:60]),
                ('small', '注释小字 13px：用于脚注、来源、辅助说明。'),
            ]),
            ('字体族对照', [
                ('p', '宋体（serif）：' + P_CN[:48]),
                ('p', '黑体（sans-serif）：' + P_CN[:48]),
                ('p', '楷体（楷体/STKaiti）：' + P_CN[:48]),
                ('p', '等宽（monospace）：const reader = new Reader();'),
            ]),
            ('粗细与倾斜', [
                ('p', '普通 / 粗体 / 斜体 / 粗斜体 / 下划线 / 删除线'),
                ('p_rich', None),
            ]),
            ('颜色', [
                ('colors', None),
            ]),
            ('列表', [
                ('ol', ['打开书籍并恢复上次位置', '调整字号与主题', '退出时自动保存进度']),
                ('ul', ['支持 EPUB 与 PDF', '支持 TXT / Markdown / FB2', '支持 CBZ 漫画包']),
            ]),
        ]),
        ('第二章 文种与长文本', [
            ('中英混排', [
                ('p', P_MIX),
                ('p', P_EN),
            ]),
            ('对齐', [
                ('align_center', '居中对齐 · Centered'),
                ('align_right', '右对齐 · Right aligned'),
            ]),
            ('引用与代码', [
                ('quote', '好的排版是隐形的：读者不会注意到它，只会觉得读起来顺畅。'),
                ('code', 'function save(locator) {\n  return db.put("books", locator)\n}'),
            ]),
        ]),
        ('第三章 标点与边界', [
            ('特殊符号', [
                ('p', '省略号…… 破折号—— 中文引号“双引号”与‘单引号’ 西文引号 "double" 与 \'single\''),
                ('p', '序号 ①②③④⑤ 单位 ℃ ± × ÷ ‰ 箭头 → ← ↑ ↓ 对错 ✓ ✗ 星标 ★ ☆'),
                ('p', '全角标点：，。；：？！（）【】《》〈〉「」『』'),
            ]),
            ('长文本换行', [
                ('p', LONG_CN),
                ('p', '超长 URL（验证断词策略）：' + URL),
            ]),
        ]),
    ]


# ---------- TXT ----------
def gen_txt(d):
    lines = [f'{TITLE}', SUBTITLE, f'作者：{AUTHOR}', '', '=' * 56, '']
    for ci, (cname, subs) in enumerate(chapters(), 1):
        lines += [cname, '-' * 56, '']
        for sname, blocks in subs:
            lines += [f'【{sname}】', '']
            for kind, payload in blocks:
                if kind in ('h3', 'h4'):
                    lines += [str(payload), '']
                elif kind == 'small':
                    lines += ['    ' + str(payload), '']
                elif kind == 'p':
                    lines += ['　　' + str(payload), '']
                elif kind == 'p_rich':
                    lines += ['    普通 / 粗体 / 斜体 / 粗斜体 / 下划线 / 删除线',
                              '    （纯文本无样式：本行验证「样式描述」是否被当作正文正确显示）', '']
                elif kind == 'colors':
                    lines += ['    颜色：红色 绿色 蓝色 灰色（纯文本格式不支持着色，仅验证文字）', '']
                elif kind == 'ol':
                    lines += [f'    {i}. {t}' for i, t in enumerate(payload, 1)] + ['']
                elif kind == 'ul':
                    lines += [f'    · {t}' for t in payload] + ['']
                elif kind == 'quote':
                    lines += ['    ｜ ' + payload, '']
                elif kind == 'code':
                    lines += ['    ' + ln for ln in str(payload).split('\n')] + ['']
                elif kind == 'table':
                    lines += ['    ' + ' | '.join(r) for r in payload] + ['']
                elif kind == 'align_center':
                    lines += ['                    ' + str(payload), '']
                elif kind == 'align_right':
                    lines += ['                                            ' + str(payload), '']
        lines += ['']
    body = '\n'.join(lines)
    with open(os.path.join(d, '01-排版全要素.txt'), 'w', encoding='utf-8') as f:
        f.write(body)
    # 纯 ASCII，验证英文长文与 Windows 换行
    en = ('Typography Test Document\n\n'
          + '\n\n'.join([P_EN] * 6)
          + '\n\nEnd of plain ASCII sample.\n')
    with open(os.path.join(d, '02-plain-ascii.txt'), 'w', encoding='utf-8') as f:
        f.write(en)
    return 2


# ---------- Markdown ----------
def gen_md(d):
    out = [f'# {TITLE}', '', f'> {SUBTITLE}  ' , f'> 作者：{AUTHOR}', '']
    for cname, subs in chapters():
        out += [f'## {cname}', '']
        for sname, blocks in subs:
            out += [f'### {sname}', '']
            for kind, payload in blocks:
                if kind == 'h3':
                    out += [f'#### {payload}', '']
                elif kind == 'h4':
                    out += [f'##### {payload}', '']
                elif kind == 'p':
                    out += [str(payload), '']
                elif kind == 'small':
                    out += [f'*{payload}*', '']
                elif kind == 'p_rich':
                    out += ['**粗体** · *斜体* · ***粗斜体*** · <u>下划线</u> · ~~删除线~~', '']
                elif kind == 'colors':
                    out += ['<span style="color:#e5484d">红色</span> · '
                            '<span style="color:#30a46c">绿色</span> · '
                            '<span style="color:#3b82f6">蓝色</span> · '
                            '<span style="color:#8b8b93">灰色</span>', '']
                elif kind == 'ol':
                    out += [f'{i}. {t}' for i, t in enumerate(payload, 1)] + ['']
                elif kind == 'ul':
                    out += [f'- {t}' for t in payload] + ['']
                elif kind == 'quote':
                    out += ['> ' + payload, '']
                elif kind == 'code':
                    out += ['```js', str(payload), '```', '']
                elif kind == 'table':
                    hdr = payload[0]
                    out += ['| ' + ' | '.join(hdr) + ' |',
                            '| ' + ' | '.join(['---'] * len(hdr)) + ' |']
                    out += ['| ' + ' | '.join(r) + ' |' for r in payload[1:]] + ['']
                elif kind == 'align_center':
                    out += [f'<p align="center">{payload}</p>', '']
                elif kind == 'align_right':
                    out += [f'<p align="right">{payload}</p>', '']
    with open(os.path.join(d, '01-排版全要素.md'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(out))
    return 1


# ---------- EPUB ----------
EPUB_CSS = '''@charset "utf-8";
body { font-family: serif; line-height: 1.85; margin: 0 5%; color: #1a1a1a; background: #ffffff; }
h1 { font-size: 1.9em; margin: 1.2em 0 0.8em; letter-spacing: 0.02em; }
h2 { font-size: 1.45em; margin: 1.4em 0 0.6em; }
h3 { font-size: 1.15em; margin: 1.1em 0 0.4em; }
h4 { font-size: 1em; margin: 1em 0 0.3em; color: #444; }
p { margin: 0 0 0.9em; text-align: justify; text-indent: 2em; }
p.noindent { text-indent: 0; }
small { font-size: 0.82em; color: #666; }
blockquote { margin: 1em 1.2em; padding: 0.6em 1em; border-left: 3px solid #b8b8bd; color: #444; background: #f7f7f8; }
pre { font-family: ui-monospace, Consolas, monospace; font-size: 0.88em; background: #f4f4f6; padding: 0.8em 1em; overflow-x: auto; border-radius: 6px; }
table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: 0.92em; }
th, td { border: 1px solid #c9c9cf; padding: 0.45em 0.7em; text-align: left; }
th { background: #efeff2; font-weight: 600; }
.c { text-align: center; text-indent: 0; }
.r { text-align: right; text-indent: 0; }
.c-red { color: #e5484d; } .c-green { color: #30a46c; } .c-blue { color: #3b82f6; } .c-gray { color: #8b8b93; }
.tag { font-family: monospace; background: #eee; padding: 0 0.3em; }
'''


def xhtml(title, inner):
    return f'''<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh-CN">
<head><meta charset="utf-8"/><title>{title}</title>
<link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
{inner}
</body></html>'''


def gen_epub(d):
    files = {}
    for ci, (cname, subs) in enumerate(chapters(), 1):
        parts = [f'<h1>{cname}</h1>']
        for sname, blocks in subs:
            parts.append(f'<h2>{sname}</h2>')
            for kind, payload in blocks:
                if kind == 'h3':
                    parts.append(f'<h3>{payload}</h3>')
                elif kind == 'h4':
                    parts.append(f'<h4>{payload}</h4>')
                elif kind == 'p':
                    parts.append(f'<p>{payload}</p>')
                elif kind == 'small':
                    parts.append(f'<p class="noindent"><small>{payload}</small></p>')
                elif kind == 'p_rich':
                    parts.append('<p class="noindent">普通 / <strong>粗体</strong> / <em>斜体</em> / '
                                 '<strong><em>粗斜体</em></strong> / <u>下划线</u> / <s>删除线</s></p>')
                elif kind == 'colors':
                    parts.append('<p class="noindent"><span class="c-red">红色</span> · '
                                 '<span class="c-green">绿色</span> · '
                                 '<span class="c-blue">蓝色</span> · '
                                 '<span class="c-gray">灰色</span></p>')
                elif kind == 'ol':
                    parts.append('<ol>' + ''.join(f'<li>{t}</li>' for t in payload) + '</ol>')
                elif kind == 'ul':
                    parts.append('<ul>' + ''.join(f'<li>{t}</li>' for t in payload) + '</ul>')
                elif kind == 'quote':
                    parts.append(f'<blockquote>{payload}</blockquote>')
                elif kind == 'code':
                    parts.append('<pre>' + str(payload).replace('\n', '\n') + '</pre>')
                elif kind == 'table':
                    rows = ''.join(
                        '<tr>' + ''.join(
                            f'<{"th" if i == 0 else "td"}>{c}</{"th" if i == 0 else "td"}>'
                            for c in r) + '</tr>'
                        for i, r in enumerate(payload))
                    parts.append(f'<table>{rows}</table>')
                elif kind == 'align_center':
                    parts.append(f'<p class="c">{payload}</p>')
                elif kind == 'align_right':
                    parts.append(f'<p class="r">{payload}</p>')
        files[f'ch{ci}.xhtml'] = xhtml(cname, '\n'.join(parts))

    nav_items = ''.join(
        f'<li><a href="ch{i}.xhtml">第一章</a></li>' if i == 1 else f'<li><a href="ch{i}.xhtml">第{i}章</a></li>'
        for i in range(1, len(chapters()) + 1))
    files['nav.xhtml'] = xhtml('目录', f'<nav epub:type="toc" id="toc"><h1>目录</h1><ol>{nav_items}</ol></nav>')

    manifest = ''.join(
        f'<item id="c{i}" href="ch{i}.xhtml" media-type="application/xhtml+xml"/>'
        for i in range(1, len(chapters()) + 1))
    spine = ''.join(f'<itemref idref="c{i}"/>' for i in range(1, len(chapters()) + 1))

    opf = f'''<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="uid">urn:uuid:moyu-fixture-0002</dc:identifier>
<dc:title>{TITLE}</dc:title><dc:creator>{AUTHOR}</dc:creator>
<dc:language>zh-CN</dc:language>
<meta property="dcterms:modified">2026-11-01T00:00:00Z</meta>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="css" href="style.css" media-type="text/css"/>
{manifest}
</manifest>
<spine>{spine}</spine>
</package>'''

    path = os.path.join(d, '01-排版全要素.epub')
    with zipfile.ZipFile(path, 'w') as z:
        z.writestr(zipfile.ZipInfo('mimetype'), 'application/epub+zip', compress_type=zipfile.ZIP_STORED)
        z.writestr('META-INF/container.xml',
                   '<?xml version="1.0"?>\n<container version="1.0" '
                   'xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n'
                   '<rootfiles><rootfile full-path="OEBPS/content.opf" '
                   'media-type="application/oebps-package+xml"/></rootfiles></container>',
                   compress_type=zipfile.ZIP_DEFLATED)
        z.writestr('OEBPS/content.opf', opf, compress_type=zipfile.ZIP_DEFLATED)
        z.writestr('OEBPS/style.css', EPUB_CSS, compress_type=zipfile.ZIP_DEFLATED)
        for name, content in files.items():
            z.writestr(f'OEBPS/{name}', content, compress_type=zipfile.ZIP_DEFLATED)
    return 1


# ---------- DOCX（手写 OOXML，精确控制粗斜体/颜色/字号/表格） ----------
def esc(t):
    return (t.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
             .replace('"', '&quot;'))


def run(text, bold=False, italic=False, uline=False, strike=False, color=None, size=None, font=None):
    rpr = []
    if font:
        rpr.append(f'<w:rFonts w:ascii="{font}" w:hAnsi="{font}" w:eastAsia="{font}"/>')
    if bold:
        rpr.append('<w:b/><w:bCs/>')
    if italic:
        rpr.append('<w:i/><w:iCs/>')
    if uline:
        rpr.append('<w:u w:val="single"/>')
    if strike:
        rpr.append('<w:strike/>')
    if color:
        rpr.append(f'<w:color w:val="{color}"/>')
    if size:
        rpr.append(f'<w:sz w:val="{int(size * 2)}"/><w:szCs w:val="{int(size * 2)}"/>')
    rpr_xml = f'<w:rPr>{"".join(rpr)}</w:rPr>' if rpr else ''
    return f'<w:r>{rpr_xml}<w:t xml:space="preserve">{esc(text)}</w:t></w:r>'


def para(runs_xml, style=None, align=None, indent=False, spacing_before=0, spacing_after=180):
    ppr = []
    if style:
        ppr.append(f'<w:pStyle w:val="{style}"/>')
    if align:
        ppr.append(f'<w:jc w:val="{align}"/>')
    if indent:
        ppr.append('<w:ind w:firstLineChars="200" w:firstLine="480"/>')
    ppr.append(f'<w:spacing w:before="{spacing_before}" w:after="{spacing_after}" w:line="360" w:lineRule="auto"/>')
    return f'<w:p><w:pPr>{"".join(ppr)}</w:pPr>{runs_xml}</w:p>'


def gen_docx(d):
    body = []
    body.append(para(run(TITLE, bold=True, size=24, color='1A1A1A'), style='Title', align='center'))
    body.append(para(run(SUBTITLE, size=11, color='666666'), align='center'))
    body.append(para(run(f'作者：{AUTHOR}', size=10, color='888888'), align='center'))

    for cname, subs in chapters():
        body.append(para(run(cname, bold=True, size=18), style='Heading1'))
        for sname, blocks in subs:
            body.append(para(run(sname, bold=True, size=14), style='Heading2'))
            for kind, payload in blocks:
                if kind == 'h3':
                    body.append(para(run(str(payload), bold=True, size=16)))
                elif kind == 'h4':
                    body.append(para(run(str(payload), bold=True, size=13, color='444444')))
                elif kind == 'p':
                    body.append(para(run(str(payload), size=12), indent=True))
                elif kind == 'small':
                    body.append(para(run(str(payload), size=9, color='666666')))
                elif kind == 'p_rich':
                    body.append(para(
                        run('普通 / ', size=12) + run('粗体', bold=True, size=12) + run(' / ', size=12) +
                        run('斜体', italic=True, size=12) + run(' / ', size=12) +
                        run('粗斜体', bold=True, italic=True, size=12) + run(' / ', size=12) +
                        run('下划线', uline=True, size=12) + run(' / ', size=12) +
                        run('删除线', strike=True, size=12)))
                elif kind == 'colors':
                    body.append(para(
                        run('红色', color='E5484D', size=12) + run(' · ', size=12) +
                        run('绿色', color='30A46C', size=12) + run(' · ', size=12) +
                        run('蓝色', color='3B82F6', size=12) + run(' · ', size=12) +
                        run('灰色', color='8B8B93', size=12)))
                elif kind == 'ol':
                    for i, t in enumerate(payload, 1):
                        body.append(para(run(f'{i}. {t}', size=12)))
                elif kind == 'ul':
                    for t in payload:
                        body.append(para(run(f'· {t}', size=12)))
                elif kind == 'quote':
                    body.append(para(run(str(payload), italic=True, size=11, color='444444'), indent=True))
                elif kind == 'code':
                    for ln in str(payload).split('\n'):
                        body.append(para(run(ln, size=10, font='Consolas'), spacing_after=0))
                    body.append(para(run('', size=10), spacing_after=120))
                elif kind == 'table':
                    rows = []
                    for ri, r in enumerate(payload):
                        cells = ''.join(
                            f'<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>'
                            f'{para(run(c, bold=(ri == 0), size=10), spacing_after=40)}</w:tc>'
                            for c in r)
                        rows.append(f'<w:tr>{cells}</w:tr>')
                    tbl = ('<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/>'
                           '<w:tblW w:w="0" w:type="auto"/><w:tblBorders>'
                           + ''.join(f'<w:{s} w:val="single" w:sz="4" w:color="C9C9CF"/>'
                                     for s in ('top', 'left', 'bottom', 'right', 'insideH', 'insideV'))
                           + '</w:tblBorders></w:tblPr>' + ''.join(rows) + '</w:tbl>')
                    body.append(tbl)
                    body.append(para(run('', size=8), spacing_after=60))
                elif kind == 'align_center':
                    body.append(para(run(str(payload), size=12), align='center'))
                elif kind == 'align_right':
                    body.append(para(run(str(payload), size=12), align='right'))

    document = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
{''.join(body)}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
</w:body></w:document>'''

    styles = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr>
<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="宋体"/>
<w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="180" w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault>
</w:docDefaults>
<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/>
<w:pPr><w:jc w:val="center"/><w:spacing w:before="240" w:after="240"/></w:pPr>
<w:rPr><w:b/><w:sz w:val="48"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/>
<w:pPr><w:outlineLvl w:val="0"/><w:spacing w:before="360" w:after="180"/></w:pPr>
<w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/>
<w:pPr><w:outlineLvl w:val="1"/><w:spacing w:before="240" w:after="120"/></w:pPr>
<w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>
</w:styles>'''

    content_types = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>'''

    rels = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>'''

    doc_rels = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>'''

    path = os.path.join(d, '01-排版全要素.docx')
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml', content_types)
        z.writestr('_rels/.rels', rels)
        z.writestr('word/document.xml', document)
        z.writestr('word/styles.xml', styles)
        z.writestr('word/_rels/document.xml.rels', doc_rels)
    return 1


# ---------- FB2 ----------
def gen_fb2(d):
    body = []
    for cname, subs in chapters():
        sec = [f'<title><p>{cname}</p></title>']
        for sname, blocks in subs:
            inner = [f'<subtitle>{sname}</subtitle>']
            for kind, payload in blocks:
                if kind in ('h3', 'h4'):
                    inner.append(f'<subtitle>{payload}</subtitle>')
                elif kind == 'p':
                    inner.append(f'<p>{payload}</p>')
                elif kind == 'small':
                    inner.append(f'<p><emphasis>{payload}</emphasis></p>')
                elif kind == 'p_rich':
                    inner.append('<p>普通 / <strong>粗体</strong> / <emphasis>斜体</emphasis> / '
                                 '<strong><emphasis>粗斜体</emphasis></strong></p>')
                elif kind == 'colors':
                    inner.append('<p>颜色：红色 绿色 蓝色 灰色（FB2 无颜色标记，仅验证文字）</p>')
                elif kind == 'ol':
                    inner += [f'<p>{i}. {t}</p>' for i, t in enumerate(payload, 1)]
                elif kind == 'ul':
                    inner += [f'<p>· {t}</p>' for t in payload]
                elif kind == 'quote':
                    inner.append(f'<cite>{payload}</cite>')
                elif kind == 'code':
                    inner.append(f'<code>{" ".join(str(payload).split())}</code>')
                elif kind == 'table':
                    inner.append('<p>' + ' ; '.join(' / '.join(r) for r in payload) + '</p>')
                elif kind in ('align_center', 'align_right'):
                    inner.append(f'<p>{payload}</p>')
            sec.append('<section>' + ''.join(inner) + '</section>')
        body.append('<section>' + ''.join(sec) + '</section>')

    xml = f'''<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0">
<description>
<title-info><genre>reference</genre><author><first-name>墨鱼</first-name></author>
<book-title>{TITLE}</book-title><lang>zh-CN</lang></title-info>
<document-info><author><nickname>{AUTHOR}</nickname></author><date value="2026-11-01"/></document-info>
</description>
<body>{''.join(body)}</body>
</FictionBook>'''
    with open(os.path.join(d, '01-排版全要素.fb2'), 'w', encoding='utf-8') as f:
        f.write(xml)
    return 1


# ---------- CBZ（纯 python 生成 PNG） ----------
def png(w, h, rgb, band=None):
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        row_rgb = rgb
        if band and band[0] <= y < band[1]:
            row_rgb = band[2]
        raw += bytes(row_rgb) * w
    def chunk(tag, data):
        return (struct.pack('>I', len(data)) + tag + data
                + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff))
    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(bytes(raw), 6))
            + chunk(b'IEND', b''))


def gen_cbz(d):
    pages = [
        ((238, 240, 245), (60, 60, 66)),
        ((255, 246, 232), (120, 90, 40)),
        ((232, 245, 238), (40, 100, 70)),
        ((243, 235, 246), (90, 60, 110)),
    ]
    path = os.path.join(d, '01-四页示例.cbz')
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
        for i, (bg, band) in enumerate(pages, 1):
            # 每页：浅底色 + 顶部色带（便于目检翻页是否正确、图像方向是否正确）
            z.writestr(f'page-{i:02d}.png', png(760, 1080, bg, (0, 140, band)))
    return 1


# ---------- PDF 源 HTML（由 Chromium 打印，可含中文与真实字体） ----------
def gen_pdf_html(d):
    css = '''@page { size: A4; margin: 18mm 16mm; }
body { font-family: "Songti SC", "SimSun", serif; color: #1a1a1a; line-height: 1.85; }
h1 { font-size: 26px; margin: 0 0 6px; }
h2 { font-size: 19px; margin: 26px 0 10px; }
h3 { font-size: 16px; margin: 16px 0 6px; }
h4 { font-size: 14px; margin: 12px 0 4px; color: #444; }
p { margin: 0 0 12px; text-align: justify; text-indent: 2em; }
p.noindent { text-indent: 0; }
small { font-size: 12px; color: #666; }
blockquote { margin: 12px 0; padding: 8px 14px; border-left: 3px solid #b8b8bd; background: #f7f7f8; color: #444; text-indent: 0; }
pre { font-family: Consolas, monospace; font-size: 12.5px; background: #f4f4f6; padding: 10px 14px; border-radius: 6px; }
table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 13px; }
th, td { border: 1px solid #c9c9cf; padding: 6px 10px; text-align: left; }
th { background: #efeff2; }
.c { text-align: center; text-indent: 0; } .r { text-align: right; text-indent: 0; }
.c-red { color: #e5484d; } .c-green { color: #30a46c; } .c-blue { color: #3b82f6; } .c-gray { color: #8b8b93; }
.cover { text-align: center; margin: 40px 0 30px; }
.cover .sub { color: #666; font-size: 14px; }
'''
    parts = [f'<div class="cover"><h1>{TITLE}</h1>'
             f'<div class="sub">{SUBTITLE}　|　{AUTHOR}</div></div>']
    for cname, subs in chapters():
        parts.append(f'<h1>{cname}</h1>')
        for sname, blocks in subs:
            parts.append(f'<h2>{sname}</h2>')
            for kind, payload in blocks:
                if kind == 'h3':
                    parts.append(f'<h3>{payload}</h3>')
                elif kind == 'h4':
                    parts.append(f'<h4>{payload}</h4>')
                elif kind == 'p':
                    parts.append(f'<p>{payload}</p>')
                elif kind == 'small':
                    parts.append(f'<p class="noindent"><small>{payload}</small></p>')
                elif kind == 'p_rich':
                    parts.append('<p class="noindent">普通 / <strong>粗体</strong> / <em>斜体</em> / '
                                 '<strong><em>粗斜体</em></strong> / <u>下划线</u> / <s>删除线</s></p>')
                elif kind == 'colors':
                    parts.append('<p class="noindent"><span class="c-red">红色</span> · '
                                 '<span class="c-green">绿色</span> · '
                                 '<span class="c-blue">蓝色</span> · '
                                 '<span class="c-gray">灰色</span></p>')
                elif kind == 'ol':
                    parts.append('<ol>' + ''.join(f'<li>{t}</li>' for t in payload) + '</ol>')
                elif kind == 'ul':
                    parts.append('<ul>' + ''.join(f'<li>{t}</li>' for t in payload) + '</ul>')
                elif kind == 'quote':
                    parts.append(f'<blockquote>{payload}</blockquote>')
                elif kind == 'code':
                    parts.append(f'<pre>{esc(str(payload))}</pre>')
                elif kind == 'table':
                    rows = ''.join(
                        '<tr>' + ''.join(
                            f'<{"th" if i == 0 else "td"}>{c}</{"th" if i == 0 else "td"}>' for c in r)
                        + '</tr>' for i, r in enumerate(payload))
                    parts.append(f'<table>{rows}</table>')
                elif kind == 'align_center':
                    parts.append(f'<p class="c">{payload}</p>')
                elif kind == 'align_right':
                    parts.append(f'<p class="r">{payload}</p>')

    html = f'''<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>{TITLE}</title>
<style>{css}</style></head><body>
{''.join(parts)}
</body></html>'''
    path = os.path.join(d, '_source.html')
    with open(path, 'w', encoding='utf-8') as f:
        f.write(html)
    return 1


def main():
    dirs = {k: os.path.join(OUT, k) for k in ('txt', 'md', 'epub', 'docx', 'pdf', 'fb2', 'cbz')}
    for p in dirs.values():
        os.makedirs(p, exist_ok=True)

    counts = {
        'txt': gen_txt(dirs['txt']),
        'md': gen_md(dirs['md']),
        'epub': gen_epub(dirs['epub']),
        'docx': gen_docx(dirs['docx']),
        'pdf(html)': gen_pdf_html(dirs['pdf']),
        'fb2': gen_fb2(dirs['fb2']),
        'cbz': gen_cbz(dirs['cbz']),
    }
    for k, v in counts.items():
        print(f'{k}: {v} file(s)')
    print('FIXTURES_DIR:', OUT)


if __name__ == '__main__':
    main()
