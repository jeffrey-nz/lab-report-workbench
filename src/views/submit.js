/* submit.js — the pre-submission checklist, with progress kept per browser. */

import { el, slug, store } from "../dom.js";
import { CHECKLIST } from "./../data/checklist.js";

const KEY = "lrw-checks";

export const view = {
  id: "submit",
  render(root) {
    const saved = store.get(KEY, {});
    const ids = CHECKLIST.flatMap((group, gi) =>
      group.items.map((_, i) => `${slug(group.title)}-${gi}-${i}`));
    const progress = el("span");
    const bar = el("span");

    function refresh() {
      const done = ids.filter((id) => saved[id]).length;
      progress.textContent = `${done} of ${ids.length} checked`;
      bar.style.width = `${(done / ids.length) * 100}%`;
    }

    const cards = CHECKLIST.map((group, gi) => el("div", { class: "card" },
      el("div", { class: "card-head" },
        el("h3", {}, group.title),
        el("span", { class: "note" }, `${group.items.length} points`)),
      el("p", { class: "note", style: "margin:-8px 0 6px" }, group.note),
      ...group.items.map((item, i) => {
        const id = `${slug(group.title)}-${gi}-${i}`;
        const box = el("input", {
          type: "checkbox", id, checked: !!saved[id],
          onchange: (e) => {
            saved[id] = e.target.checked;
            store.set(KEY, saved);
            refresh();
          }
        });
        return el("div", { class: "check-item" }, box,
          el("div", {}, el("label", { for: id }, item.do), el("p", {}, item.why)));
      })));

    root.replaceChildren(
      el("div", { class: "view-head" },
        el("h2", {}, "Before you submit"),
        el("p", {}, "The points that most often cost marks on a scientific report, and the ones this tool cannot do for you.")),
      el("div", { class: "stack" },
        el("div", { class: "card" },
          el("div", { class: "card-head" },
            el("h3", {}, "Progress"), progress),
          el("div", { class: "progress-bar" }, bar),
          el("p", { class: "note", style: "margin-top:10px" },
            "Ticks are remembered in this browser only.")),
        ...cards)
    );
    refresh();
  }
};
