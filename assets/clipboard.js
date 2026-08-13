(function () {
  const messages = {
    idle: "copy",
    copied: "copied",
    error: "failed",
  };

  function copyWithFallback(text) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.inset = "-9999px auto auto -9999px";
    document.body.appendChild(textarea);
    textarea.select();

    try {
      if (!document.execCommand("copy")) {
        throw new Error("Copy command was rejected");
      }
    } finally {
      textarea.remove();
    }
  }

  async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch (error) {
        // Fall back for browsers that expose Clipboard API but deny the call.
      }
    }

    copyWithFallback(text);
  }

  function findHighlightedCode(block) {
    const languageCode = block.querySelector("code[data-lang]");
    if (languageCode) return languageCode;

    const codeElements = block.querySelectorAll("pre code");
    return codeElements[codeElements.length - 1] || null;
  }

  function enhanceCodeBlock(wrapper, getText) {
    if (
      !wrapper ||
      typeof getText !== "function" ||
      wrapper.dataset.codeCopyEnhanced === "true"
    ) {
      return;
    }

    wrapper.dataset.codeCopyEnhanced = "true";
    wrapper.classList.add("code-copy-wrapper");

    const button = document.createElement("button");
    button.type = "button";
    button.className = "code-copy-button";
    button.title = "Copy code";
    button.setAttribute("aria-label", "Copy code");
    button.innerHTML =
      '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M0 6.75C0 5.784.784 5 1.75 5h6.5C9.216 5 10 5.784 10 6.75v7.5A1.75 1.75 0 0 1 8.25 16h-6.5A1.75 1.75 0 0 1 0 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h6.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/><path d="M6 1.75C6 .784 6.784 0 7.75 0h6.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11H12.5a.75.75 0 0 1 0-1.5h1.75a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25h-6.5a.25.25 0 0 0-.25.25V3.5a.75.75 0 0 1-1.5 0Z"/></svg>';

    const label = document.createElement("span");
    label.className = "code-copy-label";
    label.setAttribute("aria-live", "polite");
    label.textContent = messages.idle;
    button.appendChild(label);

    let resetTimer = 0;
    let isCopying = false;

    button.addEventListener("click", async function () {
      if (isCopying) return;

      isCopying = true;
      window.clearTimeout(resetTimer);
      button.classList.remove("is-copied", "is-error");
      button.setAttribute("aria-busy", "true");

      try {
        await copyText(getText());
        label.textContent = messages.copied;
        button.setAttribute("aria-label", "Code copied");
        button.classList.add("is-copied");
      } catch (error) {
        label.textContent = messages.error;
        button.setAttribute("aria-label", "Copy failed");
        button.classList.add("is-error");
      } finally {
        isCopying = false;
        button.removeAttribute("aria-busy");
        button.focus({ preventScroll: true });
        resetTimer = window.setTimeout(function () {
          label.textContent = messages.idle;
          button.setAttribute("aria-label", "Copy code");
          button.classList.remove("is-copied", "is-error");
        }, 1800);
      }
    });

    wrapper.prepend(button);
  }

  document.querySelectorAll("main .highlight").forEach(function (block) {
    const code = findHighlightedCode(block);
    if (code) {
      enhanceCodeBlock(block, function () {
        return code.textContent || "";
      });
    }
  });

  document.querySelectorAll("main pre.mermaid").forEach(function (pre) {
    const source = pre.textContent || "";
    const wrapper = document.createElement("div");
    pre.before(wrapper);
    wrapper.appendChild(pre);
    enhanceCodeBlock(wrapper, function () {
      return source;
    });
  });

  document.querySelectorAll("main pre > code").forEach(function (code) {
    if (code.closest(".highlight")) return;

    const pre = code.parentElement;
    if (!pre || pre.matches(".mermaid") || pre.closest(".mermaid")) return;

    const wrapper = document.createElement("div");
    pre.before(wrapper);
    wrapper.appendChild(pre);
    enhanceCodeBlock(wrapper, function () {
      return code.textContent || "";
    });
  });
})();
