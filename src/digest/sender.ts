// pattern: Imperative Shell
import Mailgun from "mailgun.js";
import FormData from "form-data";
import type { Logger } from "pino";

/**
 * Discriminated union result type for digest email send operations.
 */
export type SendResult =
  | { readonly success: true; readonly messageId: string }
  | { readonly success: false; readonly error: string };

/**
 * Function signature for sending a digest email via a mail provider.
 * Never throws — errors are returned in the result (AC3.5).
 */
export type SendDigestFn = (
  recipient: string,
  subject: string,
  html: string,
  logger: Logger,
) => Promise<SendResult>;

/**
 * Creates a Mailgun-based digest email sender function.
 *
 * @param apiKey - Mailgun API key for authentication
 * @param domain - Mailgun domain for sending emails
 * @returns A SendDigestFn closure bound to the Mailgun credentials, ready to send emails.
 *          The returned function catches errors and returns them in the result without throwing.
 */
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
