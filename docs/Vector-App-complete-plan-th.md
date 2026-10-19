# แผนสร้างแอปแปลงภาพเป็นเวกเตอร์คุณภาพสูง

> **เปลี่ยนเป้าหมายผลิตภัณฑ์แล้ว:** แผนนี้เป็นข้อมูลอ้างอิงด้านเอนจินและการวัดคุณภาพ แผนหลักปัจจุบันคือ [Vector Panel สำหรับ Adobe Illustrator](Illustrator-Vector-Panel-complete-plan-th.md)

วันที่ 19 ตุลาคม 2026 · แผนสำหรับ Mac ก่อน และเตรียมเอนจินให้ใช้บน Windows ได้

## 1. ข้อสรุปที่ทบทวนใหม่

เป้าหมายคือทำแอปที่ให้ **เส้นคม รูปทรงถูกต้อง และไฟล์แก้ต่อได้ง่าย** โดย beta แรกเน้นโลโก้ ไอคอน และภาพวาดสีแบน ภาพสแกน ภาพถ่าย และ gradient ต้องผ่านเกณฑ์ของตัวเองก่อนเปิดเป็นฟีเจอร์ที่รับรอง คำว่า “10/10” จะวัดแยกตามชนิดภาพ เพราะภาพ bitmap หนึ่งภาพอาจตีความเป็นเส้นเวกเตอร์ได้หลายแบบ ([Potrace: A Polygon-Based Tracing Algorithm](https://potrace.sourceforge.net/potrace.pdf))

จุดเริ่มที่เสนอคือ **Rust core และ VTracer 1.0 ที่ตรึงเวอร์ชันเป็นตัวเปรียบเทียบ/ตัวเร่งต้นแบบ** VTracer ระบุ pipeline ที่แยก segmentation, curve fitting, color fitting และ output optimization ได้ แต่รุ่น 1.0 ยังเป็น alpha; README ระบุด้วยว่ากลยุทธ์การซ้อนรูปร่างหลีกเลี่ยง shape ที่มีรู จึงยังไม่พิสูจน์ว่า API ภายในรองรับกราฟที่มีรู ขอบร่วม ID คงที่ และการคำนวณซ้ำเฉพาะส่วนตามที่ผลิตภัณฑ์ต้องการ ต้องตรวจ source/API และทำ spike สองวันก่อนตัดสินใจใช้เป็นเอนจินหลัก หากเปิดข้อมูลกลางไม่ได้ ให้ใช้เป็น baseline แล้วสร้าง pipeline ของเราเอง ([VTracer README](https://github.com/visioncortex/vtracer/blob/master/README.md), [Cargo.toml](https://github.com/visioncortex/vtracer/blob/master/Cargo.toml))

UI ยังเป็น **การตัดสินใจที่เปิดอยู่**: ทำต้นแบบ Tauri 2 + React/TypeScript และ Qt 6 ที่มีแคนวาส ภาระงาน และคุณภาพภาพเท่ากัน แล้วเลือกจากเกณฑ์ความลื่น การเลือก/แก้ path การส่งข้อมูลข้าม process และหน่วยความจำในระยะ 0 เอนจินเป็น Rust library/CLI ที่ไม่อ้าง UI หาก Qt ชนะ ต้องทำ Rust–C++ bridge, ผูก event/undo เข้ากับ scene และจัดทีม Qt เพิ่ม จึงเผื่อเวลาอีก 3–5 สัปดาห์หลัง prototype ([Tauri architecture](https://v2.tauri.app/concept/architecture/), [Qt Graphics View](https://doc.qt.io/qt-6/qgraphicsview.html))

## 2. ฐานที่ต้องชนะ

| สิ่งที่ทราบ | ผลต่อแผน |
|---|---|
| แอปที่ให้วิเคราะห์เป็น Mach-O Intel x86_64 ใช้ Qt 5.5.1; ถอด pseudocode ได้ 6 ฟังก์ชันเกี่ยวกับ palette, segmentation, contour และ Bézier | ใช้เป็นหลักฐานของลำดับงานและกรณีเปรียบเทียบ ไม่ถือว่าได้ซอร์สเดิมครบ ([รายงานการวิเคราะห์](Vector-Magic-analysis.md)) |
| เอกสาร Vector Magic Desktop ระบุ auto/advanced tracing, segmentation editing, batch, background removal, grouping by color, SVG/EPS/PDF/AI; DXF มีบน Windows และเอนจิน Desktop ต่างจาก Online | ฟีเจอร์เหล่านี้เป็นเส้นฐาน ต้องเทียบ Desktop และ Online แยกกัน ([Desktop Edition](https://vectormagic.com/desktop)) |
| Desktop สำหรับ Mac ระบุเพดาน 5 MP; คู่มือระบุการแยกภาพถ่าย ภาพวาดขอบฟุ้ง และภาพวาดขอบคม | ตั้งเป้ารองรับภาพใหญ่ขึ้นโดยไม่ลดความละเอียดเอง และมี pipeline แยกตามชนิดภาพ ([Desktop Edition](https://vectormagic.com/desktop), [คู่มือ](https://vectormagic.com/support/tutorials/how-to-use-vector-magic)) |
| ผู้ผลิตระบุว่า gradient ถูกแทนด้วยแถบสีคงที่ | gradient ที่เป็นรูปทรงเวกเตอร์จริงเป็นโอกาสของรุ่นถัดไป ([FAQ](https://vectormagic.com/support/faq)) |
| VTracer 1 มี cutout/shared boundaries, watershed, adaptive black-and-white, palette และ curve simplification แล้ว | สิ่งเหล่านี้ต้องอยู่ในชุดเปรียบเทียบ ไม่ควรนับเป็นนวัตกรรมของเรา ([VTracer README](https://github.com/visioncortex/vtracer/blob/master/README.md)) |
| VTracer 2 โฆษณาการทำงานด้วยโมเดลบนเครื่องและ gradient ที่ไม่แปลงเป็นแถบสี | gradient-native เป็นช่องว่างเมื่อเทียบ Vector Magic แต่ไม่ใช่ความสามารถที่ไม่มีคู่แข่ง; ต้องเปรียบเทียบกับ VTracer 2 เมื่อเข้าถึงได้ ([VTracer 2](https://vtracer.visioncortex.org/)) |

ฟังก์ชันของ Desktop ตามตารางข้างบนมาจากเอกสารผู้ผลิตปัจจุบัน ยังไม่ได้ยืนยันว่าตัว binary ที่แนบเป็นรุ่นเดียวกันทุกประการ โค้ดผลิตภัณฑ์ใหม่ควรเขียนขึ้นเองจากข้อกำหนดสาธารณะและผลทดสอบที่ทำซ้ำได้; pseudocode ที่ถอดได้ใช้เพื่อทำความเข้าใจลำดับงานและตั้งโจทย์เปรียบเทียบ

## 3. ขอบเขตผลิตภัณฑ์และประสบการณ์ผู้ใช้

**ผู้ใช้หลัก:** นักออกแบบโลโก้/แบรนด์, คนทำงานพิมพ์หรือเครื่องตัด, ผู้ดูแลคลังภาพเก่าหรือภาพสแกน และนักวาดที่ต้องส่งงานให้แก้ใน Illustrator, Inkscape หรือโปรแกรมเวกเตอร์อื่น

**ทางเดินหลัก:** วางไฟล์หรือ paste ภาพ → แอปเสนอ 2–3 ผลลัพธ์พร้อมรายละเอียด “เหมือนต้นฉบับ / เส้นสะอาด / จุดน้อย” → เลือกผล → เห็นจุดที่ควรตรวจ → แก้เฉพาะบริเวณ → ส่งออกงานตามปลายทาง

| ฟีเจอร์ที่ผู้ใช้เห็น | Beta สำหรับโลโก้/ภาพสีแบน | รุ่นเต็มระยะแรก | งานวิจัย/ระยะถัดไป |
|---|---|---|---|
| Import | PNG, JPEG, WebP, TIFF ตาม codec ที่ผ่านการทดสอบ; drag-and-drop, paste, transparency, ICC/EXIF | batch และ watch folder | RAW/HEIC/PSD ตามความต้องการจริง |
| ตั้งค่า | ตรวจชนิดภาพ, preset โลโก้/ไอคอน/ภาพวาดสีแบน, รายละเอียด, จำนวนสี, ความเรียบ, จำนวนจุด, ปกป้องมุมและสี | preset สำหรับงานพิมพ์/ตัด/เว็บและภาพสแกนเมื่อผ่านเกณฑ์ | คำแนะนำจากโมเดลเฉพาะภาพที่ยาก |
| ดูผล | ภาพต้นฉบับ/segmentation/vector แบบซูมพร้อมกัน, overlay, แผนที่จุดผิดพลาด, จำนวน path/node และคำเตือนรูหรือชิ้นส่วนหาย | รายงานงาน batch และเปรียบเทียบหลาย preset | แสดงความไม่แน่นอนของโมเดล |
| แก้ | ระบายรวม/แยกบริเวณ, ลบจุด, เติมรู, ลบพื้นหลัง, ลากจุด Bézier, undo/redo, autosave และประมวลผลซ้ำแบบปลอดภัย | จัดกลุ่มสี/เลเยอร์และเครื่องมือแก้หลายภาพ | แก้หลายส่วนด้วย suggestion ที่ผู้ใช้ยอมรับทีละรายการ |
| ส่งออก | SVG, PNG preview และ project file ที่เปิดแก้ต่อได้ | PDF, EPS/DXF เมื่อผ่านการตรวจความตรง | gradient-native SVG, plugin/workflow สำหรับโปรแกรมอื่น |

**หลักการ UI:** ค่าเริ่มต้นต้องทำงานได้ในหนึ่งคลิก; เครื่องมือระดับละเอียดปรากฏเมื่อผู้ใช้ต้องแก้ผลจริง คะแนนที่แสดงควรเป็นข้อเท็จจริง เช่น “มีรู 2 จุด”, “128 paths”, “บริเวณนี้คลาดเคลื่อน” แทนคะแนนสวยงามรวมที่อธิบายไม่ได้

| ความสามารถ | Vector Magic Desktop ตามเอกสารทางการ | ผลิตภัณฑ์ที่เสนอ |
|---|---|---|
| แปลงอัตโนมัติและปรับละเอียด | มีทั้ง auto/basic/advanced | มี preset 1 คลิก และตัวเลือกผล 2–3 แบบพร้อมจำนวน path/node |
| แก้ภาพก่อนแปลง | มี segmentation editing และลบพื้นหลัง | แปรงรวม/แยกบริเวณ, ปกป้องรู/มุม, undo และแผนที่บริเวณคลาดเคลื่อน |
| ภาพใหญ่และ batch | มี batch; Desktop Mac ระบุเพดาน 5 MP | beta วัด 4 MP; เป้ารุ่นเต็ม 20 MP โดยไม่ลดความละเอียดเอง และ batch หลังผ่าน benchmark |
| ส่งออก | SVG/EPS/PDF; AI บน Mac, DXF บน Windows | beta เน้น SVG ที่เปิดข้ามโปรแกรมได้; PDF ต่อมา; EPS/DXF เฉพาะเมื่อตรวจความตรงได้; ส่งเข้า Illustrator ผ่าน SVG/PDF |
| Gradient | ผู้ผลิตระบุว่าได้แถบสีคงที่ | gradient-native เป็นโครงการทดลองหลังโหมดสีแบนผ่านเกณฑ์ |

ตารางนี้เทียบกับ **เอกสาร Desktop รุ่นปัจจุบัน** ไม่ได้ยืนยันว่าทุกฟีเจอร์อยู่ใน binary ที่แนบ ([Desktop](https://vectormagic.com/desktop), [คู่มือ](https://vectormagic.com/support/tutorials/how-to-use-vector-magic), [FAQ](https://vectormagic.com/support/faq))

## 4. โครงสร้างระบบ

```text
ภาพนำเข้า
  → ถอดรหัสภาพ + EXIF + ICC + alpha
  → เลือกประเภทภาพและ preset
  → segmentation เป็น label map
  → region graph: ชิ้นส่วน รู จุดเชื่อม และขอบที่ใช้ร่วมกัน
  → วางขอบระดับ subpixel และรักษามุมสำคัญ
  → ฟิตเส้นตรง/เส้น Bézier ภายใต้งบจำนวนจุด
  → สร้าง vector scene และ SVG
  → render กลับหลายขนาด → วัด residual/topology
  → แก้เฉพาะบริเวณที่ผิด → ส่งออก
```

เอนจินเป็น `core` ที่เรียกจาก CLI และ desktop ได้เหมือนกัน ข้อมูลกลางเป็น `SourceImage` (พิกเซลกับสีต้นทาง), `TraceSettings`, `RegionGraph` (faces/holes/ขอบร่วม), `VectorScene` (อิสระจากรูปแบบ VTracer), `EditOperation` และ `QualityReport` แต่ละขั้นบันทึกผลแบบไม่แก้ทับและ cache ด้วย hash ของต้นฉบับกับ settings **การคำนวณซ้ำเฉพาะส่วนเป็นฟีเจอร์ระยะ 3 ที่ยังต้องพิสูจน์**: ต้องมี dependency key รายบริเวณ, ขยายพื้นที่ invalidation ถึงเพื่อนบ้านที่แชร์ขอบ, stitch แนวต่อ และเทียบผลกับการคำนวณใหม่ทั้งภาพทุกครั้งที่แก้ หากเทียบไม่ตรงให้ใช้ full recompute จนแก้กลไกนี้ได้

**จุดวิจัยสำคัญ:** เส้นแบ่งระหว่างสีสองสีควรเป็น edge เดียวที่ทั้งสองรูปทรงใช้ร่วมกันเพื่อลดช่องว่าง; รูและจำนวนชิ้นส่วนเป็นข้อจำกัดของ topology; ขอบที่มี antialiasing ต้องใช้ข้อมูลสีตามแนวขอบก่อนลดจำนวนสี คู่มือ Vector Magic ระบุว่าข้อมูลสีฟุ้งตรงขอบช่วยระบุตำแหน่งเส้นได้แม่นขึ้น ([คู่มือ Vector Magic](https://vectormagic.com/support/tutorials/how-to-use-vector-magic))

หลังฟิตเส้น ให้ render SVG กลับด้วย resvg แล้วเทียบกับภาพต้นฉบับที่ 1× และ 4× เพื่อวัด residual; การรับรองไฟล์ส่งออกต้องตรวจ XML/SVG และเปิดหรือ render ใน **browser กับ Inkscape ซึ่งเป็น implementation อิสระ** อีกด้วย การปรับ curve จะลดทั้งความคลาดเคลื่อนและจำนวนจุด โดยรักษา topology งานวิจัย differentiable rasterization สนับสนุนการปรับพารามิเตอร์เส้นจากภาพที่ render กลับ แต่การเปลี่ยน topology ยังเป็นปัญหาแยก จึงไม่ใช้ differentiable fitting แทน region graph ([diffvg paper](https://people.csail.mit.edu/tzumao/diffvg/diffvg.pdf), [AdaVec](https://openaccess.thecvf.com/content/CVPR2025/html/Zhao_Less_is_More_Efficient_Image_Vectorization_with_Adaptive_Parameterization_CVPR_2025_paper.html))

## 5. เทคโนโลยีที่เลือก และเงื่อนไขเพิ่มของ

| ชั้น | เลือกตอนเริ่ม | เหตุผล/เกณฑ์เพิ่ม |
|---|---|---|
| Desktop UI | ทดลอง [Tauri 2](https://v2.tauri.app/start/) + React/TypeScript/Canvas 2D และ [Qt 6 Graphics View/Quick](https://doc.qt.io/qt-6/qgraphicsview.html) แบบคู่กัน | เลือกจาก workload และ gate เดียวกัน; ถ้า Qt ชนะให้เพิ่ม Rust–C++ bridge, event/undo bridge และงบ 3–5 สัปดาห์ |
| Core/tracing | Rust core; [VTracer 1.0 alpha](https://github.com/visioncortex/vtracer/blob/master/README.md) ที่ pin tag/commit เป็น baseline ก่อน | จะใช้เป็นขั้น pipeline จริงก็ต่อเมื่อ API/source ให้เข้าถึงข้อมูล region/holes/shared edges และรักษา ID ตามเกณฑ์ spike; ไม่ผ่านให้เขียน graph pipeline เอง |
| อ่านภาพ/สี | [image-rs](https://github.com/image-rs/image) + [Little CMS 2](https://github.com/mm2/Little-CMS) ผ่านขอบเขต FFI เล็ก ๆ | decode ภาพและแปลง ICC อย่างสม่ำเสมอ; ตรวจ codec กับภาพจริงก่อนสัญญารองรับ |
| เส้นโค้ง/geometry | [kurbo](https://github.com/linebender/kurbo) + graph ที่เราออกแบบ | เก็บและคำนวณ Bézier; [Clipper2](https://github.com/AngusJohnson/Clipper2) เป็นโมดูล polygon boolean เมื่อเครื่องมือแก้ region ต้องใช้จริง |
| เลือกวัตถุ | [rstar](https://docs.rs/rstar/latest/rstar/struct.RTree.html) สำหรับดัชนีพื้นที่ | หา path/จุดใกล้เมาส์โดยไม่ไล่ตรวจทุก path ทุกครั้ง; เพิ่มใน UI prototype แล้ววัดเวลาเลือกจริง |
| render/ตรวจผล | [resvg/usvg](https://github.com/linebender/resvg) + [Rayon](https://github.com/rayon-rs/rayon) | render SVG กลับแบบทำซ้ำได้และประมวลผล CPU แบบขนาน |
| PDF | [krilla + krilla-svg](https://github.com/LaurenzV/krilla) หลัง spike ความตรงของ export | `svg2pdf` เดิมถูก archive ในปี 2026; ต้องตรวจ gradient, alpha, holes และนำเข้ากลับในแอปปลายทางก่อนเปิดฟีเจอร์ ([archive notice](https://github.com/typst/svg2pdf)) |
| ภาพใหญ่มาก | [libvips](https://github.com/libvips/libvips) เมื่อ memory/latency เกินเป้า | ให้ I/O แบบ demand-driven; เพิ่ม dependency หลัง benchmark |
| ML | [ONNX Runtime](https://onnxruntime.ai/docs/execution-providers/) + โมเดลที่มีสิทธิ์ใช้งานชัดเจน | เฉพาะ classification, mask หรือกู้เส้นที่ชนะ baseline บน holdout; ต้องมี CPU fallback |
| GPU | [Vello](https://github.com/linebender/vello) หรือ [wgpu](https://wgpu.rs/doc/wgpu/struct.Backends.html) เมื่อ profiling ชี้คอขวด | Vello CPU พร้อมใช้กว่าส่วน GPU ที่ยังพัฒนา; ทดลอง renderer GPU เฉพาะเมื่อ CPU ไม่ผ่าน gate จริง |
| งานทดลอง | [OpenCV](https://docs.opencv.org/5.0/), [Ceres](https://ceres-solver.readthedocs.io/latest/), [diffvg](https://github.com/BachiLi/diffvg) | ใช้ทำ prototype ของ segmentation, nonlinear fitting และ optimization; ย้ายเข้า shipping engine เฉพาะเมื่อผลวัดคุ้มต้นทุน |

**ทางเลือกสแตก:** งานวิจัยเทคโนโลยีอีกชุดเสนอ C++20 + Qt 6 + OpenCV + LittleCMS + Clipper2 + Eigen เพราะเครื่องมือแคนวาสและ C++ API ต่อกันตรงกว่า ([บันทึกเทคโนโลยี](Vector-App-technology-research.md)) ระยะ 0 จะเปรียบเทียบต้นแบบ Tauri และ Qt ที่ใช้ Rust core เดียวกัน หาก VTracer ไม่ผ่าน spike และงานภาพส่วนใหญ่พึ่ง OpenCV/Ceres ผ่าน FFI ให้ประเมิน C++ core ทั้งก้อนอีกครั้งก่อนสร้าง feature ระยะ 1 การย้าย core หลัง phase 1 มีต้นทุนสูง จึงต้องจบการตัดสินนี้ในระยะ 0

**สิทธิ์ใช้งานและการแจกจ่าย:** ตรวจ license ของ tag ที่ pin และ dependency ทั้งก้อนก่อนแจกจ่าย VTracer, Tauri, image-rs, kurbo, resvg และ Rayon ระบุ MIT/Apache หรือเงื่อนไขแบบ permissive ในแหล่งทางการ; LittleCMS ระบุ MIT; Clipper2 ระบุ BSL-1.0; libvips เป็น LGPL และ Potrace เป็น GPL/มีรุ่น Professional จึงใช้ Potrace เป็น baseline ภายนอกก่อน หากเลือก Qt ต้องตัดสิน commercial/LGPL และข้อกำหนดของทุกโมดูลที่แจกจริง การรวมโมเดล ML ต้องตรวจสิทธิ์ของ weights และชุดข้อมูลแยกจาก ONNX Runtime ([VTracer Cargo](https://github.com/visioncortex/vtracer/blob/master/Cargo.toml), [Tauri repo](https://github.com/tauri-apps/tauri), [Qt licensing](https://doc.qt.io/qt-6/licensing.html), [บันทึกเทคโนโลยี](Vector-App-technology-research.md))

## 6. ชุดทดสอบและนิยามผลลัพธ์ “ดีมาก”

สร้างชุดภาพที่มีสิทธิ์ใช้งานเริ่มต้น **450–650 ภาพ** แยกโลโก้/ไอคอน, ภาพวาดสีแบน, ลายเส้น/สแกน, ภาพวาดขอบฟุ้ง และภาพถ่าย/gradient โดยกัน holdout อย่างน้อย 150 ภาพต่อประเภทที่จะรับรองใน beta เพิ่มภาพที่สร้างจาก SVG ต้นทางซึ่งรู้จำนวนชิ้นส่วนและรูจริง แล้วจำลอง antialiasing, blur, JPEG, noise, ความโปร่งใสและความละเอียดต่ำ แบ่ง train/dev/holdout ตามเจ้าของงานหรือชุดต้นทางเพื่อไม่ให้ภาพคล้ายกันหลุดข้ามชุด และล็อก holdout ก่อนปรับอัลกอริทึม

รัน **Vector Magic Desktop, Vector Magic Online, VTracer 1 และ Potrace เฉพาะภาพสองสี** ด้วยภาพเดียวกัน; เพิ่ม VTracer 2 หากเข้าถึงเวอร์ชันทดสอบได้ ([VTracer 2](https://vtracer.visioncortex.org/), [Vector Magic Desktop](https://vectormagic.com/desktop)) ก่อนอ้างว่า “ชนะ Vector Magic” ต้องลองรัน binary ที่แนบและบันทึกเวอร์ชัน, OS/Rosetta, สิทธิ์ใช้งาน, preset, ค่า manual tuning และผลจริง หากรันไม่ได้ ให้ใช้ Desktop รุ่นทางการที่เข้าถึงได้เป็น comparator **โดยระบุชื่อ/เวอร์ชันให้ตรง** และห้ามอ้างว่าชนะ binary ที่แนบ Online เป็น comparator อีกตัวเพราะเป็นคนละเอนจิน ให้ผู้ใช้เชี่ยวชาญปรับแต่ละเครื่องมือด้วยเวลาที่เท่ากัน และเก็บไฟล์ผล/setting/revision ที่ทำซ้ำได้ **Desktop trial บันทึกผลไม่ได้ตามผู้ผลิต** จึงใช้เทียบภาพ preview ได้เท่านั้น; การเทียบจำนวน path, SVG และการแก้ไฟล์ต้องมีรุ่นที่ส่งออกได้จริง มิฉะนั้นให้ระบุว่าไม่ได้วัด ([Desktop trial](https://vectormagic.com/desktop))

| สิ่งที่วัด | วิธีวัด | เหตุผล |
|---|---|---|
| ความเหมือนหลัง render | SSIM/PSNR/LPIPS, ความต่างสี; เทียบที่ 1× และ 4× บนพื้นหลังอ่อน/เข้ม | ตรวจสี แสง และขอบจากผล SVG จริง; งาน SuperSVG ใช้ชุด metric ด้านภาพลักษณะนี้ ([paper](https://openaccess.thecvf.com/content/CVPR2024/papers/Hu_SuperSVG_Superpixel-based_Scalable_Vector_Graphics_Synthesis_CVPR_2024_paper.pdf)) |
| โครงสร้าง | จำนวนชิ้นส่วน รู จุดเชื่อม ช่องว่าง เส้นตัดตัวเอง และ edge distance | ภาพที่ดูคล้ายอาจใช้ตัดหรือแก้ไม่ได้; งาน topology-aware ชี้ความสำคัญของโครงสร้าง ([paper](https://scholars.cityu.edu.hk/en/publications/topology-and-perception-aware-image-vectorization/)) |
| ความแก้ไขง่าย | จำนวน path, จุดควบคุม, ขนาดไฟล์, เวลาแก้กรณีผิดโดยนักออกแบบ | งานวิจัยศึกษาความสัมพันธ์ของคุณภาพกับจำนวนรูปทรงและพารามิเตอร์ ([Optimize & Reduce](https://ojs.aaai.org/index.php/AAAI/article/view/27987), [AdaVec](https://openaccess.thecvf.com/content/CVPR2025/html/Zhao_Less_is_More_Efficient_Image_Vectorization_with_Adaptive_Parameterization_CVPR_2025_paper.html)) |
| ประสิทธิภาพ/ความเสถียร | p50/p95 เวลา, peak RAM, crash, cancel, ไฟล์ 4/20 MP | เห็นต้นทุนที่ผู้ใช้รับจริง โดยเฉพาะเมื่อจะชนะเพดาน Mac 5 MP ของ Desktop |
| ความพึงพอใจ | ทดสอบเลือกภาพแบบปิดชื่อ และให้ทำงานแก้ไฟล์จริง | ให้มนุษย์ตัดสินความสวยและประโยชน์ที่ metric ภาพจับไม่ครบ |

**เกณฑ์เสนอสำหรับออก beta:** แยกตัดสินโลโก้/ไอคอนกับภาพวาดสีแบน ประเภทละอย่างน้อย 150 ภาพ holdout จากอย่างน้อย 60 ต้นทาง/ตระกูลภาพ โดยจำกัดไม่เกิน 5 ภาพต่อตระกูล ผู้ประเมินที่ทำงานออกแบบจริง 3 คนต่อภาพ เห็นผล A/B แบบสุ่มด้านและไม่เห็นชื่อเครื่องมือ เลือก “A ดีกว่า / B ดีกว่า / ใกล้เคียงจนตัดสินไม่ได้” สำหรับการแก้ต่อและใช้งานจริง หนึ่งภาพได้ผลตามเสียงข้างมาก; ถ้าไม่มีเสียงข้างมากให้เป็นเสมอ คะแนนต่อภาพคือชนะ 1, เสมอ 0.5, แพ้ 0 เทียบกับแต่ละคู่แข่งแยกกัน (VTracer 1 และ Vector Magic Desktop เวอร์ชันที่รันได้) ค่าเฉลี่ยต้อง ≥0.60 และขอบล่างช่วงความเชื่อมั่น 95% จาก **cluster bootstrap ตามตระกูลภาพ** 10,000 ครั้งด้วย seed ที่ล็อกไว้ต้อง >0.50 รายงานสัดส่วนชนะ/เสมอ/แพ้และคะแนนรายคนด้วย ทุกคำกล่าวอ้างระบุชนิดภาพและคู่แข่งเฉพาะตัว; ไม่รวมหลายคู่เปรียบเทียบเป็นคะแนนเดียว เกณฑ์นี้เป็น **เป้าหมายที่เสนอ ยังไม่ใช่ผลทดลอง** ถ้า Desktop รันไม่ได้ จะไม่มีคำกล่าวอ้างว่าเหนือกว่า Desktop จนกว่าจะทดสอบได้

**เกณฑ์โครงสร้างและการส่งออก:** ภาพสังเคราะห์ canary อย่างน้อย 40 ภาพที่กำหนดรู/ชิ้นส่วน/รอยต่อชัดเจนต้องผ่าน 100%; รูหรือชิ้นส่วนสำคัญที่หายบน holdout ต้องไม่มากกว่า comparator ที่ตั้งค่าเทียบกัน SVG ต้องผ่าน XML parser, ตรวจ viewBox/หน่วย/alpha และเปิดได้ใน resvg, browser และ Inkscape โดยไม่มี path/รูหาย ตรวจภาพด้วย working space sRGB เดียวกัน; ความต่างขอบ antialiasing ระหว่าง renderer ให้ประเมินแยกจากความผิดของรูปทรง งาน Illustrator เป็นการตรวจเฉพาะกรณีก่อนแจกจ่าย ไม่ใช้ renderer ของเราเองเป็นหลักฐานเพียงตัวเดียว

**เกณฑ์สมรรถนะที่เสนอ (p95):** วัดบน Mac อ้างอิง Apple M2/RAM 16 GB โดย pin macOS, รุ่น compiler, สถานะพลังงานและชุดภาพ ภาพ 4 MP แสดง preview ≤5 วินาทีและ final ≤30 วินาที; ภาพ 20 MP ไม่ลดความละเอียดเอง, ไม่ crash, final ≤180 วินาที และ peak RAM ≤12 GB ทดสอบซ้ำอย่างน้อย 5 รอบต่อภาพและรายงาน p50/p95 ทั้งงานสำเร็จ/ล้มเหลว ตัวเลขเหล่านี้เป็นเป้าหมายการออกแบบ ไม่ใช่ผลที่วัดแล้ว; ระยะ 0 ต้องพิสูจน์ความเป็นไปได้และบันทึกการแก้เป้าหมายพร้อมเหตุผลก่อนล็อก beta

**เกณฑ์เลือก UI ในระยะ 0:** freeze ไฟล์ `VectorScene` 10k, 25k, 50k paths พร้อมสัดส่วนเส้นสั้น/ยาว จำนวนจุด fill/stroke และพื้นที่ทับกัน; ต้นแบบ Tauri และ Qt ใช้ไฟล์และคุณภาพภาพเดียวกันบน viewport 1440×900 ที่ scale 2×/จอ 60 Hz บน Mac อ้างอิงเดียวกัน บันทึก input trace 5 นาทีที่กำหนดเวลาและพิกัดของ pan/zoom, เลือก path, ลากจุด, brush, undo และ cancel ล่วงหน้า warm-up 30 วินาทีแล้วรัน trace 5 รอบ; วัด cold start แยก 5 รอบ เก็บเวลาทุก frame จาก input ถึง present และทุก event จาก input ถึง highlight, selection result, IPC/FFI พร้อมจำนวน dropped frames รายงาน p50/p95 **แยกแต่ละรอบและใช้ค่าที่แย่ที่สุดของ 5 รอบ** ที่ 25k paths ต้องได้ p95 frame time ≤33 ms, input-to-highlight ≤100 ms, ผลเลือก path ≤100 ms, peak RAM ของแอป ≤2 GB และส่งข้อมูลภาพ 4 MP พร้อม label map จาก core ถึง canvas ≤2 วินาที ที่ 50k paths ต้องไม่ค้าง/crash และ p95 frame time ≤50 ms ใช้ profiler แยกเวลา raster, hit-test, IPC/FFI และ React/Qt event loop ถ้าทั้งคู่ผ่านให้เลือกจากความง่ายในการแก้งานจริงและต้นทุนดูแล; หากไม่มีตัวไหนผ่านให้ทดลอง renderer เฉพาะแคนวาสก่อนเลือกสแตก

**เกณฑ์ความทนทานสำหรับ build แจกจริง:** รัน corpus อย่างน้อย 1,000 งานต่อเนื่องรวม batch ที่มีไฟล์เสียตั้งใจอย่างน้อย 20 ไฟล์ ต้องมี 0 process crash, 0 ไฟล์ผลที่เสียโดยไม่แจ้ง และรายการผลสำเร็จ/ล้มเหลวครบทุกไฟล์ ไฟล์เสีย/ขนาดผิด/ICC ผิดรูปอย่างน้อย 100 ตัวอย่างต้องแจ้งข้อผิดพลาดและไม่ค้าง ยกเลิกงานต้องรับคำสั่ง ≤500 ms และหยุด worker ≤2 วินาทีที่ p95; ไม่มีไฟล์ชั่วคราวค้างหลังเปิดใหม่ Autosave ต้องบันทึกภายใน 5 วินาทีหลังหยุดแก้, เปิดกู้คืนภายใน 30 วินาที และเสียงานไม่เกิน 5 วินาทีล่าสุดในการจำลองปิดผิดปกติ 100 ครั้ง รัน soak 8 ชั่วโมงโดย 0 crash และ RAM ไม่โตเกิน 20% เมื่อกลับสู่ scene ขนาดเดิม เก็บ crash-free session/job rate จริงหลัง beta โดยไม่ส่งภาพผู้ใช้ออกนอกเครื่องหากไม่ได้เลือกเอง

## 7. แผนส่งมอบและประตูตัดสินใจ

| ระยะ | เวลาโดยประมาณสำหรับทีม 4–6 คน | สิ่งที่ส่งมอบ | ผ่านเมื่อ |
|---|---:|---|---|
| 0 · พิสูจน์โจทย์ | 2–3 สัปดาห์ | สิทธิ์ของ corpus, comparator ที่ระบุเวอร์ชัน, VTracer API spike, CLI baseline, A/B rubric, Tauri/Qt canvas คู่กัน | บันทึกผล baseline ซ้ำ 3 รอบได้; ตัดสิน VTracer ใช้จริงหรือเป็น comparator; เลือก UI จากเกณฑ์ 25k/50k paths ใน §6; ลงผลตัดสินสแตกก่อน phase 1 |
| 1 · แอปที่แปลงได้ | 4–6 สัปดาห์ | core/CLI, import ICC/alpha/EXIF, tracing adapter หรือ pipeline ของเรา, Mac UI, SVG/PNG, project schema รุ่นแรก | ไฟล์ทดสอบ 50 ภาพที่ล็อกไว้เปิด แปลง บันทึกและเปิดโปรเจกต์กลับได้ครบ; 40 canaries รันและบันทึกความผิดพลาดครบ; SVG เปิดได้ใน resvg/browser/Inkscape; ไม่มีไฟล์เสียหรือข้อมูลแก้ไขหาย |
| 2 · คุณภาพรูปทรง | 8–12 สัปดาห์ | region graph, shared boundaries, subpixel edge, corner-aware Bézier, residual map | 40 canaries ผ่านครบ; ไม่มี seam จาก shared edge ในชุดนี้; ที่จำนวน node ไม่เกิน phase 1 เกิน 10% ค่า median edge distance บน holdout ดีขึ้นอย่างน้อย 10% และไม่เพิ่มรู/ชิ้นส่วนที่หาย |
| 3 · ผู้ใช้แก้งานได้ | 6–8 สัปดาห์ | merge/split brush, palette lock, point edit, local rerun หรือ full recompute fallback, undo/autosave | นักออกแบบ 5 คนทำงานแก้ที่ล็อกไว้คนละ 10 กรณีสำเร็จ ≥80% ภายใน 3 นาที/กรณี; undo/redo และเปิดโปรเจกต์กลับได้ผลเดิม; local rerun เท่ากับ full rerun หรือใช้ fallback |
| 4 · ขยายประเภทภาพ | 8–12 สัปดาห์ | โหมดภาพสแกน, gradient-native แบบทดลอง, photo stylization, ML เฉพาะจุดที่พิสูจน์ได้ | เปิดเป็นโหมดรับรองทีละชนิดเมื่อมี holdout ≥150 ภาพ/ชนิด และผ่านเกณฑ์ A/B, topology, เวลาแยกจาก beta; CPU fallback ทำงาน; โหมดโลโก้เดิมไม่ถอย |
| 5 · พร้อมแจกจ่าย | 4–6 สัปดาห์ | batch, PDF และ format ที่ผ่าน spike, Windows, accessibility, crash recovery, installer/update | ผ่านเกณฑ์คุณภาพ/ความเร็ว/ความทนทานทั้งหมดใน §6 บน build ที่แจกจริง; ไฟล์ SVG/PDF เปิดใน Inkscape และ Illustrator โดยไม่มีรูปทรงสำคัญหาย; sign/notarize macOS สำเร็จ |

เวลาข้างต้นเป็น **ประมาณการการวางแผน** ไม่ใช่สัญญาส่งมอบ รวมประมาณ 8–12 เดือนเมื่อทำหลายสายงานคู่ขนาน; ทำคนเดียวอาจใช้ 18–30 เดือนขึ้นไป หาก Qt ชนะ prototype ให้เผื่อเพิ่ม 3–5 สัปดาห์สำหรับ bridge/scene/undo; หากต้องเปลี่ยน core เป็น C++ ให้ประเมินระยะ 1–5 ใหม่ก่อนผูกมัดกำหนดส่ง หากทรัพยากรจำกัดให้ส่งระยะ 0–3 เป็น beta ที่เก่งด้านโลโก้/ไอคอนและภาพวาดสีแบนก่อน

## 8. ทีมและงานคู่ขนาน

- วิศวกร computer vision/geometry 2 คน: segmentation, graph, curve, optimization
- วิศวกร desktop/frontend 1–2 คน: canvas, tools, import/export, accessibility
- วิศวกรระบบ/QA 1 คน: benchmark, pipeline ทดสอบ, packaging, crash/performance
- นักออกแบบกราฟิกที่ใช้เครื่องมือจริงแบบ part-time: คัดภาพและตัดสินผลแบบปิดชื่อ

ใช้ CI บน Mac และ Windows ที่ pin เครื่องมือและ dependency, เก็บภาพ corpus ที่มีสิทธิ์ใช้พร้อม provenance, ทำตาราง dependency/license ของ build จริง, รัน regression ของ SVG และภาพ render กลับทุก release แอปประมวลผลภาพบนเครื่องเป็นค่าเริ่มต้น; telemetry และการส่งภาพออกนอกเครื่องต้องเป็นตัวเลือกที่ผู้ใช้รู้และเลือกเอง

## 9. ความเสี่ยงที่ต้องพิสูจน์ก่อนลงทุนหนัก

1. **ผลดีเพราะใช้ path มากเกิน:** ดูเส้นกราฟคุณภาพเทียบจำนวน path/node; ถ้าคุณภาพเพิ่มแต่แก้ไม่ได้ให้ปรับ optimization
2. **กราฟรูปทรงพัง:** ตรวจรู ชิ้นส่วนและ shared edge ก่อนและหลังการแก้ทุกครั้ง; กรณีไม่แน่ใจให้แสดงคำเตือน
3. **แคนวาสช้ากับเอกสารใหญ่:** ตัดสิน Tauri/Qt จากต้นแบบคู่กันในระยะ 0; การย้าย UI ต้องรวมต้นทุน Rust–C++ bridge, event/undo และทักษะทีมไว้ในกำหนดส่ง
4. **ภาพถ่ายไม่มีคำตอบเดียว:** กำหนดเป็นโหมด stylization ที่ผู้ใช้เลือกสไตล์ แยกจากโหมด faithful logo
5. **ไลบรารี alpha หรือสิทธิ์ซับซ้อน:** pin รุ่น, มี adapter, สร้าง SBOM และทดสอบ build แจกจ่าย; ไม่รวม Potrace ใน binary ปิดซอร์สโดยอัตโนมัติ ฟังก์ชัน fitting ของ kurbo มีรายงานกรณีผิดพลาด/ค้าง จึงต้องทดสอบ contour ที่เป็นเศษแหลมและเล็กมากก่อนใช้เป็นเกณฑ์คุณภาพ ([kurbo issues](https://github.com/linebender/kurbo/issues))
6. **ไฟล์ส่งออกดูดีเฉพาะในแอปเรา:** ตรวจ XML แล้วเปิดใน browser/Inkscape ตั้งแต่ระยะ 1 และ Illustrator ก่อนแจกจ่าย; ตรวจ DPI, viewBox, alpha, gradient, holes และ units

## 10. ทะเบียนการตัดสินใจที่ยังเปิดอยู่

| เรื่อง/เจ้าของ | ทางเลือก | หลักฐานที่ต้องมีและเกณฑ์ตัดสิน | กำหนด |
|---|---|---|---|
| D01 · VTracer หรือ graph pipeline ของเรา / หัวหน้า vision | ใช้ VTracer เป็นขั้นจริง หรือ comparator เท่านั้น | ตรวจ source/API กับ 20 ภาพต่างชนิด: ดึง label/region ก่อน fit, แสดง holes/shared edges, ใส่ segmentation/curve fitting ของเรา, สร้าง ID ที่ทำซ้ำได้ หากขาดข้อใดหรือจำเป็นต้อง fork ส่วนใหญ่ของโค้ด ให้ใช้เป็น comparator และเขียน graph ของเรา | วันที่ 2 |
| D02 · Tauri หรือ Qt / หัวหน้า desktop | React/Canvas, Qt Graphics View/Quick, หรือ renderer แยก | ต้นแบบสองตัวใช้ scene และ input trace เดียวกัน; gate p95 ของ §6 พร้อม profiler; งานเลือก/แก้ 5 ขั้นโดยผู้ใช้จริง ถ้าทั้งคู่ผ่าน เลือกตัวที่มีต้นทุนดูแลและการแจกจ่ายต่ำกว่า; ถ้า Qt ชนะให้เพิ่มคน C++/Qt และเวลา bridge 3–5 สัปดาห์ | วันที่ 10 |
| D03 · Rust หรือ C++ core / หัวหน้าวิศวกรรม | Rust ล้วน, Rust + FFI บางส่วน, C++20 core | หลัง VTracer spike วัด trace 4/20 MP: หาก dependency C++ ที่อยู่ใน hot path และ buffer copy/FFI เพิ่มเวลามากกว่า 15% หรือบังคับให้เขียนอัลกอริทึมหลักซ้ำสองภาษา ให้ทำ spike C++ core และเลือกก่อน phase 1; บันทึกผล build/สิทธิ์ Qt ทุกโมดูล | วันที่ 14 |
| D04 · คู่เปรียบเทียบ / หัวหน้า QA | binary ที่แนบ, Desktop รุ่นทางการ, Online แยก | รัน binary ที่แนบได้จริงพร้อมเวอร์ชัน/การตั้งค่า จึงอ้างผลกับมันได้; หากรันไม่ได้ให้ระบุ comparator รุ่นทางการตามจริงและไม่มีคำกล่าวอ้างถึง binary ที่แนบ | วันที่ 7 |
| D05 · ขอบเขต beta / เจ้าของผลิตภัณฑ์ | โลโก้/ไอคอนและภาพสีแบน; สแกนเป็น pilot | ประกาศรองรับเฉพาะประเภทที่มี holdout ≥150 ภาพและผ่าน gate §6; ภาพสแกนต้องมีเกณฑ์/ผลของตัวเองก่อนใช้คำว่า “รองรับ” | ก่อนเปิด beta |

รายการข้างบนเป็นสมมติฐานที่ต้องปิดด้วยผลทดลอง ไม่ใช่ข้อสรุปจากลิงก์เอกสารเพียงอย่างเดียว [ทะเบียนการตัดสินใจแบบ TSV](Vector-App-decision-register.tsv) เก็บ ID, เจ้าของ, สถานะ, วันครบกำหนด, ทางเลือก, เกณฑ์, สิ่งที่ต้องรอก่อน, สิ่งที่ถูกแทน และที่อยู่ผลทดลองเป็นช่องแยก; เมื่อผลออกให้ใส่ artifact ที่ตรวจได้ บันทึกเหตุผลและประวัติการเปลี่ยนแบบ append-only ใน [decision log](Vector-App-decisions.tsv) ซึ่งเป็นคนละหน้าที่กับทะเบียนสถานะปัจจุบัน

## 11. สิ่งที่ทำใน 14 วันแรก

1. **วันที่ 1–2:** รวบรวมภาพ spike ที่มีสิทธิ์ใช้ 30–50 ภาพ; pin VTracer commit; อ่าน API/source และทำ 20-case graph contract spike ตาม §10; สรุปว่าใช้เป็นเอนจินจริงหรือ comparator
2. **วันที่ 1–7:** ทดลองรัน binary ที่แนบโดยบันทึกระบบ/เวอร์ชัน/setting และข้อจำกัด; ตั้งตัวเปรียบเทียบ Desktop รุ่นทางการ/Online แยกตามผลที่รันได้ สร้าง harness ที่เก็บภาพผล, SVG, เวลา, RAM และ error ไม่ปะปนกัน
3. **วันที่ 3–8:** สร้าง `vector-core`, `vector-cli`, `VectorScene`/project schema รุ่นแรกที่ไม่ผูกกับ VTracer; เริ่ม corpus และ 40 topology canaries; เขียน export smoke check ที่เปิด SVG ด้วย resvg/browser/Inkscape
4. **วันที่ 4–10:** ทำต้นแบบ Tauri และ Qt บน scene เดียวกันที่ 10k/25k/50k paths; วัด pan, zoom, selection, brush, undo, cancel, IPC/FFI และ memory ตาม §6
5. **วันที่ 11–14:** ตรวจ FFI/hot-path เพื่อเลือก Rust/C++ core; สรุป 20 กรณีที่ผลแพ้; ทำ A/B rubric และล็อก holdout ก่อนปรับคุณภาพ; ลงมติสแตกและกำหนดส่งระยะ 1–3 จากผลจริง

ผลลัพธ์หลัง 14 วันคือ **baseline ที่ทำซ้ำได้, สแตกที่ตัดสินด้วยข้อมูล, contract ของ region graph, ชุดวัดคุณภาพ และความเสี่ยงที่ระบุเจ้าของ** จากนั้นจึงอนุมัติงบระยะ 1–3 ตามเวลาที่วัดได้
