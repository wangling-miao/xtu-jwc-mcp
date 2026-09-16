/**
 * 湘潭大学教务处 MCP
 * Cloudflare Worker · Streamable HTTP（无状态 JSON-RPC）
 *
 * 数据源：湘潭大学教务处官网 https://jwc.xtu.edu.cn/
 * 搜索：官方 Visual SiteBuilder/Lucene 全站搜索 ssjg.jsp
 */

const DEFAULT_UUID = "8654fc9e-12da-4f2f-b025-b74aba41bf84";
const JWC = "https://jwc.xtu.edu.cn";
const SEARCH_PATH = "/ssjg.jsp?wbtreeid=1001";
const UA =
  "Mozilla/5.0 (compatible; XTU-JWC-MCP/1.0; +https://jwc.xtu.edu.cn/)";
const PROTOCOL = "2025-03-26";

const SERVER_INFO = {
  name: "xtu-jwc-mcp",
  title: "湘潭大学教务处检索",
  version: "1.0.0",
};

const TOOLS = [
  {
    name: "search_jwc",
    description:
      "检索湘潭大学教务处官网（jwc.xtu.edu.cn）的通知公告、规章制度、办事指南、推免、学分认定、学科竞赛等公开内容。关键词走教务处官方 Lucene 全站搜索。",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "搜索关键词，例如：推免、转专业、学分认定、考试、毕业论文",
        },
        page: {
          type: "integer",
          description: "页码，从 1 开始，默认 1",
          minimum: 1,
          default: 1,
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "get_article",
    description:
      "读取湘潭大学教务处官网一篇公开文章正文，并尽量提取附件。可传相对路径（如 info/1005/4741.htm）或 jwc.xtu.edu.cn 完整 URL。",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "教务处文章地址或相对路径",
        },
      },
      required: ["url"],
      additionalProperties: false,
    },
  },
  {
    name: "list_sections",
    description: "列出湘潭大学教务处官网常用栏目入口。",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
];

export default {
  async fetch(request, env) {
    const uuid = String(env.ACCESS_UUID || DEFAULT_UUID).toLowerCase();
    const url = new URL(request.url);
    const parts = url.pathname.replace(/\/+$/, "").split("/").filter(Boolean);

    if (request.method === "OPTIONS") {
      return cors(new Response(null, { status: 204 }));
    }

    if (
      request.method === "GET" &&
      parts.length === 1 &&
      parts[0].toLowerCase() === "health"
    ) {
      return cors(
        json({
          ok: true,
          service: SERVER_INFO.name,
          version: SERVER_INFO.version,
          source: JWC,
          hint: "MCP 地址是 /<ACCESS_UUID>/mcp，type 选 http / streamableHttp，不要选 sse",
        })
      );
    }

    if (parts[0]?.toLowerCase() !== uuid) {
      return new Response("Not Found", { status: 404 });
    }

    const rest = parts.slice(1).join("/") || "";
    const isMcpPath =
      rest === "" ||
      rest === "health" ||
      rest === "mcp" ||
      rest === "sse" ||
      rest === "message" ||
      rest === "messages" ||
      rest === "mcp/sse" ||
      rest === "mcp/message" ||
      rest === "mcp/messages";

    if (!isMcpPath) {
      return new Response("Not Found", { status: 404 });
    }

    if (
      request.method === "GET" &&
      (rest === "" || rest === "health") &&
      !acceptsEventStream(request)
    ) {
      return cors(
        json({
          ok: true,
          service: SERVER_INFO.name,
          version: SERVER_INFO.version,
          source: JWC,
          mcp: `/${uuid}/mcp`,
          hint: "type 选 streamableHttp / http，不要选 sse",
        })
      );
    }

    if (request.method === "GET") {
      return cors(
        new Response("Method Not Allowed. Use POST JSON-RPC (Streamable HTTP).", {
          status: 405,
          headers: {
            Allow: "POST, OPTIONS",
            "Content-Type": "text/plain; charset=utf-8",
          },
        })
      );
    }

    if (request.method === "DELETE") {
      return cors(
        new Response(null, { status: 405, headers: { Allow: "POST, OPTIONS" } })
      );
    }

    if (request.method !== "POST") {
      return cors(new Response("Method Not Allowed", { status: 405 }));
    }

    return handleMcp(request);
  },
};

async function handleMcp(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return cors(
      json(
        {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Parse error" },
        },
        400
      )
    );
  }

  if (Array.isArray(body)) {
    const out = [];
    for (const item of body) {
      const res = await dispatch(item);
      if (res) out.push(res);
    }
    return cors(json(out));
  }

  const res = await dispatch(body);
  if (!res) return cors(new Response(null, { status: 202 }));
  return cors(json(res));
}

async function dispatch(msg) {
  if (!msg || typeof msg !== "object") {
    return rpcError(null, -32600, "Invalid Request");
  }

  const { id, method, params } = msg;
  const isNotify = id === undefined || id === null;

  try {
    switch (method) {
      case "initialize":
        return rpcResult(id, {
          protocolVersion: params?.protocolVersion || PROTOCOL,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions:
            "检索湘潭大学教务处官网（jwc.xtu.edu.cn）。通常先用 search_jwc 找到文章，再用 get_article 读取正文和附件。list_sections 可查看常用栏目。",
        });
      case "notifications/initialized":
      case "notifications/cancelled":
      case "notifications/progress":
        return null;
      case "ping":
        return isNotify ? null : rpcResult(id, {});
      case "tools/list":
        return rpcResult(id, { tools: TOOLS });
      case "tools/call":
        return rpcResult(id, await callTool(params || {}));
      case "resources/list":
        return rpcResult(id, { resources: [] });
      case "resources/templates/list":
        return rpcResult(id, { resourceTemplates: [] });
      case "prompts/list":
        return rpcResult(id, { prompts: [] });
      default:
        if (isNotify) return null;
        return rpcError(id, -32601, `Method not found: ${method}`);
    }
  } catch (err) {
    if (isNotify) return null;
    return rpcError(id, -32000, String(err?.message || err));
  }
}

async function callTool(params) {
  const name = params.name;
  const args = params.arguments || {};

  if (name === "search_jwc") {
    const query = String(args.query || "").trim();
    if (!query) return textResult("请提供 query。", true);
    const page = Math.max(1, Number(args.page || 1) || 1);
    const results = await searchJwc(query, page);
    return textResult(JSON.stringify(results, null, 2));
  }

  if (name === "get_article") {
    const raw = String(args.url || "").trim();
    if (!raw) return textResult("请提供 url。", true);
    const article = await getArticle(raw);
    return textResult(JSON.stringify(article, null, 2));
  }

  if (name === "list_sections") {
    return textResult(JSON.stringify(SECTIONS, null, 2));
  }

  return textResult(`未知工具: ${name}`, true);
}

const SECTIONS = {
  home: `${JWC}/`,
  organization: `${JWC}/jgsz.htm`,
  news: `${JWC}/xwdt.htm`,
  rules: `${JWC}/gzzd.htm`,
  services: `${JWC}/bszn.htm`,
  distinguished_teachers: `${JWC}/jxms.htm`,
  downloads: `${JWC}/xzzq.htm`,
  notices: `${JWC}/tzgg.htm`,
  competitions: `${JWC}/xkjs.htm`,
  competition_notices: `${JWC}/xkjs/tzgg.htm`,
  competition_news: `${JWC}/xkjs/xwbd.htm`,
  competition_info: `${JWC}/xkjs/xxgk.htm`,
  competition_catalog: `${JWC}/xkjs/jsjs.htm`,
  curriculum_ideology: `${JWC}/kcsz.htm`,
  recommendation: `${JWC}/tmzl.htm`,
  virtual_simulation: `${JWC}/xnfz.htm`,
  exam_info: `${JWC}/ksxx.htm`,
  grade_announcements: `${JWC}/cjgg.htm`,
  search: `${JWC}${SEARCH_PATH}`,
};

function textResult(text, isError = false) {
  return { content: [{ type: "text", text }], isError };
}

async function searchJwc(query, page) {
  const encoded = base64Utf8(query);
  let res;

  if (page <= 1) {
    const body = new URLSearchParams({
      lucenenewssearchkey: encoded,
      _lucenesearchtype: "1",
      searchScope: "1",
      x: "12",
      y: "15",
    });

    res = await fetch(`${JWC}${SEARCH_PATH}`, {
      method: "POST",
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: JWC,
        Referer: `${JWC}${SEARCH_PATH}`,
      },
      body,
      redirect: "follow",
    });
  } else {
    const u = new URL(`${JWC}/ssjg.jsp`);
    u.searchParams.set("wbtreeid", "1001");
    u.searchParams.set("searchScope", "1");
    u.searchParams.set("currentnum", String(page));
    u.searchParams.set("newskeycode2", encoded);
    u.searchParams.set("order", "");
    u.searchParams.set("range", "");

    res = await fetch(u, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        Referer: `${JWC}${SEARCH_PATH}`,
      },
      redirect: "follow",
    });
  }

  if (!res.ok) throw new Error(`搜索失败 HTTP ${res.status}`);
  const html = await readSiteText(res);
  const items = parseSearchResults(html);
  const pager = parsePager(html);

  return {
    query,
    page,
    total: pager.total,
    totalPages: pager.totalPages,
    count: items.length,
    source: `${JWC}${SEARCH_PATH}`,
    items,
  };
}

function parseSearchResults(html) {
  const items = [];
  const seen = new Set();

  const list = html.match(
    /<ul[^>]*class=["'][^"']*listg2412[^"']*["'][^>]*>([\s\S]*?)<\/ul>/i
  );
  const chunk = list ? list[1] : html;
  const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let li;

  while ((li = liRe.exec(chunk))) {
    const block = li[1];
    const hrefM = block.match(/href=["']([^"']+)["']/i);
    if (!hrefM) continue;

    const href = decodeEntities(hrefM[1]);
    if (!/info\/\d+\/\d+\.htm(?:$|[?#])/i.test(href)) continue;

    let abs;
    try {
      abs = new URL(href, `${JWC}/`).href;
    } catch {
      continue;
    }
    if (seen.has(abs)) continue;
    seen.add(abs);

    const titleM = block.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
    const dateM =
      block.match(
        /<(?:span|div)[^>]*class=["'][^"']*(?:date-list|date)[^"']*["'][^>]*>([\s\S]*?)<\/(?:span|div)>/i
      ) || block.match(/(\d{4}[-年]\d{1,2}[-月]\d{1,2}日?)/);
    const pM = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);

    const title = strip(titleM ? titleM[1] : "").slice(0, 180);
    const date = normalizeDate(strip(dateM ? dateM[1] : ""));
    const snippet = strip(pM ? pM[1] : "").slice(0, 360);
    if (!title || title.length < 2) continue;

    items.push({
      title,
      date,
      snippet,
      url: abs,
      path: abs.startsWith(`${JWC}/`) ? abs.slice(JWC.length + 1) : abs,
    });
  }

  return items.slice(0, 20);
}

function parsePager(html) {
  const m = html.match(/<table[^>]*class=["']?listFrame["']?[^>]*>([\s\S]*?)<\/table>/i);
  const text = strip(m ? m[1] : "");
  const totalM = text.match(/共有\s*(\d+)\s*条/);
  const pagesM = text.match(/共有\s*(\d+)\s*页/);
  return {
    total: totalM ? Number(totalM[1]) : null,
    totalPages: pagesM ? Number(pagesM[1]) : null,
  };
}

async function getArticle(input) {
  const target = normalizeArticleUrl(input);
  const u = new URL(target);
  if (u.hostname.toLowerCase() !== "jwc.xtu.edu.cn") {
    throw new Error("只允许读取 jwc.xtu.edu.cn 域名页面");
  }

  const res = await fetch(target, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      Referer: `${JWC}/`,
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`抓取失败 HTTP ${res.status}`);

  const html = await readSiteText(res);
  const title = extractTitle(html) || target;
  const text = extractMain(html);
  const attachments = extractAttachments(html, target);
  const meta = extractArticleMeta(html);

  return {
    title,
    url: target,
    publisher: meta.publisher,
    publishedAt: meta.publishedAt,
    chars: text.length,
    attachments,
    text: text.slice(0, 20000),
  };
}

function normalizeArticleUrl(input) {
  let target = input.trim();
  if (target.startsWith("/")) target = JWC + target;
  if (!/^https?:\/\//i.test(target)) {
    target = `${JWC}/${target.replace(/^\.\//, "")}`;
  }
  return target;
}

function extractTitle(html) {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const h2 = html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const raw = strip(h1?.[1] || h2?.[1] || t?.[1] || "");
  return raw.replace(/\s*[-—_]?\s*教务处\s*$/i, "").trim();
}

function extractArticleMeta(html) {
  const plain = strip(html);
  const dateM = plain.match(/发布时间[:：]?\s*(\d{4}[-年]\d{1,2}[-月]\d{1,2}日?)/);
  const publisherM = plain.match(/发布[:：]?\s*([^\s]{1,30})\s*发布时间/);
  return {
    publisher: publisherM ? publisherM[1] : "",
    publishedAt: dateM ? normalizeDate(dateM[1]) : "",
  };
}

function extractAttachments(html, pageUrl) {
  const out = [];
  const seen = new Set();
  const re = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;

  while ((m = re.exec(html))) {
    const href = decodeEntities(m[1]);
    const label = strip(m[2]);
    const isFile =
      /\.(pdf|docx?|xlsx?|pptx?|zip|rar|7z|wps|et)(?:$|[?#])/i.test(href) ||
      /__local\//i.test(href) ||
      /\/system\/resource\/attach\//i.test(href);
    if (!isFile) continue;

    let abs;
    try {
      abs = new URL(href, pageUrl).href;
    } catch {
      continue;
    }
    if (seen.has(abs)) continue;
    seen.add(abs);

    out.push({
      name: label.slice(0, 160) || safeFilename(abs),
      url: abs,
    });
  }

  return out;
}

function extractMain(html) {
  let chunk = "";
  const candidates = [
    /<div[^>]+class=["'][^"']*v_news_content[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/i,
    /<div[^>]+id=["']vsb_content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]+class=["'][^"']*vsb_content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<td[^>]+class=["'][^"']*v_news_content[^"']*["'][^>]*>([\s\S]*?)<\/td>/i,
  ];

  for (const re of candidates) {
    const m = html.match(re);
    if (m?.[1]) {
      chunk = m[1];
      break;
    }
  }

  if (!chunk) {
    const startM = html.match(/(?:发布时间|发布：|发布:)[\s\S]{0,1200}?(<p[\s\S]*)/i);
    chunk = startM?.[1] || html;
    chunk = chunk.split(/(?:上一篇|下一篇|最新内容|<section[^>]+class=["'][^"']*friLink)/i)[0];
  }

  chunk = chunk
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr|table|section)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, " ");

  const lines = decodeEntities(chunk)
    .split(/\n+/)
    .map((l) => l.replace(/[ \t\u3000]+/g, " ").trim())
    .filter(Boolean);

  const drop = new Set([
    "网站首页",
    "机构设置",
    "新闻动态",
    "规章制度",
    "办事指南",
    "教学名师",
    "下载专区",
    "通知公告",
    "学科竞赛",
    "课程思政",
    "推免专栏",
    "虚拟仿真",
    "首页",
    "正文",
  ]);

  const kept = [];
  for (const line of lines) {
    if (drop.has(line)) continue;
    if (/^湘潭大学教务处版权所有/.test(line)) break;
    kept.push(line);
  }
  return kept.join("\n").trim();
}

async function readSiteText(response) {
  const buf = await response.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const contentType = response.headers.get("content-type") || "";
  const headProbe = new TextDecoder().decode(bytes.slice(0, Math.min(bytes.length, 8192)));
  const declared = `${contentType} ${headProbe}`.match(
    /charset\s*=\s*["']?\s*(gb2312|gbk|gb18030|utf-8)/i
  )?.[1];

  const encoding = declared && !/^utf-8$/i.test(declared) ? "gb18030" : "utf-8";
  try {
    return new TextDecoder(encoding).decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes);
  }
}

function base64Utf8(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function normalizeDate(s) {
  const m = String(s || "").match(/(\d{4})[-年](\d{1,2})[-月](\d{1,2})/);
  if (!m) return String(s || "").trim();
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

function safeFilename(url) {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").pop() || "附件");
  } catch {
    return "附件";
  }
}

function decodeEntities(s) {
  return String(s || "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return Number.isFinite(code) ? String.fromCodePoint(code) : " ";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => {
      const code = Number.parseInt(n, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : " ";
    });
}

function strip(s) {
  return decodeEntities(String(s || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function rpcResult(id, result) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function rpcError(id, code, message, status) {
  const payload = {
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code, message },
  };
  if (status) return json(payload, status);
  return payload;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function acceptsEventStream(request) {
  const accept = request.headers.get("Accept") || "";
  return /text\/event-stream/i.test(accept);
}

function cors(res) {
  const headers = new Headers(res.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Accept, MCP-Protocol-Version, Mcp-Session-Id, Mcp-Method, Mcp-Name, Last-Event-ID"
  );
  headers.set("Access-Control-Expose-Headers", "Mcp-Session-Id");
  return new Response(res.body, { status: res.status, headers });
}
