/**
 * Minimal Telegram Bot API client. One method: `sendMessage`. Markdown V2
 * is fiddly enough that we use HTML formatting, which is more forgiving.
 *
 * Bot token + chat id come from Worker secrets:
 *   - TELEGRAM_BOT_TOKEN   (from @BotFather)
 *   - TELEGRAM_CHAT_ID     (channel or chat id; channels look like
 *                           "@LarryTheAnalyst" or "-1001234567890")
 */

export interface TelegramConfig {
    botToken: string;
    chatId: string;
}

export class TelegramError extends Error {
    constructor(message: string, public detail?: unknown) {
        super(message);
        this.name = "TelegramError";
    }
}

/**
 * Post `text` (HTML-formatted) to the configured chat. Returns the message
 * id on success. Disables link previews by default — Suiscan previews are
 * noisy.
 */
export async function sendMessage(
    cfg: TelegramConfig,
    text: string,
    opts: { disableLinkPreview?: boolean } = {},
): Promise<number> {
    const resp = await fetch(
        `https://api.telegram.org/bot${cfg.botToken}/sendMessage`,
        {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                chat_id: cfg.chatId,
                text,
                parse_mode: "HTML",
                disable_web_page_preview: opts.disableLinkPreview ?? true,
            }),
        },
    );
    if (!resp.ok) {
        const body = await resp.text().catch(() => "<unreadable>");
        throw new TelegramError(
            `telegram HTTP ${resp.status}: ${body}`,
            { status: resp.status },
        );
    }
    const json: any = await resp.json();
    if (!json?.ok) {
        throw new TelegramError(
            `telegram returned not-ok: ${JSON.stringify(json)}`,
        );
    }
    return Number(json.result?.message_id ?? 0);
}

/**
 * Post a photo (URL) with an HTML caption. Caption max is 1024 chars
 * (sendMessage's limit is 4096). All Larry's standard posts fit comfortably
 * — long-form sponsored posts may need to fall back to sendMessage. On
 * caption overflow we automatically truncate with an ellipsis.
 */
export async function sendPhoto(
    cfg: TelegramConfig,
    photoUrl: string,
    caption: string,
): Promise<number> {
    const safe = caption.length > 1024 ? caption.slice(0, 1020) + "…" : caption;
    const resp = await fetch(
        `https://api.telegram.org/bot${cfg.botToken}/sendPhoto`,
        {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                chat_id: cfg.chatId,
                photo: photoUrl,
                caption: safe,
                parse_mode: "HTML",
            }),
        },
    );
    if (!resp.ok) {
        const body = await resp.text().catch(() => "<unreadable>");
        throw new TelegramError(
            `telegram sendPhoto HTTP ${resp.status}: ${body}`,
            { status: resp.status },
        );
    }
    const json: any = await resp.json();
    if (!json?.ok) {
        throw new TelegramError(
            `telegram sendPhoto not-ok: ${JSON.stringify(json)}`,
        );
    }
    return Number(json.result?.message_id ?? 0);
}

/** Escape user-supplied text for inclusion in HTML-mode messages. */
export function escapeHtml(s: string): string {
    return s
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
}
