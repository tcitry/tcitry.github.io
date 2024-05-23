import React from "react";
import { createRoot } from "react-dom/client";
import { Chrono } from "react-chrono";

let items = [
  {
    title: "March 2023",
    cardTitle: "tcitry.github.io",
    url: "https://github.com/tcitry/tcitry.github.io",
    cardSubtitle: "博客源码",
    cardDetailedText: [
      `<img src="https://github-readme-stats.vercel.app/api/pin/?username=tcitry&repo=tcitry.github.io&hide_border=true&theme=ambient_gradient" height="120" />`,
      `目前博客的结构、功能目前我认为都到了一个相对稳定的阶段，应该可以不折腾地使用相当长一段时间了。`,
    ],
  },
  {
    title: "September 2021",
    cardTitle: "winter-fe",
    url: "https://github.com/tcitry/winter-fe",
    cardSubtitle: `跟 winter 老师学钱端`,
    cardDetailedText: [
      `<img src="https://github-readme-stats.vercel.app/api/pin/?username=tcitry&repo=winter-fe&hide_border=true&theme=gruvbox_light" height="120" />`,
      `这个项目是 winter 老师在极客时间的最后一期前端训练营的课后作业。包含以下目录：
      <ul>
        <li>toy-js 实现一个玩具版 JS 语言</li>
        <li>toy-browser 实现一个玩具版浏览器</li>
        <li>component 组件化</li>
        <li>tool-chain 工具链</li>
        <li>publish-system 发布系统</li>
        <li>toy-react 实现一个玩具版 React 框架（体验课）</li>
      </ul>`,
    ],
  },
  {
    title: "May 2021",
    url: "https://github.com/tcitry/make-choice-net",
    cardTitle: "make-choice-net",
    cardSubtitle: `一个帮助做出选择的工具`,
    cardDetailedText: [
      `<img src="https://github-readme-stats.vercel.app/api/pin/?username=tcitry&repo=make-choice-net&hide_border=true&theme=vue" height="120" />`,
      `学习 Vue 过程中产出的项目，基于 Vue2 的类似于 Todo List 的列表 demo。`,
    ],
  },
  {
    title: "June 2020",
    url: "https://github.com/tcitry/django-api-permission",
    cardTitle: "django-api-permission",
    cardSubtitle: "一个基于 Django 的 API 权限管理工具",
    cardDetailedText: [
      `<img src="https://github-readme-stats.vercel.app/api/pin/?username=tcitry&repo=django-api-permission&hide_border=true&theme=panda" height="120" />`,
      `基于 Django Middleware 通过对 URL 进行正则匹配实现的一个 API 权限管理中间件。`,
    ],
  },
  {
    title: "May 2019",
    url: "https://github.com/luojilab/django-mirage-field",
    cardTitle: "django-mirage-field",
    cardSubtitle: `一个基于 Django 的数据脱敏工具。`,
    cardDetailedText: [
      `<img src="https://github-readme-stats.vercel.app/api/pin/?username=luojilab&repo=django-mirage-field&hide_border=true&theme=ambient_gradient" height="120" />`,
      `在得到 APP 时根据数据安全需要开发的脱敏工具，使用 AES 对称加密算法，使用 Python 基于 Django 框架进行开发，它实现了在保存数据时加密、读取数据时解密的功能，同时支持通过 Django Model 层进行 ORM 方式查询。该项目目前已经被几个知名项目<a href="https://github.com/luojilab/django-mirage-field/network/dependents?package_id=UGFja2FnZS00MDE2MjM2MDg%3D" target="_blank">使用</a>。`,
    ],
  },
  {
    title: "April 2019",
    url: "https://github.com/cgfly/jeecf-cli",
    cardTitle: "jeecf-cli",
    cardSubtitle: `为 Jeecf 做了一个命令行代码生成工具`,
    cardDetailedText: [
      `<img src="https://github-readme-stats.vercel.app/api/pin/?username=cgfly&repo=jeecf-cli&hide_border=true&theme=moltack" height="120" />`,
      `基于 Python 的 Click 库为 Jeecf 开发的命令行工具，配合 jeecf-server 实现在本地生成指定的代码模板。`,
    ],
  },
  {
    title: "March 2019",
    url: "https://github.com/tcitry/publish-hugo-site",
    cardTitle: "publish-hugo-site",
    cardSubtitle: "通过 GitHub Action 发布你的 Hugo 网站",
    cardDetailedText: [
      `<img src="https://github-readme-stats.vercel.app/api/pin/?username=tcitry&repo=publish-hugo-site&hide_border=true&theme=calm" height="120" />`,
      `Publish your hugo site to master or other gh-pages`,
    ],
  },
  {
    title: "March 2019",
    url: "https://github.com/tcitry/push-to-master",
    cardTitle: "push-to-master",
    cardSubtitle: `通过 Github Action 将代码发布到指定分支`,
    cardDetailedText: [
      `<img src="https://github-readme-stats.vercel.app/api/pin/?username=tcitry&repo=push-to-master&hide_border=true&theme=rose" height="120" />`,
      `Push your code to master or other branch.`,
    ],
  },
  {
    title: "March 2017",
    url: "https://github.com/tcitry/drforum",
    cardTitle: "drforum",
    cardSubtitle: `做了一个基于 DRF 的论坛后端 Demo`,
    cardDetailedText: [
      `<img src="https://github-readme-stats.vercel.app/api/pin/?username=tcitry&repo=drforum&hide_border=true&theme=buefy" height="120" />`,
      `基于 Django-Rest-Framework 实现的论坛后端 API Demo。`,
    ],
  },
  {
    title: "November 2016",
    url: "https://github.com/tcitry/dotfiles",
    cardTitle: "dotfiles",
    cardSubtitle: "我的 Vim、Zsh 等工具的配置文件",
    cardDetailedText: [
      `<img src="https://github-readme-stats.vercel.app/api/pin/?username=tcitry&repo=dotfiles&hide_border=true&theme=blueberry" height="120" />`,
      `我的 Vim、Zsh 等命令行工具的配置文件。`,
    ],
  },
];

const Timeline = () => {
  return (
    <Chrono
      items={items}
      theme={{
        primary: "#74AA9C",
        secondary: "#0DA99C",
        cardBgColor: "#F1FAEE",
        titleColor: "#0DA99C",
        titleColorActive: "#FFF",
      }}
      mode="VERTICAL_ALTERNATING"
      parseDetailsAsHTML={true}
      enableQuickJump={false}
      disableToolbar={true}
      enableBreakPoint={true}
      responsiveBreakPoint={1536}
    ></Chrono>
  );
};

const App = () => {
  return <div></div>;
};

const path = window.location.pathname;
const container = document.getElementById("react-root");
if (container && (path === "/projects/" || path === "/projects")) {
  const root = createRoot(container);
  root.render(<Timeline />);
}

export default App;
