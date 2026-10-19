# แผนสร้าง Vector Panel สำหรับ Adobe Illustrator

วันที่ 19 ตุลาคม 2026 · สถานะ: แผนผลิตภัณฑ์และเกณฑ์พิสูจน์ก่อนเริ่มสร้าง · เป้าหมายแรก: Illustrator 2026 บน Mac

เอกสารนี้แทน [แผนแอปเดสก์ท็อปเดิม](Vector-App-complete-plan-th.md) ในฐานะแผนผลิตภัณฑ์หลัก เอนจินแปลงภาพและเกณฑ์คุณภาพบางส่วนยังใช้ต่อ แต่ Illustrator จะเป็นหน้าต่างทำงาน แคนวาส ระบบเลเยอร์ ระบบ Undo และที่เก็บไฟล์งาน ไม่ต้องสร้างแอป Tauri/Qt แยกเพื่อให้ได้ผลลัพธ์แรก

## 1. ผลลัพธ์ที่ผู้ใช้ต้องได้

ผู้ใช้เลือกภาพ raster ที่วางอยู่ในเอกสาร Illustrator → เปิด Panel → เลือกแนวทางแปลงและดูตัวอย่าง → กด Apply → ได้กลุ่ม path และ compound path ที่เลือกจุด Bézier เปลี่ยนสี จัดเลเยอร์ และบันทึกในไฟล์ .ai ได้จริง ภาพต้นฉบับยังเก็บไว้เพื่อย้อนกลับหรือแปลงใหม่ การแปลงใหม่สร้างเวอร์ชันใหม่หรือแทนเฉพาะผลที่ยังไม่ถูกแก้ด้วยมือ; ห้ามทับงานแก้ของผู้ใช้เงียบ ๆ

**คุณค่าที่ต้องพิสูจน์:** โลโก้ ไอคอน และภาพสีแบนต้องรักษารู มุม และเส้นขอบได้ดี พร้อมทั้งใช้ anchor น้อยกว่าและใช้เวลาแก้งานจนพร้อมส่งสั้นกว่า Illustrator Image Trace ตามเกณฑ์ §8 เป้าหมายนี้เป็นข้อเสนอเชิงผลิตภัณฑ์ ยังไม่มีผล benchmark ยืนยัน

รุ่น beta เน้นงานที่ต้อง **เหมือนภาพต้นฉบับและแก้ต่อได้** ภาพสแกนซับซ้อน ภาพถ่าย และ gradient เชิงสร้างสรรค์จะเพิ่มเมื่อผ่านเกณฑ์แยก

## 2. ข้อเท็จจริงของแพลตฟอร์ม ณ วันนี้

ตรวจเครื่องนี้แล้วพบ Adobe Illustrator 2026 เวอร์ชัน **30.8.2** ใน /Applications/Adobe Illustrator 2026/Adobe Illustrator.app การตรวจนี้ยืนยันว่าติดตั้งแอปไว้ ไม่ได้ยืนยันว่า CEP Panel, UXP หรือการนำเข้า SVG ของรุ่นนี้ทำงานตามที่แผนต้องการ

| ทางเลือก | สถานะและหน้าที่ |
|---|---|
| **CEP Panel** | ช่องทางสร้าง Panel ที่ใช้ได้ใน Illustrator ปัจจุบัน: Adobe ระบุ host ID เป็น ILST, Panel แบบ HTML/CSS/JavaScript และการเรียก ExtendScript ผ่าน CSInterface.evalScript; ต้องทดสอบกับ 30.8.2 ที่ติดตั้งจริง ([CEP 12 Cookbook](https://github.com/Adobe-CEP/CEP-Resources/blob/master/CEP_12.x/Documentation/CEP%2012%20HTML%20Extension%20Cookbook.md), [Illustrator Developer](https://developer.adobe.com/illustrator/)) |
| **Illustrator C++ SDK** | ทางเลือกสำหรับอ่านพิกเซลของ embedded raster หรือสร้าง native art เมื่อ ExtendScript ทำได้ไม่ครบ/ช้า; เพิ่มเฉพาะเมื่อ host spike ชี้ว่าจำเป็น ([Illustrator Developer](https://developer.adobe.com/illustrator/)) |
| **Illustrator UXP Panel** | Adobe ประกาศ public beta ภายในฤดูใบไม้ผลิ 2027 จึงยังไม่ใช้เป็นข้อกำหนดของรุ่นที่สร้างตอนนี้; เมื่อ beta ออกต้องตรวจ API และสิทธิ์จริงอีกครั้ง ([Adobe transition announcement](https://blog.developer.adobe.com/en/publish/2026/09/investing-in-the-future-of-creative-cloud-extensibility-uxp-comes-to-our-flagship-applications)) |

Adobe ระบุว่าจะหยุดรับ CEP plugin ใหม่ของ Illustrator ใน Marketplace และปิด CEP โดยค่าเริ่มต้นในเดือนธันวาคม 2028; CEP จะหายจาก Creative Cloud รุ่นใหม่ตั้งแต่ธันวาคม 2029 แต่ ExtendScript ไม่ได้รับผลจากการเปลี่ยนผ่านนี้ ดังนั้น CEP เป็นสะพานสำหรับผลิตภัณฑ์ระยะใกล้ และต้องเตรียมการย้าย Panel ไป UXP เป็นงานแยก ([ประกาศ Adobe](https://blog.developer.adobe.com/en/publish/2026/09/investing-in-the-future-of-creative-cloud-extensibility-uxp-comes-to-our-flagship-applications))

**ข้อจำกัดสำคัญ:** คำสั่ง ExtendScript ที่ CEP เรียกทำงานบน main thread ของ Illustrator งาน trace ต้องอยู่ใน worker ภายนอก และคำสั่งกับ host ต้องสั้น การส่งพิกเซลหรือ path หลายหมื่นจุดผ่านข้อความ evalScript โดยตรงไม่ใช่รูปแบบที่แผนนี้เลือก ([CEP 12 Cookbook](https://github.com/Adobe-CEP/CEP-Resources/blob/master/CEP_12.x/Documentation/CEP%2012%20HTML%20Extension%20Cookbook.md))

## 3. คู่เทียบและจุดต่างที่ควรสร้าง

**คู่เทียบอันดับหนึ่งคือ Illustrator Image Trace ในรุ่นที่ติดตั้ง** ไม่ใช่ Vector Magic อย่างเดียว Adobe ระบุว่า Enhanced Presets ของ Image Trace รองรับ gradient, shape, transparency และ auto grouping แล้ว; เมื่อ Expand จะกลายเป็น grouped editable paths มีตัวเลือก abutting/overlapping และแสดงจำนวน paths/anchors/colors ([Image Trace options](https://helpx.adobe.com/illustrator/desktop/manage-objects/traces-mockups-symbols/image-trace-panel-options.html), [การแก้ผลหลัง Expand](https://helpx.adobe.com/illustrator/desktop/manage-objects/traces-mockups-symbols/edit-image-trace-results.html))

| สิ่งที่วัด | Illustrator Image Trace | Vector Magic Desktop | Panel ที่เสนอ |
|---|---|---|---|
| แปลงแล้วแก้ใน Illustrator | Expand แล้วได้ grouped paths | ส่งออกแล้วนำเข้า Illustrator | Apply แล้วได้กลุ่ม native editable paths บนเอกสารเดิม |
| ความถูกต้องของรู/มุม/ขอบ | ต้องวัดบนภาพเดียวกัน | ต้องวัดด้วยรุ่นที่รันได้ | ตรวจ topology และชี้จุดคลาดเคลื่อนให้แก้เฉพาะส่วน |
| จำนวนจุดและเวลาแก้ | มีตัวเลข anchors และ Simplify | ต้องมีผลส่งออกจริงจึงวัดได้ | วัดคุณภาพเทียบ anchor budget และเวลาที่นักออกแบบใช้แก้ |
| Gradient, shape, transparency | มีแล้วใน Enhanced Presets | ความสามารถขึ้นกับรุ่น | ไม่อ้างสิ่งเหล่านี้เป็นนวัตกรรม; เพิ่มเมื่อทำได้ดีกว่าในงานเป้าหมาย |

Vector Magic Desktop และ [VTracer 1](https://github.com/visioncortex/vtracer/blob/master/README.md) ยังเป็นคู่เทียบอัลกอริทึม แต่คำกล่าวว่า Panel “ดีกว่า” ต้องผูกกับ **Illustrator Image Trace Enhanced** เป็นหลัก [แอป Vector Magic ที่แนบ](Vector-Magic-analysis.md) เคยถูกวิเคราะห์แบบ static เท่านั้น ยังไม่เคยรันเพื่อวัดคุณภาพจริง

## 4. ประสบการณ์ใช้ Panel

1. **Select:** ผู้ใช้เลือก placed/linked raster หรือ embedded raster บน artboard Panel แสดงขนาด สี โปรไฟล์ ตำแหน่ง และสิ่งที่รองรับ ทั้งสองชนิดเป็นเงื่อนไขของ beta; Browse เลือกไฟล์ต้นฉบับใช้ช่วยกู้กรณีไฟล์เสียหรือ source link ขาด ไม่ใช่ทางทดแทนความสามารถอ่าน embedded raster
2. **Trace:** เลือก Faithful Logo, Clean Icon หรือ Flat Illustration ปรับจำนวนสี รายละเอียด ความคมมุม ความเรียบ และงบ anchor ตั้งสีจาก swatches ในเอกสารได้เมื่อ host API ผ่านการทดลอง
3. **Preview:** เปรียบภาพต้นฉบับ/เวกเตอร์/แผนที่ความคลาดเคลื่อนใน Panel; preview บน artboard เป็นชั้นชั่วคราวได้ต่อเมื่อพิสูจน์ว่าลบสะอาดและไม่ทำเอกสารเสีย ผู้ใช้ดูจำนวน path/anchor และคำเตือนรูที่อาจหายก่อน Apply
4. **Apply:** สร้างกลุ่มที่ตั้งชื่อไว้บน layer/ตำแหน่งที่ผู้ใช้เลือก รักษา scale, rotation, alpha และลำดับซ้อน ภาพต้นฉบับเก็บไว้เป็น reference แบบกู้คืนได้ ผู้ใช้แก้ path ด้วยเครื่องมือ Illustrator ปกติ
5. **Re-trace:** ผูกกลุ่มผลกับ source ID, source fingerprint, result ID/fingerprint, engine version และ settings ที่บันทึกในไฟล์ .ai ได้ เมื่อขอแปลงใหม่ให้สร้างเวอร์ชันใหม่โดยค่าเริ่มต้น ถ้าต้นฉบับหรือผลเก่าถูกแก้ด้วยมือ ให้แสดงความเปลี่ยนแปลงและสร้างเวอร์ชันใหม่ ห้ามทับผลเก่าเงียบ ๆ

**ขอบเขต beta:** เลือกหนึ่งภาพ → preview → Apply เป็น native art → แก้ใน Illustrator → Undo/Re-trace อย่างปลอดภัย รายการ batch, gradient-native, การวาด mask บน artboard และการแปลงภาพถ่ายเป็นงานระยะถัดไป โดยเฉพาะการวาด mask บน artboard อาจต้องใช้ C++ custom tool ไม่ควรสัญญาจาก CEP Panel เพียงอย่างเดียว

## 5. สถาปัตยกรรมและข้อมูลที่ส่งข้ามชั้น

    Illustrator document และ selection
        ↕ คำสั่งสั้น/ผลลัพธ์ขนาดเล็ก
    CEP Panel (TypeScript UI + CSInterface)
        ↕ HostAdapter ของ Illustrator ผ่าน ExtendScript
        ↕ JobBroker เรียก worker และติดตาม progress/cancel
    Rust vectorization worker (CLI; core ไม่มี dependency ต่อ CEP)
        → preview raster + VectorScene/SVG + QualityReport
        → HostAdapter นำผลเข้า Illustrator เป็น native grouped art

**ข้อมูลกลางที่ต้องมี:** SelectionSnapshot (document/source ID, bounds, transform, layer, color mode, source hash), TraceRequest (preset/settings/version), TraceResult (path ไปยัง preview และ scene, report), ApplyResult (group ID และ source ID) ให้บันทึก schema version และ job ID ทุกครั้งก่อนข้าม process Panel ไม่เก็บ path arrays ขนาดใหญ่ใน evalScript; ใช้ไฟล์ชั่วคราวหรือ IPC ที่ทดสอบแล้ว และล้างเฉพาะไฟล์ของ job ตัวเอง

**การนำเข้าภาพ:** linked raster อาจใช้ไฟล์ต้นทางโดยตรง แต่ต้องยืนยันว่าพิกเซลและ crop/transform ที่ผู้ใช้เห็นตรงกับสิ่งที่ส่งให้ worker ส่วน embedded raster, clipping mask, effect, RGB/CMYK และภาพหมุนหรือเอียงต้องทดลองกับ host จริง หาก ExtendScript ดึงพิกเซล embedded ไม่ครบ ต้องพิสูจน์ C++ SDK adapter กับเกณฑ์เดียวกันก่อนเข้าระยะ 1; หากยังไม่ผ่านให้เลื่อน beta และปรับขอบเขตหลังทบทวนกับผู้ใช้ ไม่ถือว่า Browse ทำให้ gate นี้ผ่าน

**การใส่ผลลงเอกสาร:** ทดลองอย่างน้อยสามวิธีด้วยไฟล์เดียวกัน: เปิด SVG ในเอกสารชั่วคราวแล้วคัดลอก native art, Place/Embed SVG, และสร้าง PathItem/CompoundPathItem ผ่าน JSX เปรียบเทียบความแก้ไขได้จริง ความถูกต้องของรู สี transform/layer/stacking, เวลา และ Undo หากวิธี script ไม่ผ่าน ให้ทำ C++ SDK spike ก่อนสร้างฟีเจอร์คุณภาพต่อ

**ความปลอดภัยของเอกสาร:** worker ไม่แก้เอกสารโดยตรง ก่อน Apply ให้ตรวจว่า document/source ID ยังตรงกับ snapshot ถ้าผู้ใช้สลับเอกสารหรือเปลี่ยนภาพให้หยุดและขอเลือกใหม่ ผลลัพธ์ต้องสร้างแบบ atomic: ล้มเหลวหรือ cancel แล้วภาพต้นฉบับยังอยู่ ไม่มีครึ่งกลุ่มค้าง คำสั่ง JSX ต้องมีชนิดที่กำหนดไว้ล่วงหน้าและส่ง opaque ID/ข้อมูลที่ escape แล้ว ไม่ประกอบสคริปต์จากข้อความผู้ใช้ การบันทึก .ai ใช้ระบบของ Illustrator; ต้องพิสูจน์วิธีเก็บ metadata Re-trace ที่เดินทางไปพร้อมไฟล์ .ai และตรวจ fingerprint ก่อนเขียนทับ art

**ขอบเขตเอนจิน:** decode/ICC/alpha → segmentation → region graph ที่รักษารู/ขอบร่วม → fit เส้นและมุม → ลด anchor โดยคุมความคลาดเคลื่อน → render-back ตรวจคุณภาพ → scene output ใช้ [VTracer 1](https://github.com/visioncortex/vtracer/blob/master/README.md) เป็น baseline/ตัวเร่งต้นแบบเฉพาะเมื่อ API เปิดข้อมูลกลางที่ต้องใช้; หากไม่ผ่านให้สร้าง graph pipeline ของเรา เอนจิน Rust/CLI ยังมีประโยชน์ต่อ benchmark และการย้าย UI ไป UXP ภายหลัง

## 6. เทคโนโลยีที่ใช้ตามหน้าที่

| ชั้น | ตัวเลือกเริ่มต้น | เงื่อนไข |
|---|---|---|
| Panel วันนี้ | CEP runtime ที่ Illustrator รุ่นเป้าหมายรายงาน, CSXS manifest host ILST, TypeScript + React หรือ UI เบา, CSInterface.js | ใช้คู่มือ CEP 12 เป็นจุดเริ่ม แต่ต้องตรวจ runtime/Chromium/Node จริงใน 30.8.2 ก่อนล็อก build และ UI ([CEP 12 Cookbook](https://github.com/Adobe-CEP/CEP-Resources/blob/master/CEP_12.x/Documentation/CEP%2012%20HTML%20Extension%20Cookbook.md)) |
| Host commands | ExtendScript/JSX เป็นชุดคำสั่งเล็กแบบ whitelist | Selection, metadata, preview/commit, Undo; ห้ามทำ trace ใน main thread |
| งานหนัก | Rust worker/CLI ที่เรียกจาก CEP process API หรือ Node integration | ทดลอง spawn, progress, cancel และการติดตั้งจริง; ไม่พึ่ง native Node module ของ CEP |
| ภาพและสี | image-rs, LittleCMS 2 | ตรวจ ICC/alpha ระหว่าง input, preview และ RGB/CMYK document |
| Geometry/trace | VTracer 1 เป็น baseline; kurbo + graph ของเราเมื่อจำเป็น | Graph/scene เป็นชนิดข้อมูลของเรา แยกจาก API ของ VTracer |
| Preview/QA | resvg/usvg, Rayon, corpus และ renderer ของ Illustrator | SVG ใน Panel เป็นทางผ่าน; ผลสุดท้ายต้องตรวจ native art ใน Illustrator |
| Host native ขั้นสูง | Illustrator C++ SDK adapter | ใช้เมื่อ embedded pixels, atomic import หรือ performance ผ่าน JSX ไม่ได้ ([Illustrator Developer](https://developer.adobe.com/illustrator/)) |
| Panel รุ่นถัดไป | Illustrator UXP adapter หลัง public beta | ต้องพิสูจน์ selection, art commit และ transport ถึง worker แบบครบวงจร; UXP Hybrid ที่ Adobe อธิบายปัจจุบันยังไม่ระบุ Illustrator ([UXP Hybrid](https://developer.adobe.com/uxp/guides/how-to/hybrid-plugins/)) |

**UXP bridge ไม่ใช่การเปลี่ยนชื่อ CEP bridge:** เอกสาร UXP ของ Adobe ระบุว่า shell.openPath() ส่ง argument ให้โปรแกรมหรือรับ output กลับไม่ได้ และการเรียก external process ต้องขอสิทธิ์ จึงใช้วิธีนี้แทน CEP Node child process แบบเดิมไม่ได้ ต้องรอ Illustrator UXP beta แล้วทดลองช่องทางที่แพลตฟอร์มอนุญาตจริง เช่นบริการ local ที่มีการยืนยันตัวตนและตอบ progress/cancel ได้ โดยวัด round trip และตรวจข้อกำหนดการแจกจ่ายก่อนเลือก ([UXP external process](https://developer.adobe.com/uxp/guides/how-to/recipes/external-process/))

**เหตุผลที่สแตกเปลี่ยนจากแผนเดสก์ท็อป:** Illustrator มีแคนวาส เครื่องมือแก้ path และ Undo อยู่แล้ว จึงไม่ต้องใช้ Qt/Tauri เพื่อสร้างสิ่งเหล่านี้ซ้ำ Rust worker เป็นตัวเลือกเริ่มต้นเพื่อใช้ VTracer baseline และแยกงานหนักออกจาก host แต่ยังเป็นสมมติฐานทางวิศวกรรม ถ้า P08 พบว่า topology/curve fit ต้องพึ่ง OpenCV, Clipper2, Eigen หรือ Ceres มาก ให้เทียบต้นทุน Rust FFI กับ C++ worker บนกรณีจริงก่อนล็อกภาษา; [งานวิจัยเดสก์ท็อปเดิม](Vector-App-technology-research.md) ไม่ใช่รายการ dependency ที่จะติดตั้งทั้งหมด

**การแจกจ่าย:** CEP extension ต้องทำ ZXP ลงลายเซ็นและติดตั้งตามคู่มือ Adobe; ถ้ามี Rust helper แยก ต้องทดลอง code signing/notarization และวิธีติดตั้ง/อัปเดตบน Mac รวมถึง Windows ก่อน beta การยื่น Marketplace ต้องแจ้ง dependency ที่ผู้ใช้ต้องติดตั้ง ([Adobe ZXP guide](https://github.com/Adobe-CEP/Getting-Started-guides/blob/master/Package%20Distribute%20Install/readme.md), [Adobe distribution guidance](https://developer.adobe.com/developer-distribution/creative-cloud/docs/guides/best-practices)) สิทธิ์ของทุกไลบรารี/model weights ต้องตรวจจาก build ที่แจกจริง [งานวิจัยไลบรารี](Vector-App-technology-research.md) เป็นข้อมูลประกอบ ไม่ใช่ BOM ที่ล็อกแล้ว

## 7. ระยะ 0: พิสูจน์ความเป็น Extension ก่อนปรับคุณภาพ trace

ทำกับ Illustrator **30.8.2 ที่ติดตั้งจริง** บน Mac แล้วทำซ้ำบน Windows รุ่นที่กำหนดก่อนเปิด beta เก็บไฟล์ input/AI/SVG, วิดีโอหน้าจอ, เวลา, memory และบันทึกขั้นตอนที่ทำซ้ำได้

| การทดลอง | ผ่านเมื่อ / ทางออกถ้าไม่ผ่าน |
|---|---|
| CEP hello panel + selection | Panel เปิดจาก Illustrator, อ่านเอกสาร/ภาพที่เลือกได้, ตอบสนองต่อการเปลี่ยน selection โดยไม่ใช้ UXP ที่ยังไม่ public; ไม่ผ่านให้ตรวจ host/manifest/runtime ก่อนทำเอนจิน |
| Intake 20 linked + 20 embedded images | ครอบคลุม rotation, shear, clipping, alpha, หลาย artboard, RGB/CMYK; ดึงพิกเซล/สี/ขนาดและ transform ที่ใช้จริงโดยไม่เปลี่ยนเอกสาร; embedded ไม่ผ่านด้วย JSX ต้องพิสูจน์ C++ SDK บนชุดเดียวกันก่อนเข้าระยะ 1 |
| Worker และการยกเลิก | ภาพ 4 MP ส่งถึง worker + รับผลควบคุม p95 ≤2 วินาที (ไม่รวม trace); Panel ยังคลิกได้; รับ cancel ≤500 ms, worker หยุด ≤2 วินาที p95; ไม่ผ่านให้เปลี่ยน bridge |
| Apply ผล 20 scenes | มี path/compound path ที่เลือกและขยับ anchor ได้จริง ไม่ใช่ linked/embedded preview; bounds ต่างจากตำแหน่งคาดหมาย ≤0.5 pt, รู/alpha/สี/layer/z-order ถูก, Undo หนึ่งครั้งคืนเอกสารก่อน Apply; ทำ 10k-path อย่างน้อย 20 รอบให้ Apply p95 ≤5 วินาทีและ UI ไม่ค้างต่อเนื่อง >500 ms; 50k-path เป็น stress diagnostic ต้องไม่ crash หรือทิ้ง art ครึ่งงาน แต่เวลาเป็นข้อมูลเพื่อกำหนดเพดานงาน; ไม่ผ่าน gate 10k ให้พิสูจน์ C++ SDK |
| Save/reopen/สลับเอกสาร | เปิด .ai กลับได้โดยกลุ่มยังแก้ได้และ Re-trace พบ source/result IDs, fingerprints, settings และ version; ทดสอบ rename/duplicate layer, copy/paste, relink, source เปลี่ยน, ผล vector ถูกแก้มือ แล้ว Re-trace สร้างเวอร์ชันใหม่หรือแจ้ง conflict โดยไม่ทับงาน; สลับเอกสารหรือ cancel ระหว่างงานไม่ใส่ผลผิดเอกสาร; 100 jobs ไม่มี process crash หรือภาพต้นฉบับหาย |
| UXP probe | บันทึกว่า Illustrator ปรากฏใน UXP Developer Tool หรือไม่ และ API ที่ทดสอบได้จริง; ไม่ใช้ผลจาก Photoshop/Premiere มาอนุมาน |

ถ้า **Apply เป็น native paths, อ่าน linked/embedded raster, Undo, Re-trace หลัง save/reopen และความถูกต้องของตำแหน่ง** ไม่ผ่าน ห้ามเริ่มระยะ 1 หรือเรียกงานนี้ว่า Illustrator Extension ที่พร้อมใช้ หาก JSX ไม่ผ่าน gate ฝั่ง host ให้ทำ C++ SDK proof ที่ครบวงจร selection → pixels → worker → editable art → Undo → save/reopen บนเครื่องจริงก่อนตัดสินใจ และประมาณเวลา/งบใหม่; การเลือกว่าจะใช้ C++ เฉย ๆ ไม่ถือว่าผ่าน

## 8. เกณฑ์คุณภาพของ beta

สร้าง corpus ภาพที่มีสิทธิ์ใช้ **1,050–1,350 ภาพ** สำหรับโลโก้ ไอคอน และภาพสีแบน กำหนดประเภทหลักหนึ่งประเภทต่อภาพ; ในแต่ละประเภทกัน train อย่างน้อย 150, development 50 และ holdout 150 ภาพ แบ่งตามเจ้าของไฟล์/ตระกูลภาพก่อนแยกชุดเพื่อกันภาพจากงานเดียวกันรั่วข้ามชุด ห้ามปรับ algorithm หรือ preset จาก holdout เปรียบเทียบ Illustrator Image Trace Enhanced บน **เวอร์ชันเดียวกัน** ด้วยเวลา manual tuning ที่เท่ากันและบันทึก preset/ค่าไว้; เทียบ Vector Magic Desktop/VTracer แยก และระบุข้อจำกัดรุ่นทดลองที่ส่งออกไม่ได้

**A/B แบบปิดชื่อ:** นักออกแบบ 3 คนต่อภาพเลือกผลที่ใช้งานและแก้ต่อได้ดีกว่า หรือเสมอ โดยสลับตำแหน่ง A/B คะแนนรายคนชนะ/เสมอ/แพ้ = 1/0.5/0; **คะแนนภาพคือค่าเฉลี่ยของ 3 คน** และเก็บคะแนนรายคนไว้เพื่อรายงานความเห็นไม่ตรงกัน ไม่ตัดภาพที่มีความเห็นแตกต่างออก หน่วยวิเคราะห์คือภาพ; อย่างน้อย 60 ตระกูลภาพต่อประเภทและไม่เกิน 5 ภาพต่อตระกูล ค่าเฉลี่ยต้อง ≥0.60 และขอบล่าง 95% จาก cluster bootstrap ตามตระกูลภาพ 10,000 รอบด้วย seed ที่กำหนดก่อนเปิด holdout ต้อง >0.50 เทียบ **Illustrator Image Trace** เป็นเงื่อนไขหลัก ตัวเลขนี้เป็นเป้าหมายที่เสนอ ยังไม่ได้วัด

**เกณฑ์ใช้งานจริง:** topology canaries อย่างน้อย 40 ภาพต้องไม่มีรู/ชิ้นส่วนสำคัญหาย นิยาม “คุณภาพภาพใกล้กัน” ต่อภาพคือ render native art ด้วย Illustrator ที่ขนาดภาพต้นทางและ 2× แล้ว SSIM ≥ Image Trace − 0.01, edge F1 ที่ tolerance 1 พิกเซล ≥ Image Trace − 0.02 และจำนวนรู/ชิ้นส่วนสำคัญไม่แย่ลง บนภาพที่ผ่านเงื่อนไขนี้ทั้งสองวิธีต้องมี coverage ≥90% ของ holdout แต่ละประเภท และ median จำนวน anchor ≤80% ของ Image Trace **พร้อมกับ** median เวลาแก้จนจบงานสั้นกว่าอย่างน้อย 20%; รายงานสัดส่วนภาพที่เข้าเกณฑ์และทั้งสองค่า ไม่ลด anchor จนเส้นเสีย นักออกแบบ 5 คนทำงานแก้ที่ล็อกไว้คนละ 10 กรณี ต้องสำเร็จ ≥80% ภายใน 3 นาทีต่อกรณี

**เวลาและเสถียรภาพ:** ภาพ 4 MP preview p95 ≤5 วินาที, final trace ≤30 วินาทีบน Mac อ้างอิงที่ pin สเปก; Apply 10k paths p95 ≤5 วินาทีและไม่ค้าง UI ต่อเนื่องเกิน 500 ms เป้าหมาย 20 MP เป็นงานหลัง beta โดยไม่ลดความละเอียดเอง รุ่นแจกต้องรัน 1,000 jobs รวมไฟล์เสีย 20 ไฟล์โดย 0 process crash, 0 ผลลัพธ์ครึ่งงานค้าง, รายงานผลทุกไฟล์ และเก็บภาพต้นฉบับไว้ครบ

**ความตรงใน Illustrator:** ผลต้องเปิด/บันทึก .ai ได้, เลือก/แก้ anchor ได้, compound holes ถูก, สีและ transparency ตรงกับ preview ใน working space ที่กำหนด; ทดสอบ RGB, CMYK, หลาย artboard, rotated image และ Undo/Redo บน Mac และ Windows รุ่นที่ประกาศรองรับ

## 9. แผนส่งมอบ ทีม และกำหนดเวลา

| ระยะ | เวลาประมาณสำหรับทีม 4–6 คน | ผลลัพธ์/ประตูผ่าน |
|---|---:|---|
| 0 · Host contract | 2 สัปดาห์สำหรับ JSX route; เพิ่มเวลาตามผล C++ spike | CEP Panel, linked/embedded intake, worker bridge, editable native Apply, Undo และ Re-trace หลัง reopen ผ่าน §7; ถ้า JSX ไม่ผ่าน C++ SDK ต้องพิสูจน์ workflow ครบก่อนเริ่มระยะ 1 |
| 1 · Panel MVP | 4–6 สัปดาห์ | Select → Trace → Preview → Apply บน Illustrator Mac; source คงอยู่, job metadata, cancel, project reopen; 50 ภาพใช้งานครบวงจร |
| 2 · คุณภาพโลโก้/ภาพสีแบน | 8–12 สัปดาห์ | region graph, corner-aware fitting, residual map และ anchor budget; 40 canaries ผ่าน, median anchor ≤90% ของ Image Trace ในภาพที่ผ่านนิยามคุณภาพใกล้กันใน §8 และรายงาน coverage บน holdout; beta gate สุดท้ายต้องผ่านทั้ง anchor ≤80% และเวลาแก้ลด ≥20% |
| 3 · Workflow และการแก้งาน | 6–8 สัปดาห์ | warning/repair เฉพาะจุด, palette lock, Re-trace เป็นเวอร์ชันใหม่, batch ภายใน Illustrator เท่าที่ host รับได้; งานนักออกแบบผ่านเกณฑ์ §8 |
| 4 · Beta แจกจริง | 4–6 สัปดาห์ | Mac/Windows, signed ZXP + helper, installation/updates, crash recovery, A/B เทียบ Image Trace, accessibility และเอกสารผู้ใช้; ผ่านทุก gate §8 |
| 5 · UXP migration | เริ่มหลัง Illustrator UXP public beta; ประเมินเวลาใหม่ | พิสูจน์ host API และทางเชื่อม worker ก่อนย้าย Panel; ไม่ถือว่า CEP bridge ย้ายได้ 1:1 |

ระยะ 0–4 รวมโดยประมาณ **6–9 เดือนเฉพาะกรณี JSX route ผ่านระยะ 0** เมื่อทำบางงานขนานกัน; หากต้องเขียน C++ SDK adapter ให้ทำ proof ก่อนระยะ 1 แล้วประเมินเวลาและงบใหม่จากผลจริง Illustrator UXP ไม่รวมในช่วงเวลานี้

ทีม: วิศวกร Illustrator/CEP หรือ SDK 1–2 คน, วิศวกร vision/geometry 2 คน, วิศวกร Rust/packaging/QA 1 คน, นักออกแบบ Illustrator ที่ใช้จริง part-time เริ่ม Mac เครื่องนี้ก่อน แต่ต้องมี Windows machine สำหรับ release gate

## 10. การตัดสินใจและ 14 วันแรก

**วันที่ 1–3:** ตั้ง CEP Panel host ILST ใน Illustrator 30.8.2, อ่าน selection, ตรวจ UXP host availability, freeze 20 linked/20 embedded cases และ Image Trace baseline; ตรวจ source/API/license ของ VTracer และกำหนดประเภท corpus โดยแยกเจ้าของไฟล์

**วันที่ 4–7:** ส่งภาพที่เลือกเข้า Rust worker แบบ asynchronous; ทดลอง preview/cancel/ไฟล์ชั่วคราว; วัดพิกเซล ICC alpha และ transform รวมภาพ embedded

**วันที่ 8–11:** ทดลอง Apply 3 วิธีและ Undo ด้วย 20 vector scenes; ตรวจ native editability, bounds, holes, สี, layer/z-order และ save/reopen; ทดลองเก็บ metadata สำหรับ Re-trace ในไฟล์ .ai และจำลองผลถูกแก้ด้วยมือ

**วันที่ 12–14:** หาก JSX ผ่านทุก gate ให้ล็อก host contract และประมาณการระยะ 1–4; หากไม่ผ่านให้ระบุ gate ที่ล้ม, เริ่ม C++ SDK proof ครบวงจรในระยะ 0 (ยังไม่เปิดระยะ 1), แล้วประมาณการเวลา/งบใหม่จากผล proof ตรึงรุ่น Windows/hardware สำหรับ beta, สรุปกรณี trace ที่แพ้ Image Trace และบันทึกการเลือกใช้ VTracer หรือ graph engine

ติดตามข้อที่ยังเปิดใน [ทะเบียนการตัดสินใจสำหรับ Panel](Illustrator-Panel-decision-register.tsv) และบันทึกเหตุผลการเปลี่ยนแผนใน [decision log](Vector-App-decisions.tsv) แผนนี้ยังไม่ใช่คำยืนยันว่า binary ที่แนบหรือ Illustrator Image Trace ถูกชนะแล้ว
