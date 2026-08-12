import styles from "./RoundedTimeline.module.css";

const items = [
  { title: "确认范围", description: "明确目标、边界和可验收条件。" },
  { title: "完成设计", description: "将关键流程整理为可实现的页面结构。" },
  { title: "实现功能", description: "按优先级交付核心能力，并保持可维护性。" },
  { title: "验收验证", description: "核对边界场景，记录结果并安排发布。" }
];

const app = document.querySelector("#app");

if (!app) {
  throw new Error("缺少 #app 挂载元素。");
}

app.className = styles.canvas;

const timeline = document.createElement("main");
timeline.className = styles.timeline;
timeline.setAttribute("aria-labelledby", "rounded-timeline-title");

const rail = document.createElement("span");
rail.className = styles.rail;
rail.setAttribute("aria-hidden", "true");

const heading = document.createElement("h1");
heading.className = styles.heading;
heading.id = "rounded-timeline-title";
heading.textContent = "带圆弧连接线的时间线卡片";

const list = document.createElement("ol");
list.className = styles.list;

for (const itemData of items) {
  const item = document.createElement("li");
  item.className = styles.item;

  const card = document.createElement("article");
  card.className = styles.card;

  const title = document.createElement("strong");
  title.className = styles.itemTitle;
  title.textContent = itemData.title;

  const description = document.createElement("span");
  description.className = styles.description;
  description.textContent = itemData.description;

  card.append(title, description);
  item.append(card);
  list.append(item);
}

timeline.append(rail, heading, list);
app.append(timeline);
