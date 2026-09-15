#!/usr/bin/env bash
# Scaffold a minimal, non-private demo BLOG_DIR so a Cloud Agent can run the
# tcitry-blog dev server without the separate read-only content repository.
#
# The real site sources public Markdown/MDX and assets from a private content
# checkout referenced by BLOG_DIR. That content is intentionally absent from
# this repository. This helper writes a tiny placeholder content tree (only if
# one is not already present) purely so `npm run dev` / `npm run build` have a
# valid BLOG_DIR to import. It never writes into this git repository and never
# overwrites content an agent has already provided.
set -euo pipefail

BLOG_DIR="${BLOG_DIR:-$HOME/Blog}"

if [ -f "$BLOG_DIR/_index.md" ]; then
  echo "[demo-content] $BLOG_DIR already has content; leaving it untouched."
  exit 0
fi

echo "[demo-content] Scaffolding placeholder Blog content in $BLOG_DIR"
mkdir -p "$BLOG_DIR/posts" "$BLOG_DIR/docs" "$BLOG_DIR/weekly" "$BLOG_DIR/static" "$BLOG_DIR/scripts"

cat > "$BLOG_DIR/_index.md" <<'EOF'
---
title: LYon's Blog
description: 开发环境占位首页，用于本地运行 tcitry-blog。
---

这是 **tcitry-blog** 的开发环境占位首页。真实文章来自独立的只读内容仓库
（通过 `BLOG_DIR` 指定），此处内容仅用于让开发服务器可以正常启动。
EOF

cat > "$BLOG_DIR/about.md" <<'EOF'
---
title: 关于
description: 关于本占位站点。
---

本页为开发环境占位内容，证明 Markdown 渲染与路由生成正常。
EOF

cat > "$BLOG_DIR/posts/hello-world.md" <<'EOF'
---
title: Hello World
date: 2026-09-01
description: 占位文章，展示 Markdown、代码块、公式与表格渲染。
tags:
  - 演示
categories:
  - 技术
---

占位文章正文。

```ts
export const greet = (name: string) => `Hello, ${name}!`;
```

行内公式 $E = mc^2$。

| 特性 | 状态 |
| :--- | :---: |
| Markdown | 正常 |
| 代码高亮 | 正常 |
EOF

cat > "$BLOG_DIR/docs/_index.md" <<'EOF'
---
title: 文档
description: 文档区占位入口。
---

文档区占位入口。
EOF

cat > "$BLOG_DIR/docs/getting-started.md" <<'EOF'
---
title: 快速开始
date: 2026-09-05
description: 文档占位页面。
---

1. `npm run setup`
2. `BLOG_DIR=/path/to/Blog npm run dev`
EOF

cat > "$BLOG_DIR/weekly/001.md" <<'EOF'
---
title: Weekly 第 001 期
date: 2026-09-08
description: Weekly 宽布局占位条目。
---

Weekly 占位条目。
EOF

# prepare-assets copies this reviewed public download from the content repo.
cat > "$BLOG_DIR/scripts/upload-r2-image.py" <<'EOF'
#!/usr/bin/env python3
"""Demo placeholder for the public download expected by prepare-assets."""
print("tcitry-blog demo placeholder")
EOF

echo "[demo-content] Placeholder content ready."
