# ผลวิเคราะห์ Vector Magic.app

## สรุป

ทำได้: [REA](https://github.com/morluto/rea) ใช้สำรวจและแตกไฟล์ใน macOS app bundle ได้ และเมื่อนำ Ghidra มาใช้เป็น decompiler ก็ถอด pseudocode จาก executable ได้ด้วย ในรอบนี้แตกไฟล์และถอดฟังก์ชันที่เกี่ยวกับการแปลงภาพเป็นเวกเตอร์ได้ 6 ฟังก์ชัน

## สิ่งที่พบ

- ไฟล์ที่ให้มาคือ macOS app bundle ที่แตกโครงสร้างไว้แล้ว ไม่ใช่ไฟล์ติดตั้งแบบ DMG/PKG
- executable เป็น Mach-O 64-bit สำหรับ Intel x86_64; ระบุ minimum macOS 10.7 และ SDK 10.11
- ใช้ Qt 5.5.1 และมี Qt frameworks/plugins อยู่ใน bundle
- executable SHA-256: `0b2b6621efdb3cbdae10cd8783d7d8fa7a25322067e52bdb85db739501310d48`
- REA ทำ inventory ได้ 81 artifact nodes, 99 occurrences และ 80 edges; แยกไฟล์ปกติได้ 40 ไฟล์ รวม 30,569,677 ไบต์
- Ghidra พบ procedure 6,536 รายการ และ string ที่ระบุได้ 13,231 รายการ; เป็น inventory จากเครื่องมือ ไม่ได้หมายความว่ากู้ซอร์สต้นฉบับได้ครบ

## pseudocode ที่ถอดได้

ถอดสำเร็จ 6 จาก 6 ฟังก์ชัน:

1. `PaletteFinder::doKMeans` — จัดกลุ่มสีแบบ k-means วนได้สูงสุด 10 รอบ และหยุดก่อนเมื่อการเปลี่ยนแปลงสีมีค่าน้อย
2. `PixelSegmenter::computeAffinityCost` — คิดต้นทุนจากความต่างสีของพิกเซลกับสี palette และเพิ่มค่าปรับเมื่อป้ายกำกับของเพื่อนบ้านต่างกัน
3. `PixelSegmenter::affinityLoop` — ปรับ label ของพิกเซลบริเวณขอบเขต โดยลอง label จากเพื่อนบ้านและเลือกต้นทุนที่ต่ำกว่า
4. `BoundaryTracer::traceBoundary` — เดินตามขอบเขตบริเวณเพื่อสร้างข้อมูล contour
5. `BezierFitter::fitBezierCurve` — ฟิตเส้น Bézier โดยตรึงจุดปลาย
6. `ContourSmoother::findPotential` — ประเมิน potential สำหรับการปรับ contour; ยังระบุน้ำหนัก/รายละเอียดของ prior ทุกชนิดจากรอบนี้ไม่ได้

ชื่อคลาสและสัญลักษณ์ C++ บางส่วนยังอยู่ใน binary จึงใช้ช่วยระบุหน้าที่ของโค้ดได้ อย่างไรก็ตาม pseudocode เป็นผลถอดกลับจาก machine code มีตัวแปรและโครงสร้าง pointer ที่ decompiler อนุมานขึ้น ไม่ใช่ source code เดิม และอาจคลาดเคลื่อนจากพฤติกรรมจริงบางกรณี

## ไฟล์ส่งมอบ

- `Vector-Magic-extracted-Contents.zip` — สำเนาไฟล์ภายใน bundle ที่แตกออกมา
- `Vector-Magic-file-inventory.csv` — path, ขนาด และ SHA-256 ของไฟล์ที่แตกได้
- `Vector-Magic-pseudocode.zip` — pseudocode ทั้ง 6 ฟังก์ชัน
- โฟลเดอร์ `Vector-Magic-pseudocode/` มีไฟล์ pseudocode แยกตามฟังก์ชัน

ไฟล์ ZIP ที่แตกออกมาเป็นสำเนาสำหรับตรวจสอบ ไม่ใช่แอปที่พร้อมเปิดใช้งาน: ขั้นตอน REA extraction นี้ไม่ได้เก็บ symbolic links ไว้ครบ จึงคงแอปต้นฉบับไว้ตามเดิมและไม่ได้ทดลองเปิดแอป

## เครื่องมือ

ใช้ REA 6.7.0 และ Ghidra 12.1.4 พร้อม JDK 25 สำหรับการวิเคราะห์ Ghidra ดาวน์โหลดจากแหล่งทางการและตรวจ SHA-256 ก่อนใช้งาน ส่วนเครื่องมืออยู่ในโฟลเดอร์ scratch ของงาน ไม่ได้ติดตั้งแบบ global
