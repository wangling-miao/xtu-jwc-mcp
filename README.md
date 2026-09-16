# 湘潭大学教务处 MCP

Cloudflare Worker 上的远程 MCP，用于检索湘潭大学教务处官网：<https://jwc.xtu.edu.cn/>。

基于教务处官方 Visual SiteBuilder / Lucene 全站搜索，不需要登录，也不会使用或保存浏览器 Cookie。

## 工具

| 工具 | 作用 |
|---|---|
| `search_jwc` | 搜索教务处官网公开内容，支持分页 |
| `get_article` | 读取一篇教务处文章正文，并提取附件链接 |
| `list_sections` | 返回教务处常用栏目入口 |

## 已适配的搜索请求

- 第 1 页：`POST /ssjg.jsp?wbtreeid=1001`
- 参数：`lucenenewssearchkey=<UTF-8 Base64>`、`_lucenesearchtype=1`、`searchScope=1`
- 第 2 页及以后：`GET /ssjg.jsp?...&currentnum=N&newskeycode2=<Base64>&order=&range=`
- 结果列表：`ul.listg2412`
- 兼容教务处旧页面的 GB2312 / GBK 编码

## 部署

```bash
npm i
npx wrangler login
npx wrangler deploy
```

当前包预生成的 `ACCESS_UUID`：

```text
8654fc9e-12da-4f2f-b025-b74aba41bf84
```

MCP 地址：

```text
https://xtu-jwc-mcp.<你的账号>.workers.dev/8654fc9e-12da-4f2f-b025-b74aba41bf84/mcp
```

如修改 `wrangler.toml` 中的 `ACCESS_UUID`，客户端地址也要同步修改。

## 客户端配置

```json
{
  "mcpServers": {
    "xtu-jwc": {
      "type": "http",
      "url": "https://xtu-jwc-mcp.<你的账号>.workers.dev/8654fc9e-12da-4f2f-b025-b74aba41bf84/mcp"
    }
  }
}
```

Streamable HTTP 客户端不要配置成传统 SSE。

## 自测

```bash
UUID=8654fc9e-12da-4f2f-b025-b74aba41bf84
BASE=https://xtu-jwc-mcp.<你的账号>.workers.dev

curl -s "$BASE/health"

curl -s "$BASE/$UUID/mcp" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'

curl -s "$BASE/$UUID/mcp" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search_jwc","arguments":{"query":"推免","page":1}}}'
```

## 说明

- 教务处页面声明 `gb2312`，项目会按 `gb18030` 兼容解码。
- 搜索结果返回标题、日期、摘要、文章 URL，并尽量解析总结果数、总页数。
- `get_article` 只允许读取 `jwc.xtu.edu.cn`，避免把 Worker 变成任意 URL 抓取代理。
- 你抓包中的 `JSESSIONID` 没有写入项目，公开搜索不需要它。
