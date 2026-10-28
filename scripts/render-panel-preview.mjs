import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(path.join(root, "extension", "index.html"), "utf8");
const mockScript = `
    <script>
      const one = (id) => document.getElementById(id);
      one("presets-section").hidden = false;
      one("controls-section").hidden = false;
      document.querySelectorAll("#step-controls fieldset").forEach((field) => { field.hidden = field.id !== "fields-colors"; });
      document.querySelectorAll("#step-tabs button").forEach((button) => { button.setAttribute("aria-pressed", button.dataset.step === "colors" ? "true" : "false"); });
      one("selection").innerHTML = "<strong>Summer mark.ai</strong><small>Mock document · linked image · 480 × 320 pt</small>";
      one("preset-origin").textContent = "จาก preset: โลโก้ • แก้ไขแล้ว 3 ค่า";
      one("preview-empty").hidden = true;
      one("vector-stage").hidden = false;
      one("vector-stage").innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 150" width="240" height="150"><path fill="#cfb6ff" d="M38 119 120 22l82 97H38Z"/><path fill="#a8dcbb" d="m88 119 32-39 32 39H88Z"/><circle cx="120" cy="54" r="12" fill="#fff"/></svg>';
      one("facts").hidden = false;
      one("fact-paths").textContent = "24";
      one("fact-anchors").textContent = "92";
      one("fact-holes").textContent = "3";
      one("fact-colors").textContent = "5";
      one("fact-note").hidden = false;
      one("fact-note").textContent = "Mock preview · 5 สี · พื้นหลังโปร่งใส";
      one("edit-tools").hidden = false;
      one("status").textContent = "ตัวอย่างจำลองสำหรับดูหน้าตา panel ในเบราว์เซอร์";
      one("phase").textContent = "ตัวอย่าง";
      one("trace").disabled = false;
      one("batch").disabled = false;
      one("apply").disabled = false;
      one("max-colors").value = "5";
      one("snap").checked = false;
      one("speck").value = "10";
      one("max-colors-value").textContent = "5";
      one("speck-value").textContent = "10";
      document.querySelector('[data-preset="logo"]').setAttribute("aria-pressed", "true");
      const markChanged = (id, label) => {
        const control = one(id);
        control.classList.add("is-modified");
        const marker = document.createElement("div");
        marker.className = "control-state";
        marker.innerHTML = "<span>แก้ไขแล้ว</span><button class='control-reset' type='button'>คืนค่า preset</button>";
        const anchor = control.type === "checkbox" ? control.closest("label") : control;
        marker.querySelector("button").setAttribute("aria-label", "คืนค่า preset: " + label);
        anchor.insertAdjacentElement("afterend", marker);
      };
      markChanged("max-colors", "เพดานจำนวนสี");
      one("snap").closest("label").classList.add("is-modified");
      markChanged("snap", "ยุบสีผสม");
      markChanged("speck", "ขนาดจุดฝุ่น");
      document.querySelectorAll(".preset-card").forEach((card) => {
        card.addEventListener("click", () => {
          document.querySelectorAll(".preset-card").forEach((candidate) => candidate.setAttribute("aria-pressed", "false"));
          card.setAttribute("aria-pressed", "true");
          one("preset-confirm").hidden = card.dataset.preset === "logo";
          one("preset-confirm-text").textContent = "เปลี่ยนจาก โลโก้ เป็น preset ใหม่และเริ่มด้วยค่า preset ใหม่หรือไม่? (แก้ไขแล้ว 3 ค่า)";
        });
      });
      one("preset-confirm-cancel").addEventListener("click", () => { one("preset-confirm").hidden = true; });
    </script>
`;
const html = source
  .replace('href="style.css"', 'href="../extension/style.css"')
  .replaceAll('src="img/presets/', 'src="../extension/img/presets/')
  .replace(/    <script src="vendor\/CSInterface\.js"><\/script>[\s\S]*?    <script src="js\/panel\.js"><\/script>\n/, mockScript);
const outputDirectory = path.join(root, ".eval");
await mkdir(outputDirectory, { recursive: true });
const output = path.join(outputDirectory, "panel-preview.html");
await writeFile(output, html);
process.stdout.write(output + "\n");
