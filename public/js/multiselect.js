/* ════════════════════════════════════════════════════════════════
   multiselect.js — reusable multi-select dropdown (PRESENTATION ONLY)
   ----------------------------------------------------------------
   `enhanceMultiSelect(panel)` takes an element that already contains
   <label><input type="checkbox" value="…"><span>Name</span></label>
   rows and turns it into a compact dropdown: a trigger showing the
   selected options as removable chips, plus a pop-over panel of the
   same checkboxes.

   The checkboxes are NEVER removed — they remain the source of truth,
   so all existing logic (querySelectorAll(':checked'), `.checked = …`,
   save handlers, validation, sectionIds[]) keeps working unchanged.
   Call `api.sync()` (or `syncMultiSelectsIn(root)`) after changing a
   checkbox programmatically so the chips refresh.
═══════════════════════════════════════════════════════════════════ */

let _docHandlerBound = false;
function bindDocHandler(){
  if(_docHandlerBound) return;
  _docHandlerBound = true;
  // One global handler closes any open dropdown when clicking outside it.
  document.addEventListener("click", (e) => {
    document.querySelectorAll(".ms.ms-open").forEach((w) => {
      if(!w.contains(e.target)) w.__msApi?.close();
    });
  });
}

export function enhanceMultiSelect(panel, { placeholder = "Select…" } = {}){
  if(!panel) return null;
  if(panel.__msApi) return panel.__msApi;   // idempotent
  bindDocHandler();

  // Wrapper + trigger
  const wrapper = document.createElement("div");
  wrapper.className = "ms";
  panel.parentNode.insertBefore(wrapper, panel);

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "ms-trigger";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");

  const chips = document.createElement("span");
  chips.className = "ms-chips";
  const ph = document.createElement("span");
  ph.className = "ms-placeholder";
  ph.textContent = placeholder;
  chips.append(ph);

  trigger.append(chips);
  trigger.insertAdjacentHTML("beforeend",
    `<svg class="ms-caret" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`);

  panel.classList.add("ms-panel");
  wrapper.append(trigger, panel);

  const checkboxes = () => [...panel.querySelectorAll('input[type="checkbox"]')];

  function renderChips(){
    chips.querySelectorAll(".ms-chip").forEach((c) => c.remove());
    const checked = checkboxes().filter((cb) => cb.checked);
    ph.style.display = checked.length ? "none" : "";

    checked.forEach((cb) => {
      const name = cb.closest("label")?.textContent.trim() || cb.value;
      const chip = document.createElement("span");
      chip.className = "ms-chip";

      const label = document.createElement("span");
      label.className = "ms-chip-label";
      label.textContent = name;

      const x = document.createElement("button");
      x.type = "button";
      x.className = "ms-chip-x";
      x.setAttribute("aria-label", `Remove ${name}`);
      x.textContent = "×";
      x.addEventListener("click", (e) => {
        e.stopPropagation();
        cb.checked = false;
        cb.dispatchEvent(new Event("change", { bubbles: true })); // notify app listeners
      });

      chip.append(label, x);
      chips.append(chip);
    });
  }

  function position(){
    const r = trigger.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    panel.style.left  = `${r.left}px`;
    panel.style.width = `${r.width}px`;
    if(spaceBelow < 220 && r.top > spaceBelow){      // flip up if cramped below
      panel.style.top    = "auto";
      panel.style.bottom = `${window.innerHeight - r.top + 4}px`;
    } else {
      panel.style.bottom = "auto";
      panel.style.top    = `${r.bottom + 4}px`;
    }
  }

  const reposition = () => position();

  function open(){
    wrapper.classList.add("ms-open");
    trigger.setAttribute("aria-expanded", "true");
    position();
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
  }
  function close(){
    wrapper.classList.remove("ms-open");
    trigger.setAttribute("aria-expanded", "false");
    window.removeEventListener("scroll", reposition, true);
    window.removeEventListener("resize", reposition);
  }
  function toggle(){ wrapper.classList.contains("ms-open") ? close() : open(); }

  trigger.addEventListener("click", (e) => { e.stopPropagation(); toggle(); });
  panel.addEventListener("change", renderChips);  // user toggles a checkbox

  const api = { sync: renderChips, open, close, wrapper, panel };
  wrapper.__msApi = api;
  panel.__msApi = api;
  renderChips();
  return api;
}

/** Re-sync every enhanced dropdown inside `root` after programmatic changes. */
export function syncMultiSelectsIn(root){
  root?.querySelectorAll(".ms-panel").forEach((p) => p.__msApi?.sync());
}
