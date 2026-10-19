# Vector Panel for Illustrator

โฟลเดอร์นี้เป็นโค้ดเวอร์ชันเริ่มต้นของ Panel สำหรับ Adobe Illustrator 2026 บน macOS ผู้ใช้เลือกภาพ raster หนึ่งภาพในเอกสาร กดสร้างตัวอย่าง แล้วใส่ผลเป็น path ใน layer ใหม่ โดยเก็บภาพต้นฉบับไว้

## สถานะ

- มี CEP Panel, คำสั่ง ExtendScript สำหรับภาพ linked/embedded, ตัวแปลง VTracer แบบ binary และหน้าตัวอย่าง SVG
- เครื่องนี้มี Illustrator 30.8.2 ที่กำลังใช้ CEP 12.1.1; development link ถูกติดตั้งในบัญชีผู้ใช้แล้ว
- Panel ใช้ `PageItem.uuid` และตัวระบุเอกสารตรวจภาพที่เลือกก่อนใส่ผล และลบ layer ที่สร้างหาก Illustrator ไม่สร้าง path
- เลือกกลุ่มผลเดิมแล้วสร้างเวอร์ชันใหม่ได้จาก UUID ของภาพต้นฉบับ โดยไม่ลบผลที่แก้มือไว้
- ยังไม่ผ่านการตรวจใช้งานจริงภายใน Illustrator เวอร์ชัน 30.8.2 บนเครื่องนี้ แอปกำลังเปิดอยู่ จึงยังไม่ได้ปิดหรือเปิดใหม่เพื่อโหลด extension
- งานที่ยังต้องพิสูจน์: ความถูกต้องของ embedded/CMYK/clipping, Undo หนึ่งครั้ง, Re-trace หลังเปิด `.ai` ใหม่, ความเร็ว 10,000 paths, Windows และการแจกจ่ายแบบลงลายเซ็น

## ติดตั้งสำหรับพัฒนา

```bash
cd ~/Desktop/Illustrator-Vector-Panel
npm install
npm run build
./scripts/build-worker.sh
./scripts/install-dev.sh
```

`install-dev.sh` สร้าง symbolic link ไปยัง CEP extension ในบัญชีผู้ใช้ และเปิด `PlayerDebugMode` สำหรับ CEP 12 ไม่ได้แก้ไฟล์ใน Adobe Illustrator.app เมื่อต้องการเอา link ออก ให้ใช้ `./scripts/uninstall-dev.sh` การเปิด Panel ต้องให้ Illustrator โหลด extension ใหม่ผ่านเมนู **Window > Extensions (Legacy) > Vector Panel** อาจต้องปิดและเปิด Illustrator ใหม่ ก่อนปิดแอปให้บันทึกงานที่เปิดอยู่

## วิธีใช้

1. เปิดเอกสาร Illustrator และเลือก `PlacedItem` หรือ `RasterItem` หนึ่งภาพ
2. เปิด Vector Panel แล้วกด **ตรวจภาพ**
3. เลือก preset, จำนวนสี และความเรียบ จากนั้นกด **สร้างตัวอย่าง**
4. ตรวจภาพตัวอย่างแล้วกด **ใส่ใน Illustrator** ผลจะอยู่ใน layer ใหม่ ต้นฉบับยังอยู่
5. เมื่อต้องการแปลงใหม่ ให้เลือกกลุ่ม `Trace ...` ที่ Panel สร้าง กด **ตรวจภาพ** แล้วกด **สร้างเวอร์ชันใหม่**

ขั้นตอนอ่านภาพจะคัดลอกภาพที่เลือกไปยังเอกสารชั่วคราวแล้วใช้ `Document.imageCapture()` ทำ PNG วิธีนี้เปลี่ยนเนื้อหา clipboard ของระบบและสร้างไฟล์ชั่วคราวในโฟลเดอร์ระบบ ซึ่ง Panel ลบเมื่อจบงาน

## โครงสร้าง

| Path | หน้าที่ |
|---|---|
| `extension/CSXS/manifest.xml` | ประกาศ CEP Panel สำหรับ Illustrator |
| `extension/index.html`, `extension/style.css` | UI ใน Panel |
| `src/panel.ts` | สถานะ UI, เรียก JSX, เรียก worker และ preview |
| `extension/jsx/host.jsx` | อ่าน selection/capture ภาพ/นำ SVG เข้าเอกสาร |
| `extension/bin/vtracer` | VTracer CLI สำหรับ macOS arm64 |
| `scripts/` | Build worker และติดตั้ง/ถอด link สำหรับพัฒนา |

เป้าหมายการพัฒนาฉบับเต็มอยู่ที่ [แผนงาน](docs/roadmap-th.md) และข้อกำหนดของไลบรารีอยู่ที่ [THIRD_PARTY.md](THIRD_PARTY.md)

## แหล่งข้อมูลแพลตฟอร์ม

- [Adobe CEP 12 Cookbook](https://github.com/Adobe-CEP/CEP-Resources/blob/master/CEP_12.x/Documentation/CEP%2012%20HTML%20Extension%20Cookbook.md)
- [Adobe Illustrator Scripting Guide](https://ai-scripting.docsforadobe.dev/)
- [VTracer CLI](https://github.com/visioncortex/vtracer/blob/master/README.md)
