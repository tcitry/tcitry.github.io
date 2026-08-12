import "./tailwind.css";

const items = [
  { title: "确认范围", description: "明确目标、边界和可验收条件。" },
  { title: "完成设计", description: "将关键流程整理为可实现的页面结构。" },
  { title: "实现功能", description: "按优先级交付核心能力，并保持可维护性。" },
  { title: "验收验证", description: "核对边界场景，记录结果并安排发布。" }
];

const classes = {
  canvas: [
    "box-border min-h-dvh bg-white px-[clamp(12px,4vw,36px)] pt-[clamp(12px,3vw,28px)] pb-12 font-sans text-[#252730]",
    "max-[640px]:px-3 max-[640px]:pt-2 max-[640px]:pb-8"
  ].join(" "),
  timeline: [
    "relative isolate box-border mx-auto min-h-[calc(100dvh-88px)] max-w-[960px] pb-10",
    "[--rail-x:42px] [--card-start:88px] [--heading-gap:26px] [--card-gap:24px]",
    "max-[640px]:min-h-[calc(100dvh-40px)] max-[640px]:[--rail-x:20px] max-[640px]:[--card-start:54px]",
    "max-[640px]:[--heading-gap:24px] max-[640px]:[--card-gap:20px]"
  ].join(" "),
  rail: "pointer-events-none absolute inset-y-0 left-[var(--rail-x)] z-0 w-[2px] bg-[#dce0e6]",
  activeRail: "pointer-events-none absolute top-[var(--active-rail-start,0px)] left-[var(--rail-x)] z-[1] h-[var(--active-rail-length,0px)] w-[2px] bg-[#f1b4d5]",
  heading: [
    "relative z-[2] m-0 inline-block box-border max-w-full rounded-[10px] bg-[#fff8fb] px-6 py-3.5",
    "text-[clamp(1.35rem,2.8vw,1.75rem)] font-bold leading-[1.3] tracking-[0.01em] text-[#9d1c67]",
    "max-[640px]:rounded-lg max-[640px]:px-3.5 max-[640px]:py-2.5"
  ].join(" "),
  list: "relative m-0 ml-[var(--card-start)] mt-[var(--heading-gap)] grid box-border list-none gap-[var(--card-gap)] p-0",
  item: [
    "relative box-border min-w-0",
    "before:pointer-events-none before:absolute before:right-full before:top-[calc(var(--card-gap)*-1)] before:z-0",
    "before:box-border before:h-[calc(50%+var(--card-gap))] before:w-[calc(var(--card-start)-var(--rail-x))]",
    "before:rounded-bl-[22px] before:border-b-2 before:border-l-2 before:border-[#f1b4d5] before:content-['']",
    "first:before:top-[calc(var(--heading-gap)*-1)] first:before:h-[calc(50%+var(--heading-gap))]",
    "max-[640px]:before:rounded-bl-[16px] max-[640px]:before:border-b-[1.5px] max-[640px]:before:border-l-[1.5px]"
  ].join(" "),
  card: [
    "relative z-[2] box-border rounded-[20px] bg-[#fff8fb] px-[clamp(22px,3.5vw,30px)] py-[clamp(20px,2.8vw,26px)]",
    "text-[clamp(1.05rem,2.6vw,1.45rem)] leading-[1.65] tracking-[0.01em]",
    "max-[640px]:rounded-2xl max-[640px]:px-[18px] max-[640px]:py-[17px]"
  ].join(" "),
  itemTitle: "block font-bold",
  description: "mt-[5px] block text-[#5f6270]"
};

const app = document.querySelector("#app");

if (!app) {
  throw new Error("缺少 #app 挂载元素。");
}

app.className = classes.canvas;

const timeline = document.createElement("main");
timeline.className = classes.timeline;
timeline.setAttribute("aria-labelledby", "rounded-timeline-title");

const rail = document.createElement("span");
rail.className = classes.rail;
rail.setAttribute("aria-hidden", "true");

const activeRail = document.createElement("span");
activeRail.className = classes.activeRail;
activeRail.setAttribute("aria-hidden", "true");

const heading = document.createElement("h1");
heading.className = classes.heading;
heading.id = "rounded-timeline-title";
heading.textContent = "带圆弧连接线的时间线卡片";

const list = document.createElement("ol");
list.className = classes.list;

let lastCard;

for (const itemData of items) {
  const item = document.createElement("li");
  item.className = classes.item;

  const card = document.createElement("article");
  card.className = classes.card;

  const title = document.createElement("strong");
  title.className = classes.itemTitle;
  title.textContent = itemData.title;

  const description = document.createElement("span");
  description.className = classes.description;
  description.textContent = itemData.description;

  card.append(title, description);
  item.append(card);
  list.append(item);
  lastCard = card;
}

timeline.append(rail, activeRail, heading, list);
app.append(timeline);

function syncActiveRail() {
  if (!lastCard) return;

  const timelineBox = timeline.getBoundingClientRect();
  const headingBox = heading.getBoundingClientRect();
  const lastCardBox = lastCard.getBoundingClientRect();
  const start = headingBox.bottom - timelineBox.top;
  const end = lastCardBox.top - timelineBox.top + lastCardBox.height / 2;

  timeline.style.setProperty("--active-rail-start", `${Math.max(0, start)}px`);
  timeline.style.setProperty("--active-rail-length", `${Math.max(0, end - start)}px`);
}

const resizeObserver = new ResizeObserver(syncActiveRail);
resizeObserver.observe(timeline);
resizeObserver.observe(heading);
resizeObserver.observe(lastCard);
syncActiveRail();
