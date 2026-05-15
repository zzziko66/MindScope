// ============================================================
// background.js — MindScope 后台服务（Service Worker）
// 作用：接收弹窗请求，调用 AI API 进行分析
// ============================================================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "ANALYZE") {
    analyzeWithAI(request.content, request.settings)
      .then((result) => sendResponse({ success: true, data: result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
  }
  return true; // 异步响应
});

// AI 分析函数
async function analyzeWithAI(pageContent, settings) {
  const { apiKey, endpoint, model } = settings;

  if (!apiKey) {
    throw new Error("请先在设置中配置 API 密钥");
  }

  if (!endpoint) {
    throw new Error("请先配置 API 接口地址");
  }

  // 构建系统提示词（产品核心——分析引擎）
  const systemPrompt = `你是资深内容分析专家。客观、精准、一针见血。基于事实和逻辑给出判断，不带情绪，不贴标签。

按五个维度输出，**每维 1-2 句话，只给核心结论**：

## 🎯 说服技巧
识别文章使用的具体说服技巧（诉诸情感/权威背书/社会认同/滑坡谬误/虚假两难/诉诸恐惧等）。指出原文证据，一句话定性。

## 🔥 情绪操纵
分析文章在调动什么情绪（焦虑/愤怒/同情/稀缺感/愧疚等），以及具体手法。只陈述事实，不做道德批判。

## 🔍 隐藏信息
揭示文章刻意或无意遗漏的关键信息——选择性数据、忽略的反方观点、未披露的利益关系、模糊化处理的重要细节。

## 🧠 认知偏误
点明文章利用了读者的哪种思维偏误（确认偏误/锚定效应/从众效应/幸存者偏差/框架效应等）以及具体表现。

## 📊 总体评估
一句话综合判断 + 可信度评分（0-10）。给出阅读建议：哪些部分可信、哪些需要核实。

格式规则：
- 每维最多 2 句话，只说干货，不要铺垫和套话
- 引用原文用「引号」作为证据
- 禁止"首先/其次/总之/值得注意的是"等废话链接词
- 语气理性、中立、有依据`;

  const userPrompt = `请分析以下网页内容：\n\n标题：${pageContent.title || "无标题"}\n网址：${pageContent.url || ""}\n\n${pageContent.content || ""}`;

  // 判断是否为 Anthropic API
  const isAnthropic = endpoint.includes("anthropic.com");

  let data;
  if (isAnthropic) {
    data = await callAnthropicAPI(endpoint, apiKey, model, systemPrompt, userPrompt);
  } else {
    data = await callOpenAICompatibleAPI(endpoint, apiKey, model, systemPrompt, userPrompt);
  }

  return data;
}

// OpenAI 兼容格式调用（支持 OpenAI、DeepSeek、通义千问等）
async function callOpenAICompatibleAPI(endpoint, apiKey, model, systemPrompt, userPrompt) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 1200,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`API 请求失败 (${response.status}): ${errText}`);
  }

  const json = await response.json();
  return json.choices?.[0]?.message?.content || "（AI 未返回有效分析结果）";
}

// Anthropic 格式调用
async function callAnthropicAPI(endpoint, apiKey, model, systemPrompt, userPrompt) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: model || "claude-sonnet-4-20250514",
      max_tokens: 1200,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`API 请求失败 (${response.status}): ${errText}`);
  }

  const json = await response.json();
  return json.content?.[0]?.text || "（AI 未返回有效分析结果）";
}
