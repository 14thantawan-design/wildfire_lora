from __future__ import annotations

from datetime import date
from pathlib import Path

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.style import WD_STYLE_TYPE
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK, WD_LINE_SPACING
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.opc.constants import RELATIONSHIP_TYPE as RT
from docx.shared import Inches, Pt, RGBColor


ROOT = Path(r"C:\wildfire_lora")
OUTPUT = ROOT / "docs" / "แหล่งอ้างอิงหลักการคำนวณไฟป่า_ฝั่งโหนด.docx"

# compact_reference_guide preset, with a named Thai legibility override.
FONT = "Tahoma"
MONO = "Consolas"
NAVY = "0B2545"
BLUE = "2E74B5"
DARK_BLUE = "1F4D78"
MUTED = "5B6573"
LIGHT_BLUE = "E8EEF5"
LIGHT_GRAY = "F2F4F7"
CALLOUT = "F4F6F9"
GOLD = "7A5A00"
GOLD_FILL = "FFF8E1"
RED = "9B1C1C"
RED_FILL = "FDECEC"
WHITE = "FFFFFF"
TABLE_WIDTH_DXA = 9360
TABLE_INDENT_DXA = 120


def rgb(hex_color: str) -> RGBColor:
    return RGBColor.from_string(hex_color)


def ensure_rpr(run):
    rpr = run._element.get_or_add_rPr()
    fonts = rpr.rFonts
    if fonts is None:
        fonts = OxmlElement("w:rFonts")
        rpr.insert(0, fonts)
    return rpr, fonts


def set_run_font(run, *, name=FONT, size=None, color=None, bold=None, italic=None):
    run.font.name = name
    rpr, fonts = ensure_rpr(run)
    for key in ("ascii", "hAnsi", "eastAsia", "cs"):
        fonts.set(qn(f"w:{key}"), name)
    if size is not None:
        run.font.size = Pt(size)
    if color is not None:
        run.font.color.rgb = rgb(color)
    if bold is not None:
        run.bold = bold
    if italic is not None:
        run.italic = italic


def set_style_font(style, *, name=FONT, size=11, color="000000", bold=None, italic=None):
    style.font.name = name
    style.font.size = Pt(size)
    style.font.color.rgb = rgb(color)
    if bold is not None:
        style.font.bold = bold
    if italic is not None:
        style.font.italic = italic
    rpr = style.element.get_or_add_rPr()
    fonts = rpr.rFonts
    if fonts is None:
        fonts = OxmlElement("w:rFonts")
        rpr.insert(0, fonts)
    for key in ("ascii", "hAnsi", "eastAsia", "cs"):
        fonts.set(qn(f"w:{key}"), name)


def shade(element, fill: str):
    props = element.get_or_add_tcPr() if element.tag.endswith("tc") else element.get_or_add_pPr()
    shd = props.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        props.append(shd)
    shd.set(qn("w:fill"), fill)


def set_paragraph_border_left(paragraph, color: str, size: int = 18, space: int = 8):
    ppr = paragraph._p.get_or_add_pPr()
    pbdr = ppr.find(qn("w:pBdr"))
    if pbdr is None:
        pbdr = OxmlElement("w:pBdr")
        ppr.append(pbdr)
    left = OxmlElement("w:left")
    left.set(qn("w:val"), "single")
    left.set(qn("w:sz"), str(size))
    left.set(qn("w:space"), str(space))
    left.set(qn("w:color"), color)
    pbdr.append(left)


def add_hyperlink(paragraph, text: str, url: str, *, color=BLUE, underline=True):
    rid = paragraph.part.relate_to(url, RT.HYPERLINK, is_external=True)
    hyperlink = OxmlElement("w:hyperlink")
    hyperlink.set(qn("r:id"), rid)
    run = OxmlElement("w:r")
    rpr = OxmlElement("w:rPr")
    fonts = OxmlElement("w:rFonts")
    for key in ("ascii", "hAnsi", "eastAsia", "cs"):
        fonts.set(qn(f"w:{key}"), FONT)
    rpr.append(fonts)
    c = OxmlElement("w:color")
    c.set(qn("w:val"), color)
    rpr.append(c)
    if underline:
        u = OxmlElement("w:u")
        u.set(qn("w:val"), "single")
        rpr.append(u)
    run.append(rpr)
    t = OxmlElement("w:t")
    t.text = text
    run.append(t)
    hyperlink.append(run)
    paragraph._p.append(hyperlink)
    return hyperlink


def set_cell_margins(cell, top=80, start=120, bottom=80, end=120):
    tcpr = cell._tc.get_or_add_tcPr()
    tcmar = tcpr.first_child_found_in("w:tcMar")
    if tcmar is None:
        tcmar = OxmlElement("w:tcMar")
        tcpr.append(tcmar)
    for side, value in (("top", top), ("start", start), ("bottom", bottom), ("end", end)):
        node = tcmar.find(qn(f"w:{side}"))
        if node is None:
            node = OxmlElement(f"w:{side}")
            tcmar.append(node)
        node.set(qn("w:w"), str(value))
        node.set(qn("w:type"), "dxa")


def set_cell_width(cell, width_dxa: int):
    tcpr = cell._tc.get_or_add_tcPr()
    tcw = tcpr.find(qn("w:tcW"))
    if tcw is None:
        tcw = OxmlElement("w:tcW")
        tcpr.append(tcw)
    tcw.set(qn("w:w"), str(width_dxa))
    tcw.set(qn("w:type"), "dxa")


def set_table_geometry(table, widths_dxa: list[int], indent_dxa=TABLE_INDENT_DXA):
    assert sum(widths_dxa) == TABLE_WIDTH_DXA
    table.alignment = WD_TABLE_ALIGNMENT.LEFT
    table.autofit = False
    tblpr = table._tbl.tblPr
    tblw = tblpr.find(qn("w:tblW"))
    if tblw is None:
        tblw = OxmlElement("w:tblW")
        tblpr.append(tblw)
    tblw.set(qn("w:w"), str(TABLE_WIDTH_DXA))
    tblw.set(qn("w:type"), "dxa")
    tblind = tblpr.find(qn("w:tblInd"))
    if tblind is None:
        tblind = OxmlElement("w:tblInd")
        tblpr.append(tblind)
    tblind.set(qn("w:w"), str(indent_dxa))
    tblind.set(qn("w:type"), "dxa")
    layout = tblpr.find(qn("w:tblLayout"))
    if layout is None:
        layout = OxmlElement("w:tblLayout")
        tblpr.append(layout)
    layout.set(qn("w:type"), "fixed")

    grid = table._tbl.tblGrid
    for child in list(grid):
        grid.remove(child)
    for width in widths_dxa:
        col = OxmlElement("w:gridCol")
        col.set(qn("w:w"), str(width))
        grid.append(col)

    for row in table.rows:
        for idx, cell in enumerate(row.cells):
            set_cell_width(cell, widths_dxa[idx])
            set_cell_margins(cell)
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER


def set_repeat_table_header(row):
    trpr = row._tr.get_or_add_trPr()
    header = OxmlElement("w:tblHeader")
    header.set(qn("w:val"), "true")
    trpr.append(header)


def set_table_borders(table, color="CAD2DC", size=4):
    tblpr = table._tbl.tblPr
    borders = tblpr.find(qn("w:tblBorders"))
    if borders is None:
        borders = OxmlElement("w:tblBorders")
        tblpr.append(borders)
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        node = OxmlElement(f"w:{edge}")
        node.set(qn("w:val"), "single")
        node.set(qn("w:sz"), str(size))
        node.set(qn("w:space"), "0")
        node.set(qn("w:color"), color)
        borders.append(node)


def format_cell(cell, *, bold=False, color="000000", size=9.4, align=WD_ALIGN_PARAGRAPH.LEFT):
    for paragraph in cell.paragraphs:
        paragraph.alignment = align
        paragraph.paragraph_format.space_before = Pt(0)
        paragraph.paragraph_format.space_after = Pt(1)
        paragraph.paragraph_format.line_spacing = 1.12
        for run in paragraph.runs:
            set_run_font(run, size=size, color=color, bold=bold)


def add_table(doc, headers: list[str], rows: list[list[str]], widths_dxa: list[int]):
    table = doc.add_table(rows=1, cols=len(headers))
    table.style = "Table Grid"
    for i, text in enumerate(headers):
        cell = table.rows[0].cells[i]
        cell.text = text
        shade(cell._tc, LIGHT_BLUE)
        format_cell(cell, bold=True, color=NAVY, size=9.5, align=WD_ALIGN_PARAGRAPH.CENTER)
    set_repeat_table_header(table.rows[0])
    for row_data in rows:
        row = table.add_row()
        for i, text in enumerate(row_data):
            row.cells[i].text = text
            format_cell(row.cells[i])
    set_table_geometry(table, widths_dxa)
    set_table_borders(table)
    after = doc.add_paragraph()
    after.paragraph_format.space_after = Pt(2)
    return table


def add_body(doc, text="", *, bold_prefix=None, keep=False):
    p = doc.add_paragraph(style="Normal")
    if bold_prefix and text.startswith(bold_prefix):
        first = p.add_run(bold_prefix)
        set_run_font(first, bold=True, color=NAVY)
        rest = p.add_run(text[len(bold_prefix):])
        set_run_font(rest)
    else:
        r = p.add_run(text)
        set_run_font(r)
    if keep:
        p.paragraph_format.keep_with_next = True
    return p


def add_label(doc, label: str, text: str):
    p = doc.add_paragraph(style="Normal")
    r = p.add_run(label + " ")
    set_run_font(r, bold=True, color=NAVY)
    r = p.add_run(text)
    set_run_font(r)
    return p


def add_source(doc, label: str, title: str, url: str, tail=""):
    p = doc.add_paragraph(style="Source")
    r = p.add_run(label + " ")
    set_run_font(r, size=9.8, bold=True, color=DARK_BLUE)
    add_hyperlink(p, title, url)
    if tail:
        r = p.add_run(tail)
        set_run_font(r, size=9.8, color=MUTED)
    return p


def add_equation(doc, equation: str, explanation: str | None = None):
    p = doc.add_paragraph(style="Equation")
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.keep_together = True
    r = p.add_run(equation)
    set_run_font(r, name="Cambria Math", size=11.5, color=NAVY, bold=True)
    if explanation:
        r = p.add_run("\n" + explanation)
        set_run_font(r, size=9.3, color=MUTED, italic=True)
    shade(p._p, LIGHT_BLUE)
    return p


def add_code(doc, text: str):
    p = doc.add_paragraph(style="Code Block")
    p.paragraph_format.keep_together = True
    r = p.add_run(text)
    set_run_font(r, name=MONO, size=9.2, color=NAVY)
    shade(p._p, LIGHT_GRAY)
    return p


def add_callout(doc, label: str, text: str, kind="info"):
    fill, color = {
        "info": (CALLOUT, DARK_BLUE),
        "caution": (GOLD_FILL, GOLD),
        "risk": (RED_FILL, RED),
    }[kind]
    p = doc.add_paragraph(style="Callout")
    p.paragraph_format.keep_together = True
    r = p.add_run(label + " ")
    set_run_font(r, bold=True, color=color)
    r = p.add_run(text)
    set_run_font(r, color="222222")
    shade(p._p, fill)
    set_paragraph_border_left(p, color)
    return p


def add_bullet(doc, text: str):
    p = doc.add_paragraph(style="List Bullet")
    r = p.add_run(text)
    set_run_font(r)
    return p


def add_number(doc, text: str):
    p = doc.add_paragraph(style="List Number")
    r = p.add_run(text)
    set_run_font(r)
    return p


def add_heading(doc, text: str, level: int):
    p = doc.add_paragraph(text, style=f"Heading {level}")
    p.paragraph_format.keep_with_next = True
    for run in p.runs:
        set_run_font(run, bold=True)
    return p


def add_page_field(paragraph):
    run = paragraph.add_run()
    fld_begin = OxmlElement("w:fldChar")
    fld_begin.set(qn("w:fldCharType"), "begin")
    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = " PAGE "
    fld_sep = OxmlElement("w:fldChar")
    fld_sep.set(qn("w:fldCharType"), "separate")
    text = OxmlElement("w:t")
    text.text = "1"
    fld_end = OxmlElement("w:fldChar")
    fld_end.set(qn("w:fldCharType"), "end")
    run._r.extend([fld_begin, instr, fld_sep, text, fld_end])
    set_run_font(run, size=9, color=MUTED)


def configure_styles(doc: Document):
    styles = doc.styles
    normal = styles["Normal"]
    set_style_font(normal, name=FONT, size=11)
    normal.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.LEFT
    normal.paragraph_format.space_before = Pt(0)
    normal.paragraph_format.space_after = Pt(6)
    normal.paragraph_format.line_spacing = 1.25

    title = styles["Title"]
    set_style_font(title, name=FONT, size=28, color=NAVY, bold=True)
    title.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.CENTER
    title.paragraph_format.space_before = Pt(0)
    title.paragraph_format.space_after = Pt(12)

    subtitle = styles["Subtitle"]
    set_style_font(subtitle, name=FONT, size=14, color=DARK_BLUE)
    subtitle.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.CENTER
    subtitle.paragraph_format.space_before = Pt(0)
    subtitle.paragraph_format.space_after = Pt(10)

    for level, size, color, before, after in (
        (1, 16, BLUE, 18, 10),
        (2, 13, BLUE, 14, 7),
        (3, 12, DARK_BLUE, 10, 5),
    ):
        style = styles[f"Heading {level}"]
        set_style_font(style, name=FONT, size=size, color=color, bold=True)
        style.paragraph_format.space_before = Pt(before)
        style.paragraph_format.space_after = Pt(after)
        style.paragraph_format.line_spacing = 1.05
        style.paragraph_format.keep_with_next = True

    for name in ("List Bullet", "List Number"):
        style = styles[name]
        set_style_font(style, name=FONT, size=11)
        style.paragraph_format.left_indent = Inches(0.375)
        style.paragraph_format.first_line_indent = Inches(-0.188)
        style.paragraph_format.space_after = Pt(4)
        style.paragraph_format.line_spacing = 1.25

    source = styles.add_style("Source", WD_STYLE_TYPE.PARAGRAPH)
    set_style_font(source, name=FONT, size=9.8, color=MUTED)
    source.paragraph_format.left_indent = Inches(0.18)
    source.paragraph_format.space_before = Pt(2)
    source.paragraph_format.space_after = Pt(5)
    source.paragraph_format.line_spacing = 1.15

    equation = styles.add_style("Equation", WD_STYLE_TYPE.PARAGRAPH)
    set_style_font(equation, name="Cambria Math", size=11.5, color=NAVY)
    equation.paragraph_format.left_indent = Inches(0.18)
    equation.paragraph_format.right_indent = Inches(0.18)
    equation.paragraph_format.space_before = Pt(5)
    equation.paragraph_format.space_after = Pt(7)
    equation.paragraph_format.line_spacing = 1.15

    code = styles.add_style("Code Block", WD_STYLE_TYPE.PARAGRAPH)
    set_style_font(code, name=MONO, size=9.2, color=NAVY)
    code.paragraph_format.left_indent = Inches(0.18)
    code.paragraph_format.right_indent = Inches(0.18)
    code.paragraph_format.space_before = Pt(4)
    code.paragraph_format.space_after = Pt(7)
    code.paragraph_format.line_spacing = 1.05

    callout = styles.add_style("Callout", WD_STYLE_TYPE.PARAGRAPH)
    set_style_font(callout, name=FONT, size=10.5)
    callout.paragraph_format.left_indent = Inches(0.18)
    callout.paragraph_format.right_indent = Inches(0.18)
    callout.paragraph_format.space_before = Pt(6)
    callout.paragraph_format.space_after = Pt(8)
    callout.paragraph_format.line_spacing = 1.18

    caption = styles["Caption"]
    set_style_font(caption, name=FONT, size=9.5, color=MUTED, italic=True)
    caption.paragraph_format.space_before = Pt(4)
    caption.paragraph_format.space_after = Pt(4)


def configure_page(doc: Document):
    section = doc.sections[0]
    section.page_width = Inches(8.5)
    section.page_height = Inches(11)
    section.top_margin = Inches(1)
    section.bottom_margin = Inches(1)
    section.left_margin = Inches(1)
    section.right_margin = Inches(1)
    section.header_distance = Inches(0.492)
    section.footer_distance = Inches(0.492)

    hp = section.header.paragraphs[0]
    hp.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    hp.paragraph_format.space_after = Pt(0)
    r = hp.add_run("WILDFIRE LORA  |  หลักการคำนวณฝั่งโหนด")
    set_run_font(r, size=8.5, color=MUTED, bold=True)

    fp = section.footer.paragraphs[0]
    fp.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    fp.paragraph_format.space_before = Pt(0)
    r = fp.add_run("หน้า ")
    set_run_font(r, size=9, color=MUTED)
    add_page_field(fp)


def build_document():
    doc = Document()
    configure_styles(doc)
    configure_page(doc)
    doc.core_properties.title = "แหล่งอ้างอิงหลักการคำนวณไฟป่า - ฝั่งโหนด"
    doc.core_properties.subject = "ที่มาของสูตร วิธีคำนวณ ข้อจำกัด และแหล่งอ้างอิงสำหรับ sensor node"
    doc.core_properties.author = "Wildfire LoRa Project"
    doc.core_properties.keywords = "wildfire, sensor node, baseline, EMA, sensor fusion, SHT31, GP2Y1014AU0F"

    # Editorial cover.
    spacer = doc.add_paragraph()
    spacer.paragraph_format.space_after = Pt(54)
    kicker = doc.add_paragraph()
    kicker.alignment = WD_ALIGN_PARAGRAPH.CENTER
    kicker.paragraph_format.space_after = Pt(16)
    r = kicker.add_run("เอกสารอ้างอิงทางเทคนิค")
    set_run_font(r, size=11, color=GOLD, bold=True)

    p = doc.add_paragraph("แหล่งที่มาของหลักการคำนวณ\nระบบตรวจจับไฟป่า", style="Title")
    p.paragraph_format.keep_with_next = True
    p = doc.add_paragraph("เฉพาะการประมวลผลฝั่ง Sensor Node", style="Subtitle")

    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(18)
    p.paragraph_format.space_after = Pt(6)
    r = p.add_run("อ้างอิงโค้ด: main @ bcf9e5f")
    set_run_font(r, size=10.5, color=MUTED, bold=True)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_after = Pt(42)
    r = p.add_run("ตรวจทานวันที่ 3 กันยายน 2026")
    set_run_font(r, size=10, color=MUTED)

    add_callout(
        doc,
        "ขอบเขต:",
        "อธิบายเฉพาะการอ่านและกรองค่าเซนเซอร์ การสร้าง Baseline การหาความเปลี่ยนแปลง การรวมหลักฐาน การให้คะแนน การตัดสินสถานะ และการปรับ Baseline หลังตัดสิน ไม่ครอบคลุม Gateway, Backend, Dashboard, GPS และการส่ง LoRa",
        "info",
    )
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(18)
    r = p.add_run("จัดทำเพื่อใช้เป็นหลักฐานประกอบคำอธิบายสูตรและเป็นรายการแหล่งตรวจสอบย้อนหลัง")
    set_run_font(r, size=9.5, color=MUTED, italic=True)
    doc.add_page_break()

    add_heading(doc, "สรุปคำตอบก่อนอ่านรายละเอียด", 1)
    add_callout(
        doc,
        "ข้อสรุปหลัก:",
        "ระบบไม่ได้ยกสูตรสำเร็จรูปมาจากงานวิจัยชิ้นเดียว แต่ประกอบจาก (1) วิธีอ่านค่าตาม Datasheet ผู้ผลิต (2) หลักการทางสถิติและงานวิจัยเรื่องการตรวจจับการเปลี่ยนแปลง (3) แนวคิด Multi-sensor fusion และ (4) เกณฑ์เชิงวิศวกรรมที่โครงการตั้งขึ้นเอง",
        "info",
    )
    add_body(doc, "การอ้างอิงจึงต้องแยกเป็นสามระดับ เพื่อไม่ทำให้ผู้อ่านเข้าใจผิดว่างานวิจัยรับรองตัวเลขทุกตัวในโค้ด")
    add_table(
        doc,
        ["ระดับ", "ความหมาย", "วิธีเขียนอ้างอิงในรายงาน"],
        [
            ["A - ตรงตามต้นฉบับ", "สูตรหรือ Timing ระบุโดยผู้ผลิตโดยตรง", "ระบุว่าใช้ตาม Datasheet/เอกสารผู้ผลิต"],
            ["B - ประยุกต์หลักการ", "งานวิจัยรองรับแนวคิด แต่โค้ดใช้วิธีที่ง่ายกว่าหรือดัดแปลง", "ใช้คำว่า ประยุกต์จากแนวคิด หรือ สอดคล้องกับ"],
            ["C - โครงการกำหนด", "ค่าตัวเลข น้ำหนัก หรือจำนวนรอบถูกตั้งเป็นค่าเริ่มต้นของต้นแบบ", "ระบุว่าต้องคาลิเบรตและยืนยันด้วยข้อมูลภาคสนาม"],
        ],
        [1500, 3600, 4260],
    )
    add_callout(
        doc,
        "ห้ามอ้างเกินจริง:",
        "คะแนน confidence ในโค้ดไม่ใช่ความน่าจะเป็น 0-100% และ GP2Y1014AU0F ไม่ใช่อุปกรณ์แจ้งเหตุเพลิงไหม้ที่ผ่านการรับรอง",
        "risk",
    )

    add_heading(doc, "ภาพรวมลำดับการคำนวณตามโค้ด", 1)
    add_label(doc, "ตำแหน่งหลัก:", "sensor_node_2/sensor_node_2.ino ฟังก์ชัน runOneMeasurementCycle() บรรทัด 1434-1481")
    for step in (
        "อ่าน SHT31 และ Sharp GP2Y1014AU0F",
        "ตรวจความสมเหตุสมผลของข้อมูล และอ่าน Sharp 3 ครั้งเพื่อเลือกค่ามัธยฐาน",
        "ถ้า Baseline ยังไม่พร้อม ให้สะสมค่าปกติเพื่อสร้าง Baseline",
        "คำนวณผลต่างจากรอบก่อน อัตราการเปลี่ยนแปลงต่อนาที และผลต่างจาก Baseline",
        "สร้างหลักฐานสามกลุ่ม: ควัน/อนุภาค ความร้อน และความชื้นลด",
        "รวมหลักฐานเป็นคะแนน 0-100",
        "ตัดสินสถานะดิบ NORMAL/WATCH/WARNING/CRITICAL หรือสถานะระบบ",
        "ยืนยันสถานะตามเวลาและค้างสถานะด้วย Debounce/Hysteresis",
        "หลังตัดสินแล้วจึงค่อยปรับ Baseline เมื่อสถานการณ์ปลอดภัย",
        "เลือกช่วงเวลาตื่นครั้งถัดไปตามสถานะ ซึ่งมีผลต่อการหารอัตราต่อนาทีในรอบถัดไป",
    ):
        add_number(doc, step)
    add_callout(
        doc,
        "จุดสำคัญของลำดับ:",
        "คะแนนและสถานะของรอบปัจจุบันถูกคำนวณจาก Baseline เดิมก่อน จากนั้นจึงปรับ Baseline หลังการตัดสิน เพื่อไม่ให้ค่าผิดปกติถูกดูดเข้า Baseline ก่อนประเมิน",
        "caution",
    )

    add_heading(doc, "แผนที่ย่อ: แต่ละส่วนอ้างอิงจากอะไร", 1)
    add_table(
        doc,
        ["ส่วนคำนวณ", "ฐานอ้างอิง", "สถานะ"],
        [
            ["แปลงค่า SHT31", "Sensirion Datasheet และไลบรารี Adafruit", "A"],
            ["Timing ของ Sharp", "Sharp GP2Y1014AU0F Specification", "A"],
            ["ADC 0-4095", "Espressif ADC Documentation", "A"],
            ["Median 3 ค่า", "หลัก Running Median; ขนาดหน้าต่างเลือกโดยโครงการ", "B/C"],
            ["Baseline ค่าเฉลี่ยเริ่มต้น", "ค่าเฉลี่ยเลขคณิต + แนวคิด Reference/Change detection", "B/C"],
            ["Delta และ Rate", "Finite difference + งานวิจัยการตรวจแนวโน้มสัญญาณไฟ", "B/C"],
            ["EMA ปรับ Baseline", "Roberts (1959); ค่า alpha เลือกโดยโครงการ", "B/C"],
            ["รวมสามเซนเซอร์", "งานวิจัย Multi-sensor information fusion", "B"],
            ["น้ำหนักคะแนนและเกณฑ์สถานะ", "กฎของโครงการ ยังไม่มีชุดข้อมูลคาลิเบรต", "C"],
            ["Fog penalty", "งานวิจัยผลของ RH ต่อ Optical PM; วิธีหักคะแนนเป็นของโครงการ", "B/C"],
            ["ยืนยันหลายรอบ/ค้างสถานะ", "แนวคิด Temporal validation; จำนวนรอบเป็นของโครงการ", "B/C"],
            ["ปรับช่วงตื่น", "งานวิจัย Adaptive duty cycle; ช่วงเวลาเป็นของโครงการ", "B/C"],
        ],
        [2200, 5360, 1800],
    )

    add_heading(doc, "การอ่านและแปลงค่าอุณหภูมิ/ความชื้น SHT31", 1)
    add_label(doc, "ตำแหน่งในโค้ด:", "sensor_node_2/sensor_node_2.ino บรรทัด 206-220 และ 292-305")
    add_label(doc, "สิ่งที่โค้ดทำ:", "เรียก sht31.readTemperature() และ sht31.readHumidity() จาก Adafruit SHT31 Library")
    add_body(doc, "SHT31 ส่งค่าดิบชนิด unsigned 16-bit ผ่าน I2C ข้อมูลจากเซนเซอร์ถูกปรับเชิงเส้นและชดเชยอุณหภูมิ/แรงดันจากโรงงานแล้ว จากนั้นจึงแปลงเป็นหน่วยกายภาพตามสูตรผู้ผลิต")
    add_equation(doc, "T [degC] = -45 + 175 * S_T / (2^16 - 1)", "S_T คือค่าดิบอุณหภูมิ 16 บิต และ 2^16 - 1 = 65535")
    add_equation(doc, "RH [%] = 100 * S_RH / (2^16 - 1)", "S_RH คือค่าดิบความชื้นสัมพัทธ์ 16 บิต")
    add_label(doc, "ตัวอย่าง:", "ถ้า S_T = 26214 จะได้ T = -45 + 175(26214/65535) = 25.00 degC โดยประมาณ")
    add_label(doc, "นำไปใช้อะไรต่อ:", "ค่า T และ RH ถูกตรวจช่วงสมเหตุสมผล ก่อนส่งไปสร้าง Baseline, Delta, Evidence และคะแนน")
    add_source(doc, "[R1]", "Sensirion - Datasheet SHT3x-DIS", "https://admin.sensirion.com/media/documents/213E6A3B/63A5A569/Datasheet_SHT3x_DIS.pdf", " (หัวข้อ Conversion of Signal Output)")
    add_source(doc, "[R2]", "Adafruit SHT31 Arduino Library", "https://github.com/adafruit/Adafruit_SHT31", " (ซอฟต์แวร์ที่โค้ดเรียกใช้)")
    add_callout(doc, "สถานะการอ้างอิง: A", "สูตรแปลงหน่วยมาจากผู้ผลิตโดยตรง แต่ช่วงตรวจสอบ -20 ถึง 85 degC ใน config.h เป็นช่วงที่โครงการกำหนดให้แคบลงเอง", "info")

    add_heading(doc, "การอ่าน Sharp GP2Y1014AU0F และค่า ADC", 1)
    add_label(doc, "ตำแหน่งในโค้ด:", "sensor_node_2/sensor_node_2.ino บรรทัด 185-203 และ 307-309")
    add_body(doc, "Sharp เป็นเซนเซอร์อนุภาคแบบ Optical scattering มี LED อินฟราเรดและ Photodiode ภายใน ค่าที่ออกมาเป็นแรงดันอนาล็อกซึ่งเปลี่ยนตามอนุภาคที่กระเจิงแสง")
    add_code(doc, "LED ON -> wait 280 us -> analogRead() -> wait 40 us -> LED OFF -> wait 9680 us")
    add_body(doc, "ผลรวม 280 + 40 + 9680 = 10000 us หรือ 10 ms สอดคล้องกับรอบ Pulse ที่ Sharp แนะนำ ส่วนจุดอ่านที่ประมาณ 0.28 ms และความกว้าง Pulse ประมาณ 0.32 ms มาจากเอกสารของ Sharp")
    add_equation(doc, "ADC_raw is an integer from 0 to 4095", "ESP32 ใช้ ADC 12 บิตตามค่าเริ่มต้น; analogRead() คืนค่าดิบที่ยังไม่คาลิเบรต")
    add_body(doc, "โค้ดปัจจุบันไม่แปลงค่า ADC_raw เป็นแรงดันหรือ ug/m3 เพราะยังไม่มีการคาลิเบรต ADC, ค่าแรงดันศูนย์ของเซนเซอร์แต่ละตัว และอัตราส่วนวงจรจริง ดังนั้นตัวแปร smokeRaw คือดัชนีดิบของบอร์ด ไม่ใช่ความเข้มข้นควันที่สอบกลับมาตรฐานได้")
    add_source(doc, "[R3]", "Sharp GP2Y1014AU0F - Product Specification ED-15G001A", "https://cdn-shop.adafruit.com/product-files/4649/SHARP_GP2Y1014AU0F.pdf", " (หัวข้อ 3-3 และ 3-4)")
    add_source(doc, "[R4]", "Sharp - Dust Sensor / PM Sensor Unit lineup", "https://global.sharp/products/device/lineup/selection/opto/dust/index.html", " (ชนิดเอาต์พุต ช่วงตรวจจับ และความไว)")
    add_source(doc, "[R5]", "Espressif - Arduino ESP32 ADC documentation", "https://docs.espressif.com/projects/arduino-esp32/en/latest/api/adc.html", " (12-bit raw range และ analogReadMilliVolts)")
    add_callout(doc, "ข้อจำกัดด้านความปลอดภัย:", "เอกสาร Sharp ข้อ 7-8 ระบุไม่ให้ใช้ GP2Y1014AU0F สำหรับงาน Fire alarm โดยตรง ระบบนี้จึงเป็นต้นแบบเฝ้าระวังความผิดปกติ ไม่ใช่เครื่องแจ้งเหตุเพลิงไหม้ที่ผ่านมาตรฐาน", "risk")

    add_heading(doc, "การกรองค่ากระโดดด้วย Median of Three", 1)
    add_label(doc, "ตำแหน่งในโค้ด:", "sensor_node_2/sensor_node_2.ino ฟังก์ชัน median3() และ readSmokeMedian() บรรทัด 179-203")
    add_equation(doc, "smokeRaw = median(sample_1, sample_2, sample_3)")
    add_label(doc, "ตัวอย่าง:", "ค่า 110, 112 และ 2500 ให้ค่ามัธยฐานเท่ากับ 112 จึงตัด Spike หนึ่งค่าที่ผิดจากกลุ่มออกได้")
    add_body(doc, "หลัก Running median เป็นวิธีกรองแบบไม่เชิงเส้นที่ทนต่อ Outlier ได้ดีกว่าการเฉลี่ยในกรณีที่มีค่ากระโดดหนึ่งตัว การเลือกหน้าต่างขนาด 3 ทำให้ใช้หน่วยความจำน้อยและตอบสนองเร็ว เหมาะกับไมโครคอนโทรลเลอร์")
    add_label(doc, "นำไปใช้อะไรต่อ:", "ค่ามัธยฐานถูกใช้เป็น smokeRaw เพียงค่าเดียวสำหรับ Baseline, Delta และ Evidence ของรอบนั้น")
    add_source(doc, "[R6]", "R Project documentation - Tukey's Running Median Smoothing", "https://search.r-project.org/R/refmans/stats/html/smooth.html", " (อธิบาย running median ความยาว 3)")
    add_callout(doc, "สถานะการอ้างอิง: B/C", "หลัก Median filter เป็นวิธีมาตรฐาน แต่จำนวน 3 ตัวอย่าง เวลาห่าง 5 ms และการใช้เฉพาะกับ Sharp เป็นการออกแบบของโครงการ", "caution")

    add_heading(doc, "การตรวจสุขภาพและความสมเหตุสมผลของข้อมูล", 1)
    add_label(doc, "ตำแหน่งในโค้ด:", "sensor_node_2/sensor_node_2.ino บรรทัด 206-210, 301-317 และ sensor_node_2/config.h บรรทัด 138-143")
    add_table(
        doc,
        ["ตัวแปร", "เงื่อนไขปัจจุบัน", "ที่มา"],
        [
            ["Temperature", "ไม่เป็น NaN และ -20 <= T <= 85 degC", "ช่วงใช้งานที่โครงการเลือกเอง ภายในขอบเขตเซนเซอร์"],
            ["Humidity", "ไม่เป็น NaN และ 0 <= RH <= 100%", "ขอบเขตนิยาม RH และขอบเขตข้อมูลเซนเซอร์"],
            ["Sharp raw", "0 <= raw <= 4095", "ขอบเขต ADC 12 บิตของ ESP32"],
        ],
        [1900, 2860, 4600],
    )
    add_body(doc, "หาก SHT31 อ่านไม่สมเหตุสมผล โค้ดจะเริ่มต้นเซนเซอร์ใหม่และลองอ่านอีกครั้ง หากยังผิดจะเป็น Sensor fault ส่วน Sharp health check ปัจจุบันตรวจเพียงว่าค่าอยู่ในช่วง ADC จึงยังตรวจสายหลุด LED เสีย หรือค่า Stuck ได้ไม่เข้มแข็ง")
    add_callout(doc, "สถานะการอ้างอิง: A/C", "ขอบเขต ADC มาจาก Espressif แต่เกณฑ์สุขภาพที่เลือกใช้และการลองอ่านซ้ำเป็นกฎของโครงการ", "caution")

    add_heading(doc, "การสร้าง Baseline เริ่มต้น", 1)
    add_label(doc, "ตำแหน่งในโค้ด:", "sensor_node_2/sensor_node_2.ino ฟังก์ชัน updateBaselineWarmup() บรรทัด 428-450; sensor_node_2/config.h บรรทัด 115-126")
    add_body(doc, "เมื่อเปิดเครื่องแบบไม่มี Baseline ที่บันทึกไว้ โหนดจะสะสมเฉพาะรอบที่เซนเซอร์ปกติและไม่เข้าเงื่อนไข Boot abnormal จากนั้นหาค่าเฉลี่ยเลขคณิตแยกสำหรับอุณหภูมิ ความชื้น และ Sharp raw")
    add_equation(doc, "B_T = (T_1 + T_2 + ... + T_N) / N")
    add_equation(doc, "B_RH = (RH_1 + RH_2 + ... + RH_N) / N")
    add_equation(doc, "B_smoke = integer((S_1 + S_2 + ... + S_N) / N)")
    add_body(doc, "ในโหมดภาคสนามปัจจุบัน TEST_MODE = 0 และ N = 12 รอบ ช่วง CALIBRATING ตั้งไว้ 30 วินาที จึงใช้เวลาตามแผนประมาณ 5.5 นาทีจากรอบแรกถึงรอบที่ 12 ทั้งนี้อาจต่างจากเวลาจริงเล็กน้อยตามการบูตและการสื่อสาร")
    add_table(
        doc,
        ["ข้อมูลที่ไม่รับเข้า Baseline", "เกณฑ์ปัจจุบัน", "วัตถุประสงค์"],
        [
            ["เซนเซอร์ผิดปกติ", "SHT/Sharp health = fault", "ไม่เรียนค่าที่เชื่อถือไม่ได้"],
            ["อนุภาคสูง", "smokeRaw >= 1200", "ไม่เรียนควันขณะเปิดเครื่องเป็นสภาพปกติ"],
            ["อุณหภูมิสูง", "T >= 40 degC", "ไม่เรียนสภาพร้อนผิดปกติเป็น Baseline"],
            ["ความชื้นต่ำมาก", "RH <= 35%", "ไม่เรียนสภาพเสี่ยงรุนแรงเป็น Baseline"],
        ],
        [3100, 2200, 4060],
    )
    add_body(doc, "แนวคิด Baseline สอดคล้องกับงาน Change detection ที่ประมาณสภาพปกติแล้วตรวจการเบี่ยงเบน งานของ Zervas และคณะปรับค่าอุณหภูมิอ้างอิงเป็นช่วง ๆ และใช้ CUSUM เพื่อตรวจการเปลี่ยนแปลง แต่โค้ดเราใช้ค่าเฉลี่ยเริ่มต้นและ Threshold ที่ง่ายกว่า ไม่ได้ใช้สมการ CUSUM ของงานนั้น")
    add_source(doc, "[R9]", "Zervas et al. - Multisensor data fusion for fire detection", "https://www.sciencedirect.com/science/article/pii/S1566253509001006", " (Information Fusion, DOI 10.1016/j.inffus.2009.12.006)")
    add_callout(doc, "สถานะการอ้างอิง: B/C", "ค่าเฉลี่ยเลขคณิตเป็นคณิตศาสตร์มาตรฐานและแนวคิด Reference baseline มีงานรองรับ แต่ N = 12 รวมถึงเกณฑ์ 1200, 40 degC และ 35% เป็นค่าที่โครงการกำหนดเอง", "caution")

    add_heading(doc, "การคำนวณ Delta, Rate และ Baseline Delta", 1)
    add_label(doc, "ตำแหน่งในโค้ด:", "sensor_node_2/sensor_node_2.ino ฟังก์ชัน getElapsedMinutesForDelta() และ calculateDelta() บรรทัด 453-500")
    add_heading(doc, "ผลต่างจากรอบก่อน", 2)
    add_equation(doc, "dX_step = X_current - X_previous")
    add_body(doc, "ใช้ตรวจการเปลี่ยนแปลงฉับพลันระหว่างการตื่นสองครั้ง เครื่องหมายบวกของอุณหภูมิ/ควันหมายถึงเพิ่มขึ้น ส่วนความชื้นที่ลดลงจะได้ค่าติดลบ")
    add_heading(doc, "อัตราการเปลี่ยนแปลงต่อนาที", 2)
    add_equation(doc, "Rate_per_min = dX_step / elapsed_minutes")
    add_label(doc, "ตัวอย่าง:", "อุณหภูมิเพิ่มจาก 30 เป็น 33 degC ใน 10 นาที: dT = 3 degC และ Rate = 3/10 = 0.30 degC/min")
    add_body(doc, "การหารด้วยเวลาทำให้โหมดทดสอบที่อ่านถี่และโหมดภาคสนามที่อ่านห่างเปรียบเทียบด้วยหน่วยเดียวกัน แต่ใน Field mode เวลาถูกประมาณจากช่วงตื่นที่วางแผนไว้ เพราะ millis() เริ่มใหม่หลัง Deep sleep ดังนั้น Rate อาจคลาดเคลื่อนถ้าเวลาจริงต่างจากเวลาที่กำหนด")
    add_heading(doc, "ผลต่างจาก Baseline", 2)
    add_equation(doc, "dX_baseline = X_current - B_X")
    add_body(doc, "Baseline delta ทำให้ระบบยังเห็นค่าที่ค้างสูงหรือต่ำผิดปกติ แม้รอบปัจจุบันจะเปลี่ยนจากรอบก่อนเพียงเล็กน้อยแล้ว")
    add_body(doc, "งานตรวจไฟด้วย WSN ใช้ Threshold จากอุณหภูมิ ความชื้น และแสง รวมทั้งใช้การรวมข้อมูลเพื่อแยกเหตุผิดปกติ งานอีกชิ้นระบุการเปลี่ยนแปลงที่คาดได้ขณะไฟพัฒนา เช่น อุณหภูมิเพิ่มและความชื้นลด แนวคิดเหล่านี้รองรับทิศทางของสัญญาณ แต่ไม่ได้รับรองค่า Threshold ของเรา")
    add_source(doc, "[R8]", "Wireless Sensor Networks and Fusion Information Methods for Forest Fire Detection", "https://www.sciencedirect.com/science/article/pii/S221201731200237X", " (Procedia Technology, DOI 10.1016/j.protcy.2012.03.008)")
    add_source(doc, "[R11]", "Brito et al. - Wireless Sensor Network for Ignitions Detection: An IoT approach", "https://www.mdpi.com/2079-9292/9/6/893", " (Electronics 2020, DOI 10.3390/electronics9060893)")
    add_callout(doc, "สถานะการอ้างอิง: B/C", "สมการผลต่างและอัตราเป็น Finite difference พื้นฐาน ส่วนทิศทางสัญญาณมีงานรองรับ แต่ค่า Rate thresholds ทั้งหมดเป็นค่าที่โครงการตั้งเอง", "caution")

    add_heading(doc, "การสร้าง Evidence ของควัน ความร้อน และความชื้น", 1)
    add_label(doc, "ตำแหน่งในโค้ด:", "sensor_node_2/sensor_node_2.ino ฟังก์ชัน getEvidenceFlags() บรรทัด 502-560; sensor_node_2/config.h บรรทัด 146-189")
    add_body(doc, "ระบบไม่ได้พิจารณาค่าปัจจุบันอย่างเดียว แต่ให้แต่ละกลุ่มผ่านได้จากอย่างน้อยหนึ่งเส้นทาง: เปลี่ยนเร็ว, ต่างจาก Baseline มาก หรือผ่านค่า Absolute/raw threshold")
    add_heading(doc, "Evidence กลุ่มควัน/อนุภาค", 2)
    add_code(doc, "smokeWatch = smokeRateWatch OR smokeBaselineWatch\nsmokeGroup = smokeRateWarning OR baselineDelta >= 450 OR raw >= 1200\nsmokeCritical = smokeRateCritical OR baselineDelta >= 900 OR raw >= 1800")
    add_table(
        doc,
        ["ระดับ", "Rate ต่อ min", "ต่างจาก Baseline", "Raw absolute"],
        [
            ["WATCH", ">= 300 และ step >= 40", ">= 150 และ raw >= 250", "ใช้ raw minimum 250"],
            ["WARNING group", ">= 800 และ step >= 40", ">= 450", ">= 1200"],
            ["CRITICAL evidence", ">= 1500 และ step >= 40", ">= 900", ">= 1800"],
        ],
        [1600, 2500, 2660, 2600],
    )
    add_heading(doc, "Evidence กลุ่มความร้อน", 2)
    add_table(
        doc,
        ["ระดับ", "Rate ต่อ min", "ต่างจาก Baseline", "Absolute"],
        [
            ["WATCH", ">= 0.30 และ step >= 0.20 degC", ">= 2 degC", "ไม่มี"],
            ["WARNING group", ">= 0.70 และ step >= 0.20 degC", ">= 4 degC", ">= 40 degC"],
            ["CRITICAL evidence", ">= 1.20 และ step >= 0.20 degC", ">= 6 degC", ">= 50 degC"],
        ],
        [1600, 2700, 2560, 2500],
    )
    add_heading(doc, "Evidence กลุ่มความชื้นลด", 2)
    add_equation(doc, "humidity_drop_from_baseline = -(RH_current - B_RH) = B_RH - RH_current")
    add_table(
        doc,
        ["ระดับ", "อัตราลดต่อ min", "ลดจาก Baseline", "Absolute"],
        [
            ["WATCH", ">= 1.0 และ step drop >= 0.60%", ">= 5%RH", "ไม่มี"],
            ["WARNING group", ">= 2.0 และ step drop >= 0.60%", ">= 10%RH", "RH <= 35%"],
            ["CRITICAL evidence", ">= 4.0 และ step drop >= 0.60%", ">= 15%RH", "RH <= 35%"],
        ],
        [1600, 2650, 2710, 2400],
    )
    add_body(doc, "groupCount นับเพียง smokeGroup, heatGroup และ humidityGroup ระดับ Warning-group อย่างละหนึ่งกลุ่ม ไม่ได้นับ Watch หรือ Critical เป็นคะแนนกลุ่มแยกเพิ่มเติม")
    add_source(doc, "[R8]", "Forest fire detection using threshold and Dempster-Shafer fusion", "https://www.sciencedirect.com/science/article/pii/S221201731200237X")
    add_source(doc, "[R10]", "Ding et al. - Multi-Sensor Building Fire Alarm System Based on D-S Evidence Theory", "https://www.mdpi.com/1999-4893/7/4/523", " (Algorithms 2014, DOI 10.3390/a7040523)")
    add_callout(doc, "สถานะการอ้างอิง: B/C", "งานวิจัยรองรับการใช้หลายพารามิเตอร์และ Threshold/Fusion แต่ค่าตัวเลขทุกค่าในสามตารางเป็นพารามิเตอร์ของโครงการ ยังไม่มีงานที่รับรองค่าชุดนี้สำหรับ GP2Y1014AU0F และพื้นที่ติดตั้งของเรา", "caution")

    add_heading(doc, "การรวม Evidence เป็นคะแนน 0-100", 1)
    add_label(doc, "ตำแหน่งในโค้ด:", "sensor_node_2/sensor_node_2.ino ฟังก์ชัน calculateConfidence() บรรทัด 563-594")
    add_equation(doc, "Score = SmokeScore + HeatScore + HumidityScore + DryBonus - FogPenalty - FaultPenalty")
    add_body(doc, "ในแต่ละกลุ่มเลือกคะแนนสูงสุดเพียงระดับเดียวด้วย if/else if แล้วรวมข้ามกลุ่ม จากนั้นจำกัดผลให้อยู่ระหว่าง 0 และ 100")
    add_table(
        doc,
        ["องค์ประกอบ", "WATCH", "GROUP/WARNING", "CRITICAL"],
        [
            ["Smoke", "+15", "+32", "+45"],
            ["Heat", "+10", "+25", "+30"],
            ["Humidity", "+8", "+18", "+25"],
        ],
        [3500, 1860, 2000, 2000],
    )
    add_table(
        doc,
        ["กฎเสริม", "คะแนน"],
        [
            ["RH <= 35%", "+15"],
            ["35% < RH <= 45%", "+10"],
            ["RH >= 90% และ smoke ไม่ Critical", "-20"],
            ["Sensor fault", "-40"],
            ["Baseline ยังไม่พร้อม", "จำกัดคะแนนสูงสุดไว้ที่ 60"],
            ["ผลรวมต่ำกว่า 0 หรือสูงกว่า 100", "Clamp เป็น 0 หรือ 100"],
        ],
        [6900, 2460],
    )
    add_label(doc, "ตัวอย่าง:", "Smoke group 32 + Heat group 25 + Humidity group 18 + RH ต่ำ 10 = 85 คะแนน ก่อนพิจารณา Fog/Fault")
    add_body(doc, "แนวคิดการรวมข้อมูลหลายชนิดมีงานรองรับอย่างชัดเจน งานของ Ding ใช้ Dempster-Shafer เพื่อรวม Smoke, Temperature, Moisture และตัวแปรอื่น ส่วนงานของ Zervas ใช้ CUSUM และ Dempster-Shafer หลายระดับ")
    add_callout(doc, "คำเรียกที่ถูกต้อง:", "ตัวแปรชื่อ confidence ในโค้ดเป็น Rule-based evidence score ไม่ใช่ค่าความน่าจะเป็นทางสถิติ เพราะน้ำหนักยังไม่ได้เรียนรู้หรือคาลิเบรตจากชุดข้อมูลที่มีป้ายกำกับ", "risk")
    add_source(doc, "[R9]", "Zervas et al. - Multisensor data fusion for fire detection", "https://www.sciencedirect.com/science/article/pii/S1566253509001006")
    add_source(doc, "[R10]", "Ding et al. - Multi-sensor information fusion for fire alarm", "https://www.mdpi.com/1999-4893/7/4/523")
    add_callout(doc, "สถานะการอ้างอิง: B/C", "หลัก Multi-sensor fusion มาจากงานวิจัย แต่วิธีบวกคะแนน 45/30/25, โบนัส, จุดตัด 55/70 และการ Clamp เป็นสูตรเฉพาะของโครงการ", "caution")

    add_heading(doc, "การชดเชยสภาพหมอก/ความชื้นสูง", 1)
    add_label(doc, "ตำแหน่งในโค้ด:", "sensor_node_2/sensor_node_2.ino บรรทัด 578-585; sensor_node_2/config.h บรรทัด 183-185 และ 211-212")
    add_equation(doc, "if RH >= 90% and smokeCritical == false: Score = Score - 20")
    add_body(doc, "เหตุผลคือเซนเซอร์อนุภาคแบบกระเจิงแสงอาจอ่านสูงขึ้นเมื่อ RH สูง เพราะอนุภาคดูดน้ำและมีขนาดเชิงแสงใหญ่ขึ้น หรือมีหยดน้ำ/หมอกเข้าไปกระเจิงแสง งานของ Di Antonio และคณะรายงานผลกระทบของ RH ต่อ Optical particle counters และพัฒนาวิธีแก้ตามฟิสิกส์ของอนุภาค")
    add_body(doc, "อย่างไรก็ตาม งานวิจัยไม่ได้เสนอให้หักคะแนนคงที่ 20 ที่ RH 90% สูตรในโค้ดเป็นเพียงกฎป้องกัน False alarm แบบหยาบ และไม่ควรถูกเรียกว่า RH correction ที่ผ่านการคาลิเบรต")
    add_source(doc, "[R12]", "Di Antonio et al. - Developing a Relative Humidity Correction for Low-Cost Sensors Measuring Ambient Particulate Matter", "https://doi.org/10.3390/s18092790", " (Sensors 2018)")
    add_callout(doc, "สถานะการอ้างอิง: B/C", "งานวิจัยรองรับว่าความชื้นสูงรบกวนการวัดแบบ Optical แต่ RH = 90% และการหัก 20 คะแนนเป็นค่าของโครงการ", "caution")

    add_heading(doc, "การตัดสินสถานะจากคะแนนและจำนวนกลุ่ม", 1)
    add_label(doc, "ตำแหน่งในโค้ด:", "sensor_node_2/sensor_node_2.ino ฟังก์ชัน evaluateFireStatusRaw() บรรทัด 596-626; sensor_node_2/config.h บรรทัด 191-209")
    add_table(
        doc,
        ["ลำดับตรวจ", "เงื่อนไขหลัก", "ผลลัพธ์"],
        [
            ["1", "มี Sensor fault", "SENSOR_FAULT"],
            ["2", "Baseline ยังไม่พร้อมและยังไม่มี Boot abnormal ต่อเนื่อง", "CALIBRATING"],
            ["3", "Score >= 70, groupCount >= 2 และมี Smoke group", "CRITICAL candidate"],
            ["4", "Score >= 55 และ (groupCount >= 2 หรือ Smoke critical)", "WARNING"],
            ["5", "มี Smoke watch หรือหลักฐานสิ่งแวดล้อมตามกฎ Watch", "WATCH"],
            ["6", "ไม่เข้าเงื่อนไขข้างต้น", "NORMAL"],
        ],
        [1500, 5700, 2160],
    )
    add_body(doc, "การบังคับให้ CRITICAL ต้องมีอย่างน้อยสองกลุ่มและต้องมี Smoke group เป็นแนวคิด Cross-confirmation เพื่อลดการเตือนจากความร้อนหรือความแห้งเพียงอย่างเดียว แต่เป็นกฎเฉพาะของโครงการ ไม่ใช่ข้อกำหนดจากงานวิจัยที่อ้าง")
    add_body(doc, "ขณะ Baseline ยังไม่พร้อม หากอ่านผิดปกติต่อเนื่องครบ 2 รอบ ระบบจะไม่เรียนค่าเหล่านั้น ถ้า Smoke critical ร่วมกับ Heat/Humidity group จะให้ WARNING มิฉะนั้นให้ WATCH")
    add_callout(doc, "สถานะการอ้างอิง: B/C", "แนวคิดใช้หลักฐานหลายกลุ่มมีงานรองรับ แต่ลำดับกฎ จุดตัด 55/70 และข้อกำหนด Smoke สำหรับ CRITICAL เป็นการออกแบบของโครงการ", "caution")

    add_heading(doc, "การยืนยันตามเวลาและการค้างสถานะ", 1)
    add_label(doc, "ตำแหน่งในโค้ด:", "sensor_node_2/sensor_node_2.ino บรรทัด 640-720")
    add_heading(doc, "Weak WATCH debounce", 2)
    add_body(doc, "WATCH ที่เกิดจาก Heat/Humidity อ่อน ๆ โดยไม่มี Smoke ต้องเกิด 2 รอบติดต่อกัน รอบแรกยังรายงาน NORMAL เพื่อลดการเตือนจากสัญญาณแกว่งครั้งเดียว")
    add_heading(doc, "CRITICAL debounce", 2)
    add_body(doc, "เงื่อนไขที่ดูเป็น CRITICAL ต้องเกิด 2 รอบติดต่อกัน รอบแรกถูกลดเป็น WARNING และรอบที่สองจึงขึ้น CRITICAL หากสถานะถูกค้างเป็น CRITICAL อยู่แล้วจะคงไว้ทันที")
    add_heading(doc, "Release hysteresis", 2)
    add_body(doc, "เมื่อสถานะดิบลดระดับ ระบบยังไม่ลดสถานะทันที ต้องผ่านเงื่อนไขปล่อยและได้รอบสะอาดครบ 3 รอบ โดย WARNING ใช้ release score < 25 และ CRITICAL ใช้ release score < 45")
    add_body(doc, "นี่เป็นการประยุกต์ Temporal validation และ Hysteresis เพื่อไม่ให้สถานะสลับไปมาจาก Noise งานตรวจจับแบบ Sequential เช่น CUSUM ก็ใช้ข้อมูลต่อเนื่องตามเวลาแทนการตัดสินจากตัวอย่างเดียว แต่โค้ดเราไม่ได้ใช้ CUSUM")
    add_source(doc, "[R9]", "Zervas et al. - CUSUM sequential detection in multisensor fire detection", "https://www.sciencedirect.com/science/article/pii/S1566253509001006")
    add_callout(doc, "สถานะการอ้างอิง: B/C", "แนวคิดยืนยันตามเวลามีฐานทาง Change detection แต่ตัวเลข 2 รอบ, 3 รอบ และ Release scores 25/45 เป็นค่าที่โครงการกำหนดเอง", "caution")

    add_heading(doc, "การปรับ Baseline หลังตัดสินด้วย EMA", 1)
    add_label(doc, "ตำแหน่งในโค้ด:", "sensor_node_2/sensor_node_2.ino ฟังก์ชัน updateBaselineAfterDecision() บรรทัด 723-742")
    add_equation(doc, "B_new = B_old + alpha * (X_current - B_old)", "เท่ากับ B_new = (1 - alpha) * B_old + alpha * X_current")
    add_table(
        doc,
        ["สถานะ", "alpha / ตัวแปร", "เหตุผลในระบบ"],
        [
            ["NORMAL", "alpha = 0.05 สำหรับ T, RH และ Smoke", "ตามการเปลี่ยนแปลงธรรมชาติอย่างช้า ๆ"],
            ["WATCH ไม่มี Smoke", "alpha = 0.01 เฉพาะ T และ RH", "ตามการเปลี่ยนกลางวัน/กลางคืนช้ากว่าเดิม โดยตรึง Smoke"],
            ["WATCH มี Smoke, WARNING, CRITICAL, FAULT", "ไม่ปรับ Baseline", "ไม่ดูดเหตุผิดปกติเข้าไปเป็นค่าปกติ"],
        ],
        [2200, 3100, 4060],
    )
    add_label(doc, "ตัวอย่าง:", "Baseline อุณหภูมิเดิม 30 degC, ค่าปัจจุบัน 32 degC และ alpha = 0.05 จะได้ B_new = 30 + 0.05(32-30) = 30.10 degC")
    add_body(doc, "EMA หรือ Geometric moving average ให้น้ำหนักค่าล่าสุดมากที่สุดและให้น้ำหนักข้อมูลเก่าลดลงแบบเรขาคณิต หลักการนี้ย้อนกลับไปยัง Roberts (1959)")
    add_source(doc, "[R7]", "Roberts (1959) - Control Chart Tests Based on Geometric Moving Averages", "https://doi.org/10.1080/00401706.1959.10489860", " (Technometrics 1(3), 239-250)")
    add_callout(doc, "สถานะการอ้างอิง: B/C", "สมการ EMA เป็นหลักการมาตรฐาน แต่ alpha = 0.05, alpha = 0.01 และกฎว่าจะปรับเฉพาะสถานะใดเป็นการออกแบบของโครงการ", "caution")

    add_heading(doc, "การปรับช่วงเวลาตื่นตามสถานะ", 1)
    add_label(doc, "ตำแหน่งในโค้ด:", "sensor_node_2/config.h บรรทัด 97-109 และ sensor_node_2/sensor_node_2.ino บรรทัด 755-765, 1360-1383")
    add_table(
        doc,
        ["สถานะ", "ช่วงเวลาปัจจุบัน", "ผลต่อระบบ"],
        [
            ["NORMAL", "600 s", "ประหยัดพลังงาน แต่ตอบสนองช้ากว่า"],
            ["WATCH", "120 s", "เพิ่มความถี่เพื่อดูแนวโน้ม"],
            ["WARNING", "60 s", "ติดตามใกล้ขึ้นและคงตื่นตาม config"],
            ["CRITICAL", "20 s", "วัดและรายงานต่อเนื่องถี่ที่สุด"],
            ["CALIBRATING", "30 s", "สร้าง Baseline"],
            ["SENSOR_FAULT", "300 s", "ตรวจซ้ำโดยไม่ใช้พลังงานต่อเนื่อง"],
        ],
        [2200, 2200, 4960],
    )
    add_body(doc, "งานของ Kang และคณะเสนอ Adaptive duty-cycled protocol ที่ลดช่วง Sleep เมื่อความน่าจะเป็นไฟเพิ่มขึ้น เพื่อแลกพลังงานกับความเร็วตรวจจับ หลักการนี้สอดคล้องกับการปรับรอบตื่นของเรา")
    add_source(doc, "[R13]", "Kang, Lim and Jung - Energy-Efficient Forest Fire Prediction Model Based on Two-Stage Adaptive Duty-Cycled Hybrid X-MAC Protocol", "https://doi.org/10.3390/s18092960", " (Sensors 2018)")
    add_callout(doc, "สถานะการอ้างอิง: B/C", "งานวิจัยรองรับหลัก Adaptive duty cycle แต่ช่วง 600/120/60/20/30/300 วินาทีเป็นค่าของโครงการ และมีผลโดยตรงต่อ Rate_per_min ที่รอบถัดไปใช้", "caution")

    add_heading(doc, "สิ่งที่ระบบนี้ไม่ใช่: Canadian Fire Weather Index", 1)
    add_body(doc, "ระบบโหนดของเราเป็น Local anomaly detector ที่ใช้ควัน/อนุภาค อุณหภูมิ และความชื้นใกล้จุดติดตั้งเพื่อค้นหาสัญญาณผิดปกติ ไม่ใช่แบบจำลอง Fire Weather Index (FWI) สำหรับประเมินอันตรายไฟในระดับพื้นที่")
    add_body(doc, "FWI ของแคนาดาใช้ข้อมูลรายวันต่อเนื่องของอุณหภูมิ ความชื้น ลม และฝน รวมถึงสถานะความชื้นเชื้อเพลิงจากวันก่อน โค้ดเรายังไม่มีลม ฝน และ Fuel moisture codes จึงไม่ควรอ้างว่าใช้สูตร FWI")
    add_source(doc, "[R14]", "Natural Resources Canada - Canadian Fire Weather Index System: Data Sources and Methods", "https://cwfis.cfs.nrcan.gc.ca/index.php/background/dsm/fwi")

    add_heading(doc, "รายการพารามิเตอร์ที่ยังเป็นค่าตั้งต้นของโครงการ", 1)
    add_body(doc, "ค่าต่อไปนี้ไม่พบแหล่งอ้างอิงใน Repository ที่ระบุว่าคัดมาจากงานวิจัย และใน config.h มีคำกำกับให้ Tune หลังวัดเซนเซอร์จริง")
    for item in (
        "จำนวนรอบสร้าง Baseline 12 รอบ และ Boot abnormal 2 รอบ",
        "ค่า alpha ของ EMA 0.05 และ 0.01",
        "Smoke rate 300/800/1500 raw/min และ minimum step 40 raw",
        "Smoke baseline delta 150/450/900 และ raw absolute 250/1200/1800",
        "Temperature rate 0.30/0.70/1.20 degC/min และ minimum step 0.20 degC",
        "Temperature baseline delta 2/4/6 degC และ absolute 40/50 degC",
        "Humidity drop rate 1/2/4 %RH/min, minimum step 0.60%RH และ baseline drop 5/10/15%RH",
        "Humidity low 45%, very low 35%, fog-like 90% และ Fog penalty 20",
        "น้ำหนักคะแนน Smoke 15/32/45, Heat 10/25/30, Humidity 8/18/25",
        "Warning/Critical score 55/70, release score 25/45 และรอบยืนยัน/ปล่อย 2/2/3",
        "ช่วงเวลาตื่นตามสถานะทั้งหมด",
    ):
        add_bullet(doc, item)
    add_callout(doc, "ความหมายเชิงวิชาการ:", "สามารถอ้างงานวิจัยเพื่อรองรับโครงสร้างวิธีได้ แต่ห้ามเขียนว่างานวิจัยกำหนดค่าตัวเลขเหล่านี้ หากยังไม่มีผลทดลองของโครงการรองรับ", "risk")

    add_heading(doc, "แนวทางทำให้ค่าของโครงการมีหลักฐานรองรับ", 1)
    add_body(doc, "เพื่อเปลี่ยนค่าระดับ C ให้เป็นพารามิเตอร์ที่มีหลักฐาน ควรสร้างชุดข้อมูลจากอุปกรณ์จริงและบันทึก Ground truth อย่างน้อยสี่กลุ่ม")
    for item in (
        "สภาพปกติหลายช่วงเวลา: เช้า กลางวัน เย็น กลางคืน และหลายสภาพอากาศ",
        "ตัวรบกวนที่ไม่ใช่ไฟ: หมอก ไอน้ำ ฝุ่น ละออง น้ำมัน ควันรถ และแสงภายนอก",
        "เหตุเผาไหม้ที่ควบคุมและปลอดภัย โดยผู้มีหน้าที่กำกับ พร้อมระยะทาง/เชื้อเพลิง/ลมที่บันทึกชัดเจน",
        "Sensor fault: สายหลุด ไฟเลี้ยงผิด LED ไม่ทำงาน ค่า ADC อิ่มตัว และข้อมูลค้าง",
    ):
        add_bullet(doc, item)
    add_body(doc, "จากนั้นคำนวณ False alarm rate, Detection rate/Recall, Precision, เวลาเฉลี่ยก่อนตรวจพบ และทดสอบ Threshold หลายชุดกับข้อมูลที่แยก Train/Validation/Test ตามเหตุการณ์ ไม่ควรสุ่มแยกทีละแถวเพราะข้อมูลติดกันตามเวลา")
    add_body(doc, "หลังคาลิเบรตแล้วจึงระบุในรายงานได้ว่า พารามิเตอร์ถูกกำหนดจากผลทดลองของระบบเรา พร้อมตารางจำนวนเหตุการณ์ เงื่อนไขทดลอง และช่วงความไม่แน่นอน")

    add_heading(doc, "ข้อความแนะนำสำหรับใส่หลังสูตรในรายงาน", 1)
    add_callout(
        doc,
        "ข้อความพร้อมใช้:",
        "ระบบประมวลผลฝั่งโหนดประยุกต์แนวคิดการสร้างค่าฐานอ้างอิง การตรวจการเปลี่ยนแปลงตามเวลา และการรวมหลักฐานจากเซนเซอร์หลายชนิด ซึ่งสอดคล้องกับงานวิจัยด้าน Wireless Sensor Network และ Multi-sensor fire detection ส่วนการแปลงค่าของ SHT31 และ Timing ของ GP2Y1014AU0F อ้างอิงเอกสารผู้ผลิตโดยตรง อย่างไรก็ตาม ค่า Threshold น้ำหนักคะแนน ค่า alpha จำนวนรอบยืนยัน และช่วงเวลาตื่นเป็นพารามิเตอร์เริ่มต้นที่โครงการกำหนดขึ้นสำหรับต้นแบบ จึงต้องปรับเทียบและประเมินด้วยข้อมูลจากอุปกรณ์จริงก่อนสรุปประสิทธิภาพหรือใช้งานด้านความปลอดภัย",
        "info",
    )

    add_heading(doc, "รายการเอกสารอ้างอิงและลิงก์ตรวจสอบ", 1)
    refs = [
        ("R1", "Sensirion AG. Datasheet SHT3x-DIS, Version 7, December 2022.", "https://admin.sensirion.com/media/documents/213E6A3B/63A5A569/Datasheet_SHT3x_DIS.pdf"),
        ("R2", "Adafruit Industries. Adafruit SHT31 Arduino Library.", "https://github.com/adafruit/Adafruit_SHT31"),
        ("R3", "Sharp Corporation. GP2Y1014AU0F Dust Sensor Product Specification, ED-15G001A.", "https://cdn-shop.adafruit.com/product-files/4649/SHARP_GP2Y1014AU0F.pdf"),
        ("R4", "Sharp Corporation. Dust Sensor / PM Sensor Unit product lineup.", "https://global.sharp/products/device/lineup/selection/opto/dust/index.html"),
        ("R5", "Espressif Systems. Arduino ESP32 Analog-to-Digital Converter API documentation.", "https://docs.espressif.com/projects/arduino-esp32/en/latest/api/adc.html"),
        ("R6", "R Project. Tukey's Running Median Smoothing documentation.", "https://search.r-project.org/R/refmans/stats/html/smooth.html"),
        ("R7", "Roberts, S. W. (1959). Control Chart Tests Based on Geometric Moving Averages. Technometrics, 1(3), 239-250.", "https://doi.org/10.1080/00401706.1959.10489860"),
        ("R8", "Wireless Sensor Networks and Fusion Information Methods for Forest Fire Detection. Procedia Technology, 3 (2012), 69-79.", "https://doi.org/10.1016/j.protcy.2012.03.008"),
        ("R9", "Zervas, E., Mpimpoudis, A., Anagnostopoulos, C., Sekkas, O., & Hadjiefthymiades, S. (2011). Multisensor data fusion for fire detection. Information Fusion, 12(3), 150-159.", "https://doi.org/10.1016/j.inffus.2009.12.006"),
        ("R10", "Ding, Q., Peng, Z., Liu, T., & Tong, Q. (2014). Multi-Sensor Building Fire Alarm System with Information Fusion Technology Based on D-S Evidence Theory. Algorithms, 7(4), 523-537.", "https://doi.org/10.3390/a7040523"),
        ("R11", "Brito, T., Pereira, A. I., Lima, J., & Valente, A. (2020). Wireless Sensor Network for Ignitions Detection: An IoT approach. Electronics, 9(6), 893.", "https://doi.org/10.3390/electronics9060893"),
        ("R12", "Di Antonio, A., Popoola, O. A. M., Ouyang, B., Saffell, J., & Jones, R. L. (2018). Developing a Relative Humidity Correction for Low-Cost Sensors Measuring Ambient Particulate Matter. Sensors, 18(9), 2790.", "https://doi.org/10.3390/s18092790"),
        ("R13", "Kang, J.-G., Lim, D.-W., & Jung, J.-W. (2018). Energy-Efficient Forest Fire Prediction Model Based on Two-Stage Adaptive Duty-Cycled Hybrid X-MAC Protocol. Sensors, 18(9), 2960.", "https://doi.org/10.3390/s18092960"),
        ("R14", "Natural Resources Canada. Canadian Fire Weather Index System - Data Sources and Methods.", "https://cwfis.cfs.nrcan.gc.ca/index.php/background/dsm/fwi"),
    ]
    for key, citation, url in refs:
        p = doc.add_paragraph(style="Source")
        p.paragraph_format.left_indent = Inches(0.25)
        p.paragraph_format.first_line_indent = Inches(-0.25)
        r = p.add_run(f"[{key}] {citation} ")
        set_run_font(r, size=9.6, color="222222")
        add_hyperlink(p, url, url, color=BLUE)

    add_heading(doc, "ตำแหน่งอ้างอิงใน Source code", 1)
    add_body(doc, "บรรทัดอ้างอิงด้านล่างตรงกับ commit bcf9e5f และอาจเลื่อนหากมีการแก้โค้ดภายหลัง ควรค้นด้วยชื่อฟังก์ชันเมื่อเลขบรรทัดไม่ตรง")
    add_table(
        doc,
        ["หัวข้อ", "ไฟล์ / ฟังก์ชัน / บรรทัด"],
        [
            ["อ่านและกรองเซนเซอร์", "sensor_node_2/sensor_node_2.ino: median3 179; readSharpOnce 185; readSmokeMedian 197; readSensors 282"],
            ["สร้าง Baseline", "sensor_node_2/sensor_node_2.ino: updateBaselineWarmup 428"],
            ["Delta และ Rate", "sensor_node_2/sensor_node_2.ino: calculateDelta 467"],
            ["Evidence", "sensor_node_2/sensor_node_2.ino: getEvidenceFlags 502"],
            ["คะแนน", "sensor_node_2/sensor_node_2.ino: calculateConfidence 563"],
            ["ตัดสินสถานะ", "sensor_node_2/sensor_node_2.ino: evaluateFireStatusRaw 596; evaluateFireStatus 716"],
            ["Debounce และ Latch", "sensor_node_2/sensor_node_2.ino: applyWeakWatchDebounce 648; applyCriticalDebounce 670; applyStateLatch 682"],
            ["ปรับ Baseline", "sensor_node_2/sensor_node_2.ino: updateBaselineAfterDecision 723"],
            ["ลำดับรอบวัด", "sensor_node_2/sensor_node_2.ino: runOneMeasurementCycle 1434"],
            ["ค่าคงที่ทั้งหมด", "sensor_node_2/config.h: baseline 115; thresholds 146; state rules 191"],
        ],
        [3000, 6360],
    )
    add_callout(doc, "จบขอบเขตเอกสาร:", "เอกสารฉบับนี้อธิบายเฉพาะที่มาของการคำนวณฝั่งโหนดตามที่ร้องขอ ยังไม่ได้วิเคราะห์สูตรฝั่ง Backend risk engine หรือการแจ้งเตือนรวมหลายโหนด", "info")

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    doc.save(OUTPUT)
    print("DOCX_CREATED")


if __name__ == "__main__":
    build_document()
