# ส่วนประกอบจากผู้พัฒนารายอื่น

| ส่วนประกอบ | รุ่น | แหล่งที่มา | ข้อมูลสิทธิ์ |
|---|---|---|---|
| Adobe CSInterface.js | 12.0.0 | [Adobe CEP Resources](https://github.com/Adobe-CEP/CEP-Resources/tree/master/CEP_12.x) | ไฟล์มีประกาศสิทธิ์ของ Adobe อยู่ในส่วนหัว ต้องตรวจเงื่อนไขการแจกจ่ายก่อนออกเวอร์ชันจริง |
| VTracer CLI และ core | 1.0.0-alpha.4 | [visioncortex/vtracer](https://github.com/visioncortex/vtracer) | crate ระบุ MIT OR Apache-2.0; เก็บ [MIT license ของโครงการ](docs/licenses/VTracer-LICENSE) ไว้แล้ว ต้องตรวจ dependency ที่บรรจุจริงก่อนแจกจ่าย |
| TypeScript / esbuild / Node types | ดู `package-lock.json` | npm registry | ใช้ในขั้น build ตรวจ license ของรุ่นที่ล็อกก่อนแจก source หรือ binary |
| pngjs | 7.0.0 | [lukeapage/pngjs](https://github.com/lukeapage/pngjs) | MIT ใช้ถอดและเข้ารหัส PNG ใน worker ที่ถูกบันเดิลเข้า extension |
| jpeg-js | 0.4.4 | [jpeg-js](https://github.com/eugeneware/jpeg-js) | BSD-3-Clause ใช้ถอด JPEG ใน worker ที่ถูกบันเดิลเข้า extension |
| jsdom | 30.1.3 | npm registry | ใช้เฉพาะสคริปต์จำลอง main thread บน Linux ไม่ได้ถูกบันเดิลเข้า extension |

โค้ดนี้ไม่ใช้ไฟล์หรือ pseudocode จาก Vector Magic.app เป็นส่วนของเอนจิน
