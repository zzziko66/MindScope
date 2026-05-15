// ============================================================
// popup.js — MindScope 弹窗交互逻辑
// ============================================================

(function () {
  "use strict";

  try {
    init();
  } catch (e) {
    console.error("MindScope init error:", e);
    document.body.innerHTML =
      '<div style="padding:20px;color:#ef4444;text-align:center;font-size:14px;">' +
      "<p><b>MindScope 启动失败</b></p><p>" +
      e.message +
      "</p></div>";
  }

  function init() {
    // --- DOM 引用 ---
    const $ = (id) => document.getElementById(id);
    const els = {
      settingsBtn: $("settingsBtn"),
      settingsPanel: $("settingsPanel"),
      analyzeBtn: $("analyzeBtn"),
      reanalyzeBtn: $("reanalyzeBtn"),
      retryBtn: $("retryBtn"),
      goToSettingsBtn: $("goToSettingsBtn"),
      saveSettingsBtn: $("saveSettingsBtn"),
      testApiBtn: $("testApiBtn"),
      apiKeyInput: $("apiKey"),
      apiEndpointInput: $("apiEndpoint"),
      modelNameInput: $("modelName"),
      settingsStatus: $("settingsStatus"),
      scoreBadge: $("scoreBadge"),
      resultContent: $("resultContent"),
      pageInfo: $("pageInfo"),
      loadingStatus: $("loadingStatus"),
      errorText: $("errorText"),
      states: {
        ready: $("stateReady"),
        loading: $("stateLoading"),
        result: $("stateResult"),
        error: $("stateError"),
        config: $("stateConfig"),
      },
    };

    // 验证关键 DOM 元素是否存在
    for (const [key, el] of Object.entries(els.states)) {
      if (!el) console.warn("MindScope: missing state element:", key);
    }
    if (!els.settingsBtn || !els.settingsPanel) {
      console.error("MindScope: settings elements missing");
      return;
    }

    // --- 默认设置 ---
    const DEFAULTS = {
      apiEndpoint: "https://api.deepseek.com/v1/chat/completions",
      modelName: "deepseek-chat",
    };

    // --- 显示/隐藏视图 ---
    function showState(name) {
      Object.keys(els.states).forEach((key) => {
        const el = els.states[key];
        if (el) {
          el.classList.toggle("hidden", key !== name);
        }
      });
    }

    // --- 从 storage 加载设置 ---
    async function loadSettings() {
      try {
        const result = await chrome.storage.sync.get([
          "mindscope_apiKey",
          "mindscope_apiEndpoint",
          "mindscope_modelName",
        ]);
        const apiKey = result.mindscope_apiKey || "";
        const endpoint =
          result.mindscope_apiEndpoint || DEFAULTS.apiEndpoint;
        const model = result.mindscope_modelName || DEFAULTS.modelName;

        if (els.apiKeyInput) els.apiKeyInput.value = apiKey;
        if (els.apiEndpointInput) els.apiEndpointInput.value = endpoint;
        if (els.modelNameInput) els.modelNameInput.value = model;

        return { apiKey, endpoint, model };
      } catch (e) {
        console.error("MindScope: loadSettings error:", e);
        return { apiKey: "", endpoint: DEFAULTS.apiEndpoint, model: DEFAULTS.modelName };
      }
    }

    // --- 保存设置 ---
    async function saveSettings() {
      const apiKey = (els.apiKeyInput && els.apiKeyInput.value.trim()) || "";
      const endpoint =
        (els.apiEndpointInput && els.apiEndpointInput.value.trim()) ||
        DEFAULTS.apiEndpoint;
      const model =
        (els.modelNameInput && els.modelNameInput.value.trim()) ||
        DEFAULTS.modelName;

      try {
        await chrome.storage.sync.set({
          mindscope_apiKey: apiKey,
          mindscope_apiEndpoint: endpoint,
          mindscope_modelName: model,
        });

        if (els.settingsStatus) {
          els.settingsStatus.textContent = "✅ 已保存";
          els.settingsStatus.style.color = "#10b981";
          setTimeout(() => (els.settingsStatus.textContent = ""), 2000);
        }
      } catch (e) {
        console.error("MindScope: saveSettings error:", e);
        if (els.settingsStatus) {
          els.settingsStatus.textContent = "❌ 保存失败: " + e.message;
          els.settingsStatus.style.color = "#ef4444";
        }
      }

      return { apiKey, endpoint, model };
    }

    // --- 获取当前页信息 ---
    async function updatePageInfo() {
      try {
        const tabs = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        const tab = tabs[0];
        if (tab && tab.title && els.pageInfo) {
          els.pageInfo.textContent = "当前页面: " + tab.title.substring(0, 40);
        }
      } catch (e) {
        // 非关键功能
      }
    }

    // --- 注入页面提取文本（不依赖 content script）---
    function pageTextExtractor() {
      var selectors = [
        "article", '[role="main"]', ".post-content", ".article-content",
        ".entry-content", "#article-content", ".content", ".post-body",
        ".article-body", "main"
      ];
      for (var i = 0; i < selectors.length; i++) {
        var el = document.querySelector(selectors[i]);
        if (el && el.textContent.trim().length > 200) {
          return JSON.stringify({ title: document.title, url: window.location.href, content: el.textContent.trim().substring(0, 15000) });
        }
      }
      var body = document.body;
      if (body) {
        var clone = body.cloneNode(true);
        var remove = clone.querySelectorAll("script, style, noscript, iframe, svg, nav, footer, header");
        for (var i = 0; i < remove.length; i++) remove[i].remove();
        var text = (clone.textContent || "").replace(/\s+/g, " ").trim().substring(0, 15000);
        return JSON.stringify({ title: document.title, url: window.location.href, content: text });
      }
      return JSON.stringify({ error: "无法提取页面内容" });
    }

    async function injectAndExtract(tabId) {
      try {
        var results = await chrome.scripting.executeScript({
          target: { tabId: tabId },
          func: pageTextExtractor,
        });
        if (results && results[0] && results[0].result) {
          return JSON.parse(results[0].result);
        }
        throw new Error("无法获取页面内容");
      } catch (e) {
        if (e.message && e.message.includes("Cannot access")) {
          throw new Error("不支持分析此类型的页面（如 chrome:// 页面）");
        }
        throw e;
      }
    }

    // --- 发送消息到 background ---
    function sendMessageToBackground(message) {
      return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            reject(
              new Error(
                "后台服务错误: " + chrome.runtime.lastError.message
              )
            );
          } else {
            resolve(response);
          }
        });
      });
    }

    // --- 主分析流程 ---
    async function startAnalysis() {
      const settings = await loadSettings();

      if (!settings.apiKey) {
        showState("config");
        return;
      }

      showState("loading");
      if (els.loadingStatus)
        els.loadingStatus.textContent = "正在提取页面内容...";

      try {
        const tabs = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        const tab = tabs[0];

        if (!tab) throw new Error("无法获取当前标签页");
        if (
          tab.url?.startsWith("chrome://") ||
          tab.url?.startsWith("about:")
        ) {
          throw new Error("不支持分析浏览器内部页面");
        }

        if (els.loadingStatus)
          els.loadingStatus.textContent = "正在提取页面内容...";
        var pageContent = await injectAndExtract(tab.id);

        if (!pageContent) throw new Error("无法获取页面内容，请确认页面已完全加载");
        if (pageContent.error) throw new Error(pageContent.error);
        if (
          !pageContent.content ||
          pageContent.content.trim().length < 50
        ) {
          throw new Error("页面内容太少，请确认页面已完全加载");
        }

        if (els.loadingStatus)
          els.loadingStatus.textContent =
            "正在调用 AI 进行分析（约 10-30 秒）...";
        const aiResult = await sendMessageToBackground({
          action: "ANALYZE",
          content: pageContent,
          settings: settings,
        });

        if (!aiResult.success) {
          throw new Error(aiResult.error || "AI 分析失败");
        }

        renderResult(aiResult.data);
        showState("result");
      } catch (error) {
        showError(error.message);
      }
    }

    // --- 渲染结果 ---
    function renderResult(analysisText) {
      // 解析评分
      const scoreMatch = analysisText.match(
        /总体评估[^]*?(\d+(?:\.\d+)?)\s*\/?\s*10/
      );
      let score = null;
      if (scoreMatch) {
        score = parseFloat(scoreMatch[1]);
      }

      if (score !== null && els.scoreBadge) {
        const scoreNum = Math.round(score);
        let color = "#10b981";
        if (scoreNum <= 3) color = "#ef4444";
        else if (scoreNum <= 6) color = "#f59e0b";
        els.scoreBadge.textContent = "可信度 " + scoreNum + "/10";
        els.scoreBadge.style.color = color;
        els.scoreBadge.style.borderColor = color;
        els.scoreBadge.style.display = "inline-block";
      } else if (els.scoreBadge) {
        els.scoreBadge.style.display = "none";
      }

      if (els.resultContent) {
        els.resultContent.innerHTML = parseAnalysisToHTML(analysisText);
      }
    }

    // --- 解析 AI 输出为 HTML 卡片 ---
    function parseAnalysisToHTML(text) {
      const sectionMap = {
        "说服技巧": { className: "card-persuasion", icon: "🎯" },
        "情绪操纵": { className: "card-emotion", icon: "🔥" },
        "隐藏信息": { className: "card-missing", icon: "🔍" },
        "认知偏误": { className: "card-bias", icon: "🧠" },
        "总体评估": { className: "card-overall", icon: "📊" },
      };

      let html = "";
      let currentCard = null;
      let currentLines = [];
      const lines = text.split("\n");

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        let matched = null;
        for (const [title, info] of Object.entries(sectionMap)) {
          if (trimmed.includes(title)) {
            matched = { title, info };
            break;
          }
        }

        if (matched) {
          if (currentCard) {
            html += buildCard(
              currentCard.className,
              currentCard.icon,
              currentCard.title,
              currentLines
            );
          }
          currentCard = {
            className: matched.info.className,
            icon: matched.info.icon,
            title: matched.title,
          };
          currentLines = [];
        } else if (currentCard) {
          var contentLine = trimmed;
          // 安全处理流程：
          // 第1步：转义 HTML 特殊字符（防 XSS，使原始文本安全）
          contentLine = escapeHtml(contentLine);
          // 第2步：将 AI 输出的 **加粗** 转为 HTML <strong>
          contentLine = contentLine.replace(
            /\*\*(.+?)\*\*/g,
            "<strong>$1</strong>"
          );
          // 第3步：将 AI 输出的 "英文引号" 转为高亮
          contentLine = contentLine.replace(
            /&quot;(.+?)&quot;/g,
            '<span class="quote">"$1"</span>'
          );
          // 第4步：将 AI 输出的 「中文引号」 转为高亮
          contentLine = contentLine.replace(
            /「(.+?)」/g,
            '<span class="quote">「$1」</span>'
          );
          // 第5步：移除列表标记和编号前缀
          contentLine = contentLine.replace(/^[-*•]\s*/, "");
          contentLine = contentLine.replace(/^\d+\.\s*/, "");

          if (contentLine.trim()) {
            currentLines.push(contentLine);
          }
        }
      }

      if (currentCard) {
        html += buildCard(
          currentCard.className,
          currentCard.icon,
          currentCard.title,
          currentLines
        );
      }

      if (!html) {
        html =
          '<div class="analysis-card"><div class="card-body">' +
          escapeHtml(text).replace(/\n/g, "<br>").replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>") +
          "</div></div>";
      }

      return html;
    }

    // --- 构建卡片（文本已安全处理，直接拼接）---
    function buildCard(className, icon, title, lines) {
      try {
        if (!Array.isArray(lines)) return "";
        if (lines.length === 0) return "";
        var bodyHtml = "";
        for (var i = 0; i < lines.length; i++) {
          if (typeof lines[i] !== "string") continue;
          bodyHtml += "<p>" + lines[i] + "</p>";
        }
        if (!bodyHtml) return "";
        return (
          '<div class="analysis-card ' +
          className +
          '"><div class="card-header"><span class="card-icon">' +
          icon +
          '</span><span class="card-title">' +
          title +
          '</span></div><div class="card-body">' +
          bodyHtml +
          "</div></div>"
        );
      } catch (e) {
        console.error("MindScope buildCard error:", e, className);
        return "";
      }
    }

    // --- HTML 转义（先于格式化执行，避免标签被双重转义）---
    function escapeHtml(str) {
      if (typeof str !== "string") return "";
      return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }

    // --- 显示错误 ---
    function showError(message) {
      const friendly = {
        "Failed to fetch": "网络请求失败，请检查 API 地址或网络连接",
        "401": "API 密钥无效（401），请检查密钥是否正确",
        "403": "API 密钥无权限（403）",
        "429": "API 请求频率过高（429），请稍后重试",
        fetch: "网络连接失败，请检查网络或 API 地址",
      };

      let msg = message;
      for (const [key, val] of Object.entries(friendly)) {
        if (message.includes(key)) {
          msg = val;
          break;
        }
      }

      if (els.errorText) els.errorText.textContent = msg;
      showState("error");
    }

    // --- 测试 API ---
    async function testApiConnection() {
      const settings = await loadSettings();
      if (!settings.apiKey) {
        if (els.settingsStatus) {
          els.settingsStatus.textContent = "⚠️ 请先输入 API 密钥";
          els.settingsStatus.style.color = "#ef4444";
        }
        return;
      }

      if (els.testApiBtn) {
        els.testApiBtn.textContent = "⏳ 测试中...";
        els.testApiBtn.disabled = true;
      }

      try {
        const result = await sendMessageToBackground({
          action: "ANALYZE",
          content: {
            title: "测试页面",
            content:
              '这是一个 API 连通性测试。请回复"连接成功！"来表示 API 正常工作。',
          },
          settings: settings,
        });

        if (els.settingsStatus) {
          if (result.success) {
            els.settingsStatus.textContent = "✅ 连接成功！API 正常工作";
            els.settingsStatus.style.color = "#10b981";
          } else {
            els.settingsStatus.textContent =
              "❌ 连接失败: " + (result.error || "未知错误");
            els.settingsStatus.style.color = "#ef4444";
          }
        }
      } catch (e) {
        if (els.settingsStatus) {
          els.settingsStatus.textContent = "❌ 连接失败: " + e.message;
          els.settingsStatus.style.color = "#ef4444";
        }
      }

      if (els.testApiBtn) {
        els.testApiBtn.textContent = "测试连接";
        els.testApiBtn.disabled = false;
      }
    }

    // ============================================================
    // 绑定事件
    // ============================================================

    // 设置面板开关（兼容 CSS class 和 inline style）
    function showSettings() {
      els.settingsPanel.classList.remove("hidden");
      els.settingsPanel.style.display = "block";
    }
    function hideSettings() {
      els.settingsPanel.style.display = "none";
    }
    function toggleSettings() {
      if (els.settingsPanel.style.display === "none" || els.settingsPanel.classList.contains("hidden")) {
        showSettings();
      } else {
        hideSettings();
      }
    }
    els.settingsBtn.addEventListener("click", toggleSettings);

    // 分析按钮
    if (els.analyzeBtn)
      els.analyzeBtn.addEventListener("click", startAnalysis);
    if (els.reanalyzeBtn)
      els.reanalyzeBtn.addEventListener("click", startAnalysis);
    if (els.retryBtn)
      els.retryBtn.addEventListener("click", startAnalysis);

    // 去配置
    if (els.goToSettingsBtn) {
      els.goToSettingsBtn.addEventListener("click", function () {
        showSettings();
        showState("ready");
      });
    }

    // 保存设置
    if (els.saveSettingsBtn) {
      els.saveSettingsBtn.addEventListener("click", saveSettings);
    }

    // 测试连接
    if (els.testApiBtn) {
      els.testApiBtn.addEventListener("click", testApiConnection);
    }

    // 回车保存
    document.querySelectorAll("#settingsPanel input").forEach(function (input) {
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") saveSettings();
      });
    });

    // ============================================================
    // 初始化：加载设置 + 更新界面
    // ============================================================
    loadSettings().then(function (settings) {
      updatePageInfo();

      if (!settings.apiKey) {
        showState("config");
        // 没有 API Key 时自动展开设置面板
        showSettings();
      } else {
        showState("ready");
      }
    });
  }
})();
