// pattern: Imperative Shell
import Mailgun from "mailgun.js";
import FormData from "form-data";
import type { Logger } from "pino";

export type SendResult =
  | { readonly success: true; readonly messageId: string }
  | { readonly success: false; readonly error: string };

export type SendDigestFn = (
  recipient: string,
  subject: string,
  html: string,
  logger: Logger,
) => Promise<SendResult>;

export function createMailgunSender(
  apiKey: string,
  domain: string,
): SendDigestFn {
  const mailgun = new Mailgun(FormData);
  const mg = mailgun.client({ username: "api", key: apiKey });

  return async function sendDigest(
    recipient: string,
    subject: string,
    html: string,
    logger: Logger,
  ): Promise<SendResult> {
    try {
      const result = await mg.messages.create(domain, {
        from: `Horizon Scan <noreply@${domain}>`,
        to: [recipient],
        subject,
        html,
      });

      logger.info({ messageId: result.id, recipient }, "digest email sent");
      return { success: true, messageId: result.id ?? "unknown" };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(
        { recipient, error: message },
        "digest email send failed",
      );
      return { success: false, error: message };
    }
  };
}
