/* submit.js — the pre-submission checklist, with progress kept per browser. */

import { el, slug, store, setChildren } from "../dom.js";
import { SECTIONS } from "./../data/checklist.js";
import { t } from "../i18n/index.js";

const KEY = "lrw-checks";

export const view = {
  id: "submit",
  render(root) {
    const saved = store.get(KEY, {});
    const ids = SECTIONS.flatMap((section) =>
      Array.from({ length: section.items }, (_, i) => `cl-${section.key}-${i}`));
    const progress = el("span");
    const bar = el("span");

    function refresh() {
      const done = ids.filter((id) => saved[id]).length;
      progress.textContent = t("submit.checked", { done, total: ids.length });
      bar.style.width = `${(done / ids.length) * 100}%`;
    }

    const cards = SECTIONS.map((section) => el("div", { class: "card" },
      el("div", { class: "card-head" },
        el("h3", {}, t(`cl.${section.key}.title`)),
        el("span", { class: "note" }, t("submit.points", { n: section.items }))),
      el("p", { class: "note", style: "margin:-8px 0 6px" }, t(`cl.${section.key}.note`)),
      ...Array.from({ length: section.items }, (_, i) => {
        const id = `cl-${section.key}-${i}`;
        const box = el("input", {
          type: "checkbox", id, checked: !!saved[id],
          onchange: (e) => {
            saved[id] = e.target.checked;
            store.set(KEY, saved);
            refresh();
          }
        });
        return el("div", { class: "check-item" }, box,
          el("div", {},
            el("label", { for: id }, t(`cl.${section.key}.${i}.do`)),
            el("p", {}, t(`cl.${section.key}.${i}.why`))));
      })));

    setChildren(root, 
      el("div", { class: "view-head" },
        el("h2", {}, t("submit.heading")),
        el("p", {}, t("submit.lede"))),
      el("div", { class: "stack" },
        el("div", { class: "card" },
          el("div", { class: "card-head" },
            el("h3", {}, t("submit.progress")), progress),
          el("div", { class: "progress-bar" }, bar),
          el("p", { class: "note", style: "margin-top:10px" },
            t("submit.localOnly"))),
        ...cards)
    );
    refresh();
  }
};
