# Vector Panel for Illustrator

โฟลเดอร์นี้เป็นโค้ดเวอร์ชันเริ่มต้นของ Panel สำหรับ Adobe Illustrator 2026 บน macOS ผู้ใช้เลือกภาพ raster หนึ่งภาพในเอกสาร กดสร้างตัวอย่าง แล้วใส่ผลเป็น path ใน layer ใหม่ โดยเก็บภาพต้นฉบับไว้

## สถานะ

- มี CEP Panel, คำสั่ง ExtendScript สำหรับภาพ linked/embedded, ตัวแปลง VTracer แบบ binary และหน้าตัวอย่าง SVG
- เครื่องนี้มี Illustrator 30.8.2 ที่กำลังใช้ CEP 12.1.1; development link ถูกติดตั้งในบัญชีผู้ใช้แล้ว
- Panel ใช้ `PageItem.uuid` และตัวระบุเอกสารตรวจภาพที่เลือกก่อนใส่ผล และลบ layer ที่สร้างหาก Illustrator ไม่สร้าง path
- เลือกกลุ่มผลเดิมแล้วสร้างเวอร์ชันใหม่ได้จาก UUID ของภาพต้นฉบับ โดยไม่ลบผลที่แก้มือไว้
- ภาพที่ลิงก์และเมทริกซ์เป็นสเกลไม่หมุน (`A > 0`, `D < 0`) อ่านจาก `file.fsName` นอก main thread ของ Illustrator ภาพ embedded, ภาพในคลิป, ภาพหมุน หรือไฟล์ที่สัดส่วนไม่ตรงกับกรอบ ถูกจับเป็นแถบบางในเอกสารเดิม ไม่คัดลอกคลิปบอร์ดและไม่เปิดเอกสารใหม่ การค้น uuid เดินเข้ากลุ่มห่อของ Illustrator 30 ผลถูกนำเข้าด้วย `createFromFile` เป็น path ไม่ได้ Place SVG
- การทดสอบใน Illustrator 30.8.2 ของ `af401bc` ไม่ผ่าน Apply รอบนี้แก้จากผลนั้น และยังไม่ได้รันซ้ำใน Illustrator
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

ภาพที่ลิงก์และไม่ได้ครอป หมุน พลิก หรือใส่คลิป อ่านจาก `file.fsName` แล้วให้ worker ถอดรหัส ย่อ และเรียก VTracer ภาพ embedded หรือภาพที่ต้องแรสเตอร์จากเอกสารถูกจับเป็นแถบบาง ๆ ด้วย `imageCapture` นอก artboard แถบละหนึ่งสคริปต์ แล้ว worker ต่อแถบเป็น PNG ไม่ได้เปิดเอกสารชั่วคราวและไม่ได้เขียนคลิปบอร์ด การใส่ผลใช้ `GroupItems.createFromFile()` เป็น path ในสคริปต์เดียว ไม่ได้ Place ไฟล์ SVG เพราะ Illustrator 30 เปิดหน้าต่าง “cannot be placed” ค้างจนกว่าจะกด OK

## โครงสร้าง

| Path | หน้าที่ |
|---|---|
| `extension/CSXS/manifest.xml` | ประกาศ CEP Panel สำหรับ Illustrator |
| `extension/index.html`, `extension/style.css` | UI ใน Panel |
| `src/panel.ts` | สถานะ UI, เรียก JSX, เรียก worker และ preview |
| `src/trace-worker.ts`, `extension/js/trace-worker.js` | ถอดรหัส ย่อภาพ เรียก VTracer และตรวจ SVG นอกเธรดของพาเนล |
| `extension/jsx/host.jsx` | อ่าน selection/capture ภาพ/นำ SVG เข้าเอกสาร |
| `extension/bin/vtracer` | VTracer CLI สำหรับ macOS arm64 |
| `scripts/` | Build worker และติดตั้ง/ถอด link สำหรับพัฒนา |

เป้าหมายการพัฒนาฉบับเต็มอยู่ที่ [แผนงาน](docs/roadmap-th.md) และข้อกำหนดของไลบรารีอยู่ที่ [THIRD_PARTY.md](THIRD_PARTY.md)

## แหล่งข้อมูลแพลตฟอร์ม

- [Adobe CEP 12 Cookbook](https://github.com/Adobe-CEP/CEP-Resources/blob/master/CEP_12.x/Documentation/CEP%2012%20HTML%20Extension%20Cookbook.md)
- [Adobe Illustrator Scripting Guide](https://ai-scripting.docsforadobe.dev/)
- [VTracer CLI](https://github.com/visioncortex/vtracer/blob/master/README.md)
