import { Plugin } from "@opencode/plugin"
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

type Settings = { url: string; email: string; token: string }

const SECRETS_FILE = join(homedir(), ".secrets", "confluence.json")

// Читаем креды в момент вызова, а не при загрузке плагина:
// так токен можно положить в файл без перезапуска сервиса.
async function resolveSettings(): Promise<Settings> {
  let file: Partial<Settings> = {}
  try {
    file = JSON.parse(await readFile(SECRETS_FILE, "utf8")) as Partial<Settings>
  } catch (error) {
    const code = (error as { code?: string }).code
    if (code !== "ENOENT") {
      throw new Error(`Не удалось прочитать ${SECRETS_FILE}: ${String(error)}`)
    }
  }

  return {
    url: (process.env.CONFLUENCE_URL ?? file.url ?? "").replace(/\/+$/, ""),
    email: process.env.CONFLUENCE_EMAIL ?? file.email ?? "",
    token: process.env.CONFLUENCE_API_TOKEN ?? file.token ?? "",
  }
}

export default Plugin.define({
  id: "confluence",
  async setup(ctx) {
    await ctx.tool.transform((editor) => {
      editor.add({
        name: "confluence_page",
        description:
          "Получить страницу Confluence по pageId (REST API v2, body-format=storage). " +
          `Креды берутся из переменных CONFLUENCE_URL, CONFLUENCE_EMAIL, CONFLUENCE_API_TOKEN ` +
          `или из файла ${SECRETS_FILE}.`,
        input: {
          type: "object",
          properties: {
            pageId: { type: "string", description: "ID страницы Confluence" },
          },
          required: ["pageId"],
          additionalProperties: false,
        },
        async execute(input, context) {
          const { pageId } = input as { pageId: string }
          const settings = await resolveSettings()

          const missing = [
            ["CONFLUENCE_URL", settings.url],
            ["CONFLUENCE_EMAIL", settings.email],
            ["CONFLUENCE_API_TOKEN", settings.token],
          ]
            .filter(([, value]) => !value)
            .map(([name]) => name)

          if (missing.length > 0) {
            throw new Error(
              `Не заданы: ${missing.join(", ")}. ` +
                `Заполните ${SECRETS_FILE} или задайте переменные окружения.`,
            )
          }

          const auth = Buffer.from(`${settings.email}:${settings.token}`).toString("base64")
          const url = `${settings.url}/wiki/api/v2/pages/${encodeURIComponent(pageId)}?body-format=storage`

          const response = await fetch(url, {
            method: "GET",
            headers: {
              Authorization: `Basic ${auth}`,
              Accept: "application/json",
            },
            signal: context.signal,
          })

          if (!response.ok) {
            throw new Error(
              `Confluence API error: ${response.status} ${response.statusText} (${url})`,
            )
          }

          return { content: JSON.stringify(await response.json()) }
        },
      })
    })
  },
})
