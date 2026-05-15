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
  const systemPrompt = `你是一位顶尖的内容分析专家。你的任务是对网页内容进行深度透视分析，揭示其中的说服策略、情绪操纵手法、隐藏信息和认知偏误利用。你的分析必须犀利、具体、中立。

请严格按以下五个维度输出分析，每个维度用 2-4 句话：

## 🎯 说服技巧 (Persuasion Techniques)
识别文章使用的具体说服技巧，如：诉诸情感、权威背书、社会认同、滑坡谬误、稻草人论证、虚假两难、循环论证、片面举证、诉诸恐惧、诉诸大众、虚假因果等。对每种技巧给出原文证据。

## 🔥 情绪操纵 (Emotional Manipulation)
分析内容如何操纵读者情绪，如：制造焦虑、煽动愤怒、激发同情、制造稀缺感和紧迫感、利用愧疚感等。指出具体手法和意图。

## 🔍 隐藏信息 (Missing Information)
揭示内容有意或无意遗漏的关键信息：选择性的数据呈现、被忽略的反方观点、未披露的利益关系、被模糊的重要细节、断章取义的引用等。

## 🧠 认知偏误 (Cognitive Biases)
分析内容正在利用读者的哪些思维偏误：确认偏误、可得性启发、锚定效应、权威偏误、从众效应、幸存者偏差、框架效应、事后归因谬误等。

## 📊 总体评估 (Overall Assessment)
综合评分（0-10 分），并给出阅读建议：这篇文章值得相信吗？应该以什么态度阅读？哪些部分需要进一步核实？

格式要求：
- 每个维度用中文给出 2-4 句话的精准分析
- 直接引用原文片段作为证据（用「引号」标注）
- 语气理性中立，不做道德审判
- 避免泛泛而谈，必须针对具体内容`;

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
      max_tokens: 2500,
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
      max_tokens: 2500,
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
